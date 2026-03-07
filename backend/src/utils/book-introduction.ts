export const INTRODUCTION_MAX_LEN = 300;

export type BookIntroSource = 'template' | 'openlibrary' | 'mixed';

export type BookLike = {
  isbn?: string;
  title?: string;
  author?: string;
  category?: string;
};

const TEST_CJK_KEYWORDS_RE = /测试|前导0|占位/i;
const TEST_EN_KEYWORDS_RE = /\b(test|demo|mock)\b/i;

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

export function isTestBookCandidate(book: BookLike) {
  const isbn = normalizeText(book.isbn);
  const title = normalizeText(book.title);
  const author = normalizeText(book.author);
  if (TEST_CJK_KEYWORDS_RE.test(isbn) || TEST_EN_KEYWORDS_RE.test(isbn)) return true;
  if (TEST_CJK_KEYWORDS_RE.test(title) || TEST_EN_KEYWORDS_RE.test(title)) return true;
  if (TEST_CJK_KEYWORDS_RE.test(author) || TEST_EN_KEYWORDS_RE.test(author)) return true;
  if (isbn === '0123456789012') return true;
  if (author.toLowerCase() === 'zero') return true;
  return false;
}

function sanitizeSingleLine(text: string) {
  return text
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/[\r\n\t]+/g, ' ')
    .replaceAll(/\s{2,}/g, ' ')
    .trim();
}

export function truncateIntroduction(text: string, maxLen = INTRODUCTION_MAX_LEN) {
  const normalized = sanitizeSingleLine(text);
  if (normalized.length <= maxLen) return normalized;
  return normalized.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '…';
}

const INTRO_OVERRIDES_BY_ISBN: Record<string, string> = {
  '9780136083252':
    '软件工匠经典之作，围绕命名、函数、注释、代码坏味道与重构等主题，给出可操作的编码与评审建议，帮助提升可读性与可维护性。',
  '9780134494326':
    '从设计原则与架构边界出发，讲解如何让业务规则独立于框架、UI 与数据库，通过分层与依赖倒置实现可测试、可演进的系统结构。',
  '9780201485677':
    '系统讲解在不改变外部行为的前提下改进代码结构的方法，包含常见重构手法与示例，强调通过小步改动和测试支撑持续演进。',
  '9783826697005':
    '“GoF 设计模式”代表作，总结创建型、结构型、行为型等经典模式及其适用场景，用统一语言描述可复用的面向对象设计经验。',
  '9780201791204':
    '以条目形式总结 Java 实践经验，覆盖对象创建、泛型、并发、异常与 API 设计等主题，强调编写健壮、易用、可维护的代码。',
};

function buildIntroByCategory(book: Required<Pick<BookLike, 'author' | 'category' | 'title'>>) {
  const titleLower = book.title.toLowerCase();
  const author = book.author;
  const category = book.category;

  const prefix = `《${book.title}》${author ? `（${author}）` : ''}：`;

  if (category === '计算机') {
    if (titleLower.includes('algorithm')) {
      return `${prefix}系统梳理常见算法与数据结构，强调复杂度分析与工程实现，适合作为课程学习与面试复习的参考。`;
    }
    if (titleLower.includes('refactor')) {
      return `${prefix}围绕重构方法与代码坏味道，讲解如何通过小步安全改动持续改善代码结构与可读性。`;
    }
    if (titleLower.includes('design pattern')) {
      return `${prefix}介绍常用设计模式的动机、结构与适用场景，帮助在设计中提高复用性与扩展性。`;
    }
    if (titleLower.includes('domain-driven')) {
      return `${prefix}围绕领域建模、限界上下文与分层架构，给出面向复杂业务的设计方法与实践路径。`;
    }
    if (titleLower.includes('continuous delivery') || titleLower.includes('devops')) {
      return `${prefix}聚焦持续交付与工程化实践，覆盖自动化测试、发布流水线与变更管理等关键环节。`;
    }
    if (titleLower.includes('javascript')) {
      return `${prefix}围绕 JavaScript 核心机制与工程实践展开，帮助夯实语言基础并提升编写高质量代码的能力。`;
    }
    if (titleLower.includes('python')) {
      return `${prefix}从语法基础到实践案例逐步展开，适合用于快速入门并建立编程思维与工程习惯。`;
    }
    if (titleLower.includes('deep learning')) {
      return `${prefix}介绍深度学习的核心概念、常见模型与训练方法，适合系统了解该领域的基础框架与实践要点。`;
    }
    if (titleLower.includes('machine learning')) {
      return `${prefix}以实践为导向讲解机器学习常用方法与工具链，覆盖特征工程、模型训练与评估等关键流程。`;
    }
    return `${prefix}面向开发者的技术读物，围绕工程实践与设计方法展开，适合用于提升代码质量与系统设计能力。`;
  }

  if (category === '文学') {
    if (titleLower.includes('1984')) {
      return `${prefix}反乌托邦题材代表作，通过极端社会设定讨论权力、自由与个人意志，具有强烈的思想冲击力。`;
    }
    if (titleLower.includes('mockingbird')) {
      return `${prefix}以小镇案件为线索探讨偏见与正义，兼具成长视角与社会批判，情感细腻而有力量。`;
    }
    if (titleLower.includes('gatsby')) {
      return `${prefix}以繁华年代的爱情与幻灭为主题，呈现理想与现实的冲突，语言凝练而富象征意味。`;
    }
    if (titleLower.includes('pride') && titleLower.includes('prejudice')) {
      return `${prefix}以婚恋与阶层为背景刻画人物性格与观念冲突，节奏明快、讽刺与温情并存。`;
    }
    if (titleLower.includes('jane eyre')) {
      return `${prefix}以女性成长与自我尊严为主线，融合爱情与社会现实描写，塑造了坚韧独立的主人公形象。`;
    }
    if (titleLower.includes('lord of the rings') || titleLower.includes('harry potter')) {
      return `${prefix}经典奇幻题材作品，构建宏大世界观与人物群像，兼具冒险叙事与成长主题。`;
    }
    if (titleLower.includes('little prince')) {
      return `${prefix}寓言式叙事，通过童真的视角讨论爱、责任与成长，文字简洁却耐人寻味。`;
    }
    if (titleLower.includes('dune')) {
      return `${prefix}科幻史上的重要作品，融合政治、宗教与生态设定，展开关于权力与命运的宏大叙事。`;
    }
    return `${prefix}文学类作品，围绕人物命运与时代背景展开叙事，适合用来感受不同文化语境下的情感与价值观。`;
  }

  if (category === '历史') {
    if (titleLower.includes('sapiens')) {
      return `${prefix}以宏观视角梳理人类社会演进脉络，讨论认知革命、农业革命与现代化进程对文明的塑造。`;
    }
    if (book.title.includes('枪炮') || titleLower.includes('germs') || titleLower.includes('steel')) {
      return `${prefix}从地理与环境等因素解释不同地区发展差异，覆盖农业、技术扩散与社会结构等关键议题。`;
    }
    return `${prefix}以历史事件与人物为线索梳理时代变迁，兼顾背景解读与观点呈现，适合作为历史阅读与思考的入门参考。`;
  }

  if (category === '经济') {
    if (titleLower.includes('freakonomics')) {
      return `${prefix}用通俗案例解释经济学思维，强调激励机制与数据分析，带你从“反常识”的角度理解日常现象。`;
    }
    if (titleLower.includes('wealth of nations')) {
      return `${prefix}古典经济学重要著作，讨论分工、市场与政策等主题，对现代经济思想的形成具有奠基意义。`;
    }
    if (titleLower.includes('investor') || titleLower.includes('random walk') || titleLower.includes('big short')) {
      return `${prefix}围绕投资与金融市场展开，强调风险控制与长期视角，帮助建立更理性的决策框架。`;
    }
    if (titleLower.includes('nudge')) {
      return `${prefix}行为经济学代表作之一，探讨如何通过“助推”机制影响选择，在不强制的前提下改善决策结果。`;
    }
    if (titleLower.includes('black swan')) {
      return `${prefix}讨论不确定性与极端事件对世界的影响，强调对风险与预测局限性的认知，启发更稳健的思考方式。`;
    }
    if (titleLower.includes('zero to one')) {
      return `${prefix}围绕创新与创业提出观点，讨论从“复制”到“创造”的路径，适合用于启发产品与商业思考。`;
    }
    return `${prefix}经济与管理类读物，围绕市场、投资或决策展开，帮助建立更系统的分析框架与实践方法。`;
  }

  // 其他
  if (titleLower.includes('habit')) {
    return `《${book.title}》${author ? `（${author}）` : ''}：围绕习惯形成与改变的机制展开，提供可执行的策略与步骤，帮助建立长期可持续的行为系统。`;
  }
  if (titleLower.includes('influence') || titleLower.includes('manipulation')) {
    return `《${book.title}》${author ? `（${author}）` : ''}：从心理学与社会影响出发总结常见说服与影响原理，帮助识别操控并提升沟通与决策能力。`;
  }
  if (titleLower.includes('flow')) {
    return `《${book.title}》${author ? `（${author}）` : ''}：讨论“心流”体验的条件与意义，解释如何在专注中获得更高的投入感与满足感。`;
  }
  if (titleLower.includes('meditations')) {
    return `《${book.title}》${author ? `（${author}）` : ''}：以格言与随想的形式记录自我修炼与处世思考，强调克制、责任与内在秩序。`;
  }
  return `《${book.title}》${author ? `（${author}）` : ''}：通识类读物，围绕核心概念与实践建议展开，适合用于拓展视野与建立基础认知。`;
}

export function generateBookIntroduction(input: BookLike, topics?: string[]) {
  const isbn = normalizeText(input.isbn);
  const title = normalizeText(input.title);
  const author = normalizeText(input.author);
  const category = normalizeText(input.category);
  if (!title) return '';
  if (isTestBookCandidate({ isbn, title, author })) return '';

  const override = isbn ? INTRO_OVERRIDES_BY_ISBN[isbn] : undefined;
  let intro = override ?? buildIntroByCategory({ author, category, title });

  if (topics && topics.length > 0) {
    const suffix = `（涉及：${topics.slice(0, 3).join('、')}）`;
    intro = intro.length + suffix.length <= INTRODUCTION_MAX_LEN ? intro + suffix : intro;
  }

  return truncateIntroduction(intro, INTRODUCTION_MAX_LEN);
}
