import { booksCol } from '../db/collections.js';
import { closeMongo, connectMongo } from '../db/mongo.js';
import { generateBookIntroduction, isTestBookCandidate } from '../utils/book-introduction.js';

type Args = {
  dryRun: boolean;
  limit: number;
  noOpenLibrary: boolean;
  sleepMs: number;
};

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let dryRun = false;
  let limit = 0;
  let noOpenLibrary = false;
  let sleepMs = 150;

  for (let i = 0; i < args.length; i += 1) {
    const cur = args[i] ?? '';
    if (cur === '--dry-run') dryRun = true;
    else if (cur === '--no-openlibrary') noOpenLibrary = true;
    else if (cur === '--limit') {
      const next = Number(args[i + 1]);
      if (Number.isFinite(next) && next > 0) limit = Math.floor(next);
      i += 1;
    } else if (cur.startsWith('--limit=')) {
      const next = Number(cur.slice('--limit='.length));
      if (Number.isFinite(next) && next > 0) limit = Math.floor(next);
    } else if (cur === '--sleep-ms') {
      const next = Number(args[i + 1]);
      if (Number.isFinite(next) && next >= 0) sleepMs = Math.floor(next);
      i += 1;
    } else if (cur.startsWith('--sleep-ms=')) {
      const next = Number(cur.slice('--sleep-ms='.length));
      if (Number.isFinite(next) && next >= 0) sleepMs = Math.floor(next);
    } else if (cur === '--help' || cur === '-h') {
      // eslint-disable-next-line no-console
      console.log(
        [
          '用法：pnpm -C backend backfill:book-intros -- [options]',
          '',
          '选项：',
          '  --dry-run            仅预览，不写入数据库',
          '  --limit <n>          最多处理 n 条（默认 0=不限制）',
          '  --no-openlibrary     不请求 Open Library（仅本地模板生成）',
          '  --sleep-ms <ms>      每次网络请求之间的等待（默认 150ms）',
        ].join('\n'),
      );
      process.exit(0);
    }
  }

  return { dryRun, limit, noOpenLibrary, sleepMs };
}

function sleep(ms: number) {
  if (!ms) return Promise.resolve();
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Open Library 建议带上 UA，便于限流与排障
        'User-Agent': 'libraryManagementSystem/intro-backfill',
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const SUBJECT_CN_MAP: Array<[string, string]> = [
  ['software engineering', '软件工程'],
  ['computer programming', '编程'],
  ['object-oriented', '面向对象'],
  ['design patterns', '设计模式'],
  ['refactoring', '重构'],
  ['domain-driven', '领域驱动设计'],
  ['algorithms', '算法'],
  ['data structures', '数据结构'],
  ['javascript', 'JavaScript'],
  ['python', 'Python'],
  ['deep learning', '深度学习'],
  ['machine learning', '机器学习'],
  ['devops', 'DevOps'],
  ['continuous delivery', '持续交付'],
  ['distributed systems', '分布式系统'],
  ['history', '历史'],
  ['economics', '经济学'],
  ['finance', '金融'],
  ['investment', '投资'],
  ['fiction', '小说'],
  ['fantasy', '奇幻'],
  ['science fiction', '科幻'],
  ['psychology', '心理学'],
  ['self-help', '自我提升'],
  ['philosophy', '哲学'],
  ['stoicism', '斯多葛'],
];

function normalizeSubject(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function subjectsToTopics(subjects: unknown) {
  const list = Array.isArray(subjects) ? subjects : [];
  const topics: string[] = [];

  for (const raw of list) {
    const normalized = normalizeSubject(raw);
    if (!normalized) continue;

    for (const [key, cn] of SUBJECT_CN_MAP) {
      if (!normalized.includes(key)) continue;
      if (!topics.includes(cn)) topics.push(cn);
      break;
    }

    if (topics.length >= 5) break;
  }

  return topics;
}

async function fetchOpenLibraryTopics(isbn: string, sleepMs: number) {
  const normalized = String(isbn ?? '').trim();
  if (!normalized) return [];

  // 注意：当前环境 HTTPS 可能握手失败，这里使用 HTTP（仅用于“参考信息”）。
  const isbnJson = await fetchJson(`http://openlibrary.org/isbn/${encodeURIComponent(normalized)}.json`);
  await sleep(sleepMs);
  if (!isbnJson) return [];

  const works = Array.isArray(isbnJson.works) ? isbnJson.works : [];
  const workKey = works?.[0]?.key ? String(works[0].key) : '';
  if (!workKey) return [];

  const workJson = await fetchJson(`http://openlibrary.org${workKey}.json`);
  await sleep(sleepMs);
  if (!workJson) return [];

  return subjectsToTopics(workJson.subjects);
}

function filterTopicsByCategory(category: string, topics: string[]) {
  const c = String(category ?? '').trim();
  if (!c || topics.length === 0) return topics;

  const allow = new Set<string>();
  if (c === '计算机') {
    [
      '软件工程',
      '编程',
      '面向对象',
      '设计模式',
      '重构',
      '领域驱动设计',
      '算法',
      '数据结构',
      'JavaScript',
      'Python',
      '深度学习',
      '机器学习',
      'DevOps',
      '持续交付',
      '分布式系统',
      '哲学', // 少量“编程哲学”类也可能出现
    ].forEach((t) => allow.add(t));
  } else if (c === '文学') {
    ['小说', '奇幻', '科幻'].forEach((t) => allow.add(t));
  } else if (c === '历史') {
    ['历史'].forEach((t) => allow.add(t));
  } else if (c === '经济') {
    ['经济学', '金融', '投资'].forEach((t) => allow.add(t));
  } else {
    ['心理学', '自我提升', '哲学', '斯多葛'].forEach((t) => allow.add(t));
  }

  const next = topics.filter((t) => allow.has(t));
  return next.length > 0 ? next : [];
}

async function main() {
  const args = parseArgs(process.argv);
  await connectMongo();

  try {
    const filter = {
      $or: [{ introduction: { $exists: false } }, { introduction: '' }, { introduction: null }],
    } as const;

    const cursor = booksCol()
      .find(filter as any, {
        projection: {
          _id: 1,
          isbn: 1,
          title: 1,
          author: 1,
          category: 1,
          introduction: 1,
        } as any,
      })
      .sort({ created_at: -1 });

    const candidates = await cursor.toArray();
    const limited = args.limit > 0 ? candidates.slice(0, args.limit) : candidates;

    let scanned = 0;
    let updated = 0;
    let skippedTest = 0;
    let skippedNoTitle = 0;
    let skippedEmpty = 0;
    let failed = 0;

    const preview: Array<{ isbn: string; title: string; introduction: string }> = [];

    for (const doc of limited) {
      scanned += 1;
      const isbn = String((doc as any).isbn ?? '').trim();
      const title = String((doc as any).title ?? '').trim();
      const author = String((doc as any).author ?? '').trim();
      const category = String((doc as any).category ?? '').trim();

      if (!title) {
        skippedNoTitle += 1;
        continue;
      }

      if (isTestBookCandidate({ isbn, title, author })) {
        skippedTest += 1;
        continue;
      }

      let topics: string[] = [];
      if (!args.noOpenLibrary && isbn) {
        topics = filterTopicsByCategory(category, await fetchOpenLibraryTopics(isbn, args.sleepMs));
      }

      const introduction = generateBookIntroduction({ isbn, title, author, category }, topics);
      if (!introduction) {
        skippedEmpty += 1;
        continue;
      }

      if (args.dryRun) {
        preview.push({ isbn, title, introduction });
        continue;
      }

      try {
        const result = await booksCol().updateOne({ _id: (doc as any)._id }, { $set: { introduction } });
        if (result.modifiedCount > 0) updated += 1;
      } catch {
        failed += 1;
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          dry_run: args.dryRun,
          scanned,
          updated,
          skipped_test: skippedTest,
          skipped_no_title: skippedNoTitle,
          skipped_empty: skippedEmpty,
          failed,
          preview_sample: preview.slice(0, 10),
        },
        null,
        2,
      ),
    );
  } finally {
    await closeMongo().catch(() => {});
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[backfill-book-introductions] failed:', error);
  process.exitCode = 1;
});
