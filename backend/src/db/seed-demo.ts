import { ObjectId } from 'mongodb';

import { env } from '../config/env.js';
import { hashPassword } from '../utils/crypto.js';

import { booksCol, borrowsCol, usersCol, type BookDoc, type BorrowDoc, type UserDoc } from './collections.js';

type SeedBookCategory = '计算机' | '文学' | '历史' | '经济' | '其他';

type SeedBookMeta = {
  isbn: string;
  title: string;
  author: string;
  introduction?: string;
  category: SeedBookCategory;
  cover_id?: number;
};

const SEED_BOOKS: SeedBookMeta[] = [
  {
    isbn: '9780136083252',
    title: 'Clean Code',
    author: 'Robert Martin',
    category: '计算机',
    cover_id: 14415969,
    introduction:
      '软件工匠经典之作，围绕命名、函数、注释、代码坏味道与重构等主题，给出可操作的编码与评审建议，帮助提升可读性与可维护性。',
  },
  {
    isbn: '9780134494326',
    title: 'Clean Architecture',
    author: 'Robert Martin',
    category: '计算机',
    cover_id: 15093860,
    introduction:
      '从设计原则与架构边界出发，讲解如何让业务规则独立于框架、UI 与数据库，通过分层与依赖倒置实现可测试、可演进的系统结构。',
  },
  { isbn: '9780137081073', title: 'The Clean Coder', author: 'Robert C. Martin', category: '计算机', cover_id: 11311437 },
  {
    isbn: '9780201485677',
    title: 'Refactoring',
    author: 'Martin Fowler',
    category: '计算机',
    cover_id: 7087623,
    introduction:
      '系统讲解在不改变外部行为的前提下改进代码结构的方法，包含常见重构手法与示例，强调通过小步改动和测试支撑持续演进。',
  },
  {
    isbn: '9783826697005',
    title: 'Design Patterns',
    author: 'Erich Gamma',
    category: '计算机',
    cover_id: 14637796,
    introduction:
      '“GoF 设计模式”代表作，总结创建型、结构型、行为型等经典模式及其适用场景，用统一语言描述可复用的面向对象设计经验。',
  },
  { isbn: '9788131722428', title: 'The Pragmatic Programmer', author: 'Andrew Hunt', category: '计算机', cover_id: 14633759 },
  { isbn: '9783860635933', title: 'Code Complete - Deutsche AusgabeDer Second Edition', author: 'Steve McConnell', category: '计算机', cover_id: 11143454 },
  { isbn: '9780262046305', title: 'Introduction to Algorithms, Fourth Edition', author: 'Thomas H. Cormen', category: '计算机', cover_id: 13768952 },
  { isbn: '9789352135240', title: 'Designing Data Intensive Application', author: 'Martin Kleppmann', category: '计算机', cover_id: 15096047 },
  { isbn: '9780321125217', title: 'Domain-Driven Design', author: 'Eric Evans', category: '计算机', cover_id: 14596704 },
  { isbn: '9780321127426', title: 'Patterns of Enterprise Application Architecture', author: 'Martin Fowler', category: '计算机', cover_id: 14596702 },
  { isbn: '9780131177055', title: 'Working Effectively with Legacy Code', author: 'Michael C. Feathers', category: '计算机', cover_id: 7898496 },
  { isbn: '9781680502398', title: 'Release It!: Design and Deploy Production-Ready Software', author: 'Michael T. Nygard', category: '计算机', cover_id: 8509030 },
  { isbn: '9780321601919', title: 'Continuous Delivery', author: 'Jez Humble', category: '计算机', cover_id: 6998977 },
  { isbn: '9781449335588', title: "You Don't Know JS", author: 'Kyle Simpson', category: '计算机', cover_id: 8117575 },
  { isbn: '9781449308841', title: 'JavaScript : the Definitive Guide', author: 'David Flanagan', category: '计算机' },
  {
    isbn: '9780201791204',
    title: 'Effective Java(TM) Programming Language Guide with Java Class Libraries Posters',
    author: 'Joshua Bloch',
    category: '计算机',
    cover_id: 2334826,
    introduction:
      '以条目形式总结 Java 实践经验，覆盖对象创建、泛型、并发、异常与 API 设计等主题，强调编写健壮、易用、可维护的代码。',
  },
  { isbn: '9780596158064', title: 'Learning Python', author: 'Mark Lutz', category: '计算机', cover_id: 6283352 },
  { isbn: '9781491939369', title: 'Think Python', author: 'Allen B. Downey', category: '计算机', cover_id: 8183667 },
  { isbn: '9780321965516', title: "Don't Make Me Think, Revisited", author: 'Steve Krug', category: '计算机', cover_id: 7320872 },
  { isbn: '9781492078005', title: 'Head First Design Patterns', author: 'Eric Freeman', category: '计算机', cover_id: 13345163 },
  { isbn: '9780201835953', title: 'The Mythical Man-Month', author: 'Frederick P. Brooks', category: '计算机', cover_id: 10653425 },
  { isbn: '9780932633057', title: 'Peopleware', author: 'Tom DeMarco', category: '计算机', cover_id: 14418677 },
  { isbn: '9785279004737', title: 'THE C PROGRAMMING LANGUAGE', author: 'Brian W. Kernighan', category: '计算机', cover_id: 13904404 },
  { isbn: '9787111630548', title: '计算机程序的构造和解释（原书第2版）', author: 'Harold Abelson', category: '计算机', cover_id: 14408670 },
  { isbn: '9780201896855', title: 'The Art of Computer Programming: Volume 3', author: 'Donald Knuth', category: '计算机', cover_id: 8057262 },
  { isbn: '9780262035613', title: 'Deep Learning', author: 'Ian Goodfellow', category: '计算机', cover_id: 8183675 },
  { isbn: '9781492032649', title: 'Hands-On Machine Learning with Scikit-Learn, Keras, and TensorFlow', author: 'Aurélien Géron', category: '计算机', cover_id: 9388208 },
  { isbn: '9781491929124', title: 'Site Reliability Engineering', author: 'Betsy Beyer', category: '计算机', cover_id: 8484248 },
  { isbn: '9781942788294', title: 'The Phoenix Project', author: 'Gene Kim', category: '计算机', cover_id: 15532926 },
  { isbn: '9781950508402', title: 'The DevOps handbook', author: 'Gene Kim', category: '计算机', cover_id: 14651180 },
  { isbn: '9788194619093', title: '1984 And Animal Farm', author: 'George Orwell', category: '文学', cover_id: 14019060 },
  { isbn: '9780758777980', title: 'To Kill a Mockingbird', author: 'Harper Lee', category: '文学', cover_id: 15153480 },
  { isbn: '9783730600009', title: 'The Great Gatsby / Der große Gatsby', author: 'F. Scott Fitzgerald', category: '文学', cover_id: 14369845 },
  { isbn: '9787544750264', title: '麦田里的守望者', author: 'J. D. Salinger', category: '文学', cover_id: 15172419 },
  { isbn: '9781648337093', title: 'Pride and Prejudice', author: 'Jane Austen', category: '文学', cover_id: 14665299 },
  { isbn: '9781411403550', title: 'Jane Eyre', author: 'Charlotte Brontë', category: '文学', cover_id: 13363177 },
  { isbn: '9789654825849', title: 'אנקת גבהים', author: 'Emily Brontë', category: '文学' },
  { isbn: '9784566020573', title: '旅の仲間 下', author: 'J.R.R. Tolkien', category: '文学', cover_id: 12607063 },
  { isbn: '9780261103931', title: 'The Lord of the Rings [BOX SET]', author: 'J.R.R. Tolkien', category: '文学', cover_id: 14166496 },
  { isbn: '9786586733501', title: 'Harry Potter e a Pedra Filosofal', author: 'J. K. Rowling', category: '文学', cover_id: 15168707 },
  { isbn: '9781511520348', title: 'Little Prince', author: 'Antoine de Saint-Exupéry', category: '文学', cover_id: 14491562 },
  { isbn: '9780062024329', title: 'The Alchemist', author: 'Paulo Coelho', category: '文学', cover_id: 6751987 },
  { isbn: '9781408845820', title: 'The Kite Runner', author: 'Khaled Hosseini', category: '文学', cover_id: 15162788 },
  { isbn: '9781417797387', title: 'The Book Thief', author: 'Markus Zusak', category: '文学', cover_id: 13826188 },
  { isbn: '9781101658055', title: 'Dune', author: 'Frank Herbert', category: '文学', cover_id: 15122397 },
  { isbn: '9789866385940', title: '使女的故事', author: 'Margaret Atwood', category: '文学', cover_id: 15154675 },
  { isbn: '9788806216467', title: 'Norwegian Wood Tokyo Blues', author: '村上春樹', category: '文学', cover_id: 13172856 },
  { isbn: '9781529432404', title: 'Girl Who Played with Fire', author: 'Stieg Larsson', category: '文学', cover_id: 14723458 },
  { isbn: '9780753827666', title: 'Gone Girl', author: 'Gillian Flynn', category: '文学', cover_id: 14408542 },
  { isbn: '9788580410853', title: 'O Código Da Vinci', author: 'Dan Brown', category: '文学', cover_id: 14630160 },
  { isbn: '9780743424424', title: 'The Shining', author: 'Stephen King', category: '文学', cover_id: 14843732 },
  { isbn: '9781411403772', title: 'The old man and the sea, Ernest Hemingway', author: 'Ernest Hemingway', category: '文学', cover_id: 14344172 },
  { isbn: '9788490277300', title: 'Sapiens', author: 'Yuval Noah Harari', category: '历史', cover_id: 14216844 },
  { isbn: '9787532772322', title: '枪炮、病菌与钢铁', author: 'Jared M. Diamond', category: '历史', cover_id: 14304355 },
  { isbn: '9780553380163', title: 'A Brief History of Time', author: 'Stephen Hawking', category: '历史', cover_id: 14589690 },
  { isbn: '9780553058871', title: 'Hiroshima.', author: 'John Hersey', category: '历史', cover_id: 14606502 },
  { isbn: '9789388810821', title: 'The Diary of A Young Girl', author: 'Anne Frank', category: '历史', cover_id: 14602073 },
  { isbn: '9788408195191', title: 'SPQR', author: 'Mary Beard', category: '历史', cover_id: 12345184 },
  { isbn: '9788373018426', title: 'Powojnie', author: 'Tony Judt', category: '历史', cover_id: 15123601 },
  { isbn: '9781526605320', title: 'Silk Roads', author: 'Peter Frankopan', category: '历史' },
  { isbn: '9780141043722', title: 'Team of Rivals', author: 'Doris Kearns Goodwin', category: '历史', cover_id: 10641285 },
  { isbn: '9780583309073', title: 'The rise and fall of the Third Reich', author: 'William L. Shirer', category: '历史', cover_id: 14945886 },
  { isbn: '9780141019017', title: 'Freakonomics', author: 'Steven D. Levitt', category: '经济', cover_id: 11172914 },
  { isbn: '9781604502855', title: 'The Wealth of Nations', author: 'Adam Smith', category: '经济', cover_id: 12680936 },
  { isbn: '9780670022236', title: 'Capital in the twenty-first century', author: 'Thomas Piketty', category: '经济', cover_id: 7999419 },
  { isbn: '9780060753948', title: 'The Intelligent Investor', author: 'Benjamin Graham', category: '经济', cover_id: 14644907 },
  { isbn: '9781501124020', title: 'Principles', author: 'Ray Dalio', category: '经济', cover_id: 12684572 },
  { isbn: '9788581302821', title: 'A Random Walk Down Wall Street', author: 'Burton G. Malkiel', category: '经济', cover_id: 12678478 },
  { isbn: '9780143126393', title: 'The Big Short', author: 'Michael Lewis', category: '经济', cover_id: 7936986 },
  { isbn: '9780007090389', title: 'Nudge', author: 'Richard H. Thaler', category: '经济', cover_id: 14410710 },
  { isbn: '9780812973815', title: 'The Black Swan', author: 'Nassim Nicholas Taleb', category: '经济', cover_id: 13434725 },
  { isbn: '9780553418286', title: 'Zero to One', author: 'Peter Thiel - undifferentiated', category: '经济', cover_id: 13805758 },
  { isbn: '9788934956150', title: '생각에 관한 생각', author: 'Daniel Kahneman', category: '其他', cover_id: 13449734 },
  { isbn: '9780320087318', title: 'Influence et manipulation', author: 'Robert B. Cialdini', category: '其他' },
  { isbn: '9786075694122', title: 'Hábitos atómicos (Atomic Habits)', author: 'James Clear', category: '其他', cover_id: 13249133 },
  { isbn: '9780385669740', title: 'The power of habit', author: 'Charles Duhigg', category: '其他', cover_id: 12577855 },
  { isbn: '9780807067994', title: "Man's Search for Meaning adapted for Young Adults", author: 'Viktor E. Frankl', category: '其他', cover_id: 15162486 },
  { isbn: '9789350881224', title: 'How To Win Friends & Influence People', author: 'Dale Carnegie', category: '其他', cover_id: 13112610 },
  { isbn: '9781501144165', title: 'Grit', author: 'Angela Duckworth', category: '其他', cover_id: 8899684 },
  { isbn: '9780147509925', title: 'Quiet Power', author: 'Susan Cain', category: '其他', cover_id: 8845710 },
  { isbn: '9780060162535', title: 'Flow the Psychology of Optimal Experience', author: 'Mihaly Csikszentmihalyi', category: '其他', cover_id: 12818990 },
  { isbn: '9781540838223', title: 'Meditations Marcus Aurelius', author: 'Marcus Aurelius', category: '其他', cover_id: 15157092 },
];

function openLibraryCoverById(coverId?: number, size: 'S' | 'M' | 'L' = 'L') {
  if (!Number.isFinite(coverId) || !coverId || coverId <= 0) return '';
  return `https://covers.openlibrary.org/b/id/${encodeURIComponent(String(coverId))}-${size}.jpg`;
}

function dicebearAvatarUrl(seed: string, size = 160) {
  const normalized = String(seed ?? '').trim() || 'user';
  return `https://api.dicebear.com/7.x/adventurer-neutral/png?seed=${encodeURIComponent(normalized)}&size=${size}`;
}

function pad2(num: number) {
  return String(num).padStart(2, '0');
}

function formatLocalDateTime(date: Date) {
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

export async function seedDemoDataIfEmpty() {
  if (!env.seedDemoData) return;

  const [booksCount, usersCount, borrowsCount] = await Promise.all([
    booksCol().countDocuments(),
    usersCol().countDocuments(),
    borrowsCol().countDocuments(),
  ]);

  // 1) 图书：仅在空库时插入
  if (booksCount === 0) {
    const baseTimeMs = Date.UTC(2026, 1, 27, 8, 0, 0);
    const docs: BookDoc[] = SEED_BOOKS.slice(0, 60).map((meta, idx) => {
      const total_stock = 3 + (idx % 10);
      const created_at = new Date(baseTimeMs - idx * 86_400_000);
      return {
        _id: new ObjectId(),
        isbn: meta.isbn,
        title: meta.title,
        author: meta.author,
        introduction: meta.introduction ?? '',
        category: meta.category,
        cover_url: openLibraryCoverById(meta.cover_id, 'L'),
        total_stock,
        current_stock: total_stock,
        is_deleted: idx % 17 === 0,
        created_at,
      };
    });
    await booksCol().insertMany(docs);
  }

  // 2) 用户：仅在“只有内置账号”的场景补齐
  if (usersCount <= 2) {
    const password = await hashPassword('123456');
    const baseTimeMs = Date.UTC(2026, 0, 20, 8, 0, 0);
    const namePool = [
      'lihua',
      'wangwei',
      'zhangmin',
      'chenxi',
      'liyang',
      'sunhao',
      'zhaolei',
      'yangfan',
      'lixin',
      'zhouyu',
      'wuming',
      'xiaoyu',
      'linjie',
      'hanmeimei',
      'lilei',
      'xiaoming',
      'xiaohong',
      'jacky',
      'lucy',
      'mike',
    ] as const;

    const existing = await usersCol()
      .find({}, { projection: { username_lower: 1 } })
      .toArray();
    const existingLower = new Set(existing.map((u) => String(u.username_lower ?? '').trim()));

    const docs: UserDoc[] = [];
    for (let i = 1; i <= 58; i += 1) {
      const baseName = namePool[i % namePool.length] ?? 'reader';
      const username = `${baseName}${String(i).padStart(2, '0')}`;
      const username_lower = username.toLowerCase();
      if (!username_lower || existingLower.has(username_lower)) continue;

      const role = i % 9 === 0 ? ('admin' as const) : ('user' as const);
      const status = i % 10 === 0 ? (0 as const) : (1 as const);
      const credit_score = 60 + (i % 41);
      const created_at = new Date(baseTimeMs - i * 86_400_000);

      docs.push({
        _id: new ObjectId(),
        username,
        username_lower,
        phone: `18${String(100000000 + i)}`,
        role,
        status,
        credit_score,
        avatar: dicebearAvatarUrl(username),
        created_at,
        // demo：为了加快启动速度，seed 用户复用同一个 hash/salt
        password_hash: password.hash,
        password_salt: password.salt,
      });
    }

    if (docs.length > 0) {
      await usersCol().insertMany(docs);
    }
  }

  // 3) 借阅记录：仅在空库时插入（并同步扣减库存）
  if (borrowsCount === 0) {
    const users = await usersCol()
      .find({ status: 1 }, { projection: { username: 1 } })
      .sort({ created_at: -1 })
      .limit(80)
      .toArray();

    const books = await booksCol()
      .find({ is_deleted: false }, { projection: { isbn: 1, title: 1, total_stock: 1 } })
      .sort({ created_at: -1 })
      .limit(80)
      .toArray();

    const userList = users.filter((u) => u.username).map((u) => u as UserDoc);
    const bookList = books.filter((b) => b.isbn && b.title).map((b) => b as BookDoc);
    if (userList.length === 0 || bookList.length === 0) return;

    const base = new Date();
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;

    const docs: BorrowDoc[] = [];
    const activePairs = new Set<string>();

    function addRecord(input: {
      user: UserDoc;
      book: BookDoc;
      status: BorrowDoc['status'];
      borrow_date: Date;
      due_date: Date;
      return_date?: Date;
      borrow_days: number;
      fine_amount: number;
    }) {
      const recordId = new ObjectId();
      const created_at = input.borrow_date;
      const updated_at = input.return_date ?? input.borrow_date;
      docs.push({
        _id: recordId,
        record_id: recordId.toHexString(),
        user_id: input.user._id.toHexString(),
        username: input.user.username,
        book_id: `B-${input.book.isbn}`,
        isbn: input.book.isbn,
        book_title: input.book.title,
        status: input.status,
        borrow_date: input.borrow_date,
        due_date: input.due_date,
        return_date: input.return_date,
        borrow_days: input.borrow_days,
        fine_amount: input.fine_amount,
        created_at,
        updated_at,
      });
    }

    // 固定几条典型状态，便于页面展示/筛选
    {
      const u = userList[0]!;
      const b = bookList[0]!;
      const borrow_date = new Date(base.getTime() - 3 * dayMs);
      const borrow_days = 30;
      const due_date = new Date(borrow_date.getTime() + borrow_days * dayMs);
      activePairs.add(`${u._id}:${b.isbn}`);
      addRecord({ user: u, book: b, status: 'borrowed', borrow_date, due_date, borrow_days, fine_amount: 0 });
    }
    {
      const u = userList[1] ?? userList[0]!;
      const b = bookList[1] ?? bookList[0]!;
      const borrow_date = new Date(base.getTime() - 35 * dayMs);
      const borrow_days = 14;
      const due_date = new Date(borrow_date.getTime() + borrow_days * dayMs);
      const return_date = new Date(borrow_date.getTime() + 10 * dayMs);
      addRecord({ user: u, book: b, status: 'returned', borrow_date, due_date, return_date, borrow_days, fine_amount: 0 });
    }
    {
      // 逾期未归还：用于测试借书限制（fine_amount > 0）
      const u = userList[2] ?? userList[0]!;
      const b = bookList[2] ?? bookList[0]!;
      const borrow_date = new Date(base.getTime() - 25 * dayMs);
      const borrow_days = 7;
      const due_date = new Date(borrow_date.getTime() + borrow_days * dayMs);
      activePairs.add(`${u._id}:${b.isbn}`);
      addRecord({ user: u, book: b, status: 'borrowed', borrow_date, due_date, borrow_days, fine_amount: 10 });
    }
    {
      const u = userList[3] ?? userList[0]!;
      const b = bookList[3] ?? bookList[0]!;
      const borrow_date = new Date(base.getTime() - 2 * dayMs);
      const borrow_days = 3;
      const due_date = new Date(borrow_date.getTime() + borrow_days * dayMs);
      activePairs.add(`${u._id}:${b.isbn}`);
      addRecord({ user: u, book: b, status: 'reserved', borrow_date, due_date, borrow_days, fine_amount: 0 });
    }
    {
      const u = userList[4] ?? userList[0]!;
      const b = bookList[4] ?? bookList[0]!;
      const borrow_date = new Date(base.getTime() - 10 * dayMs);
      const borrow_days = 14;
      const due_date = new Date(borrow_date.getTime() + borrow_days * dayMs);
      addRecord({ user: u, book: b, status: 'canceled', borrow_date, due_date, borrow_days, fine_amount: 0 });
    }

    // 批量生成更多记录（尽量分散到不同用户/不同图书），尽量补齐到 80 条
    let attempts = 0;
    while (docs.length < 80 && attempts < 500) {
      attempts += 1;
      const i = docs.length + attempts;

      const user = userList[(i * 7) % userList.length]!;
      const book = bookList[(i * 11) % bookList.length]!;
      const pairKey = `${user._id}:${book.isbn}`;

      const borrow_date = new Date(base.getTime() - (i + 1) * 36 * 60 * 60 * 1000);
      const borrow_days = 7 + (i % 30);
      const due_date = new Date(borrow_date.getTime() + borrow_days * dayMs);

      const roll = i % 20;
      const status: BorrowDoc['status'] =
        roll === 0 ? 'canceled' : roll <= 2 ? 'reserved' : 'borrowed';

      const shouldReturn = status === 'borrowed' && i % 3 === 0;
      const return_date = shouldReturn
        ? new Date(borrow_date.getTime() + (2 + (i % 10)) * dayMs)
        : undefined;

      // 只对极少数逾期记录打上罚金，避免 demo 数据“所有用户都借不了书”
      const willBeOverdue =
        !return_date && status !== 'canceled' && now.getTime() > due_date.getTime();
      const fine_amount = willBeOverdue && i % 37 === 0 ? 5 + (i % 20) : 0;

      // 对于“未归还记录”，避免同一用户同一本书重复出现（会影响借书体验）
      if (!return_date && status !== 'canceled' && activePairs.has(pairKey)) continue;
      if (!return_date && status !== 'canceled') activePairs.add(pairKey);

      addRecord({
        user,
        book,
        status,
        borrow_date,
        due_date,
        return_date,
        borrow_days,
        fine_amount,
      });
    }

    if (docs.length > 0) {
      await borrowsCol().insertMany(docs);
    }

    // 扣减库存：未归还且非 canceled 的记录视为占用 1 本库存
    const activeByIsbn = new Map<string, number>();
    for (const r of docs) {
      if (r.return_date) continue;
      if (r.status === 'canceled') continue;
      activeByIsbn.set(r.isbn, (activeByIsbn.get(r.isbn) ?? 0) + 1);
    }

    for (const [isbn, count] of activeByIsbn.entries()) {
      // pipeline 更新：current_stock = max(0, min(total_stock, current_stock - count))
      await booksCol().updateOne(
        { isbn } as any,
        [
          {
            $set: {
              current_stock: {
                $max: [
                  0,
                  {
                    $min: [
                      '$total_stock',
                      { $subtract: ['$current_stock', count] },
                    ],
                  },
                ],
              },
            },
          },
        ] as any,
      );
    }

    // 仅日志：便于排查（不影响功能）
    // eslint-disable-next-line no-console
    console.log(
      `[seed] demo borrows inserted=${docs.length}, sampleDue=${formatLocalDateTime(
        docs[0]?.due_date ?? new Date(),
      )}`,
    );
  }
}
