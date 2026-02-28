export type UserRole = 'admin' | 'user';
export type UserStatus = 0 | 1;

export interface LibraryUser {
  _id: string;
  avatar?: string;
  created_at: string;
  credit_score: number;
  password: string;
  role: UserRole;
  status: UserStatus;
  username: string;
}

export const DEFAULT_PASSWORD = '123456';
export const PROTECTED_USERNAMES = new Set(['admin', 'vben']);

function dicebearAvatarUrl(seed: string, size = 160) {
  const normalized = String(seed ?? '').trim() || 'user';
  return `https://api.dicebear.com/7.x/adventurer-neutral/png?seed=${encodeURIComponent(normalized)}&size=${size}`;
}

function normalizeText(input: unknown) {
  return String(input ?? '').trim().toLowerCase();
}

function toNumber(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function generateMoreUsers(count: number, startSeq: number): LibraryUser[] {
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
  return Array.from({ length: count }, (_, idx) => {
    const seq = startSeq + idx;
    const role: UserRole = seq % 9 === 0 ? 'admin' : 'user';
    const status: UserStatus = seq % 10 === 0 ? 0 : 1;
    const credit_score = 60 + (seq % 41);
    const created_at = new Date(baseTimeMs - seq * 86_400_000).toISOString();
    const baseName = namePool[seq % namePool.length] ?? 'reader';
    const username = `${baseName}${String(seq).padStart(2, '0')}`;
    return {
      _id: `U-${1000 + seq}`,
      avatar: dicebearAvatarUrl(username),
      created_at,
      credit_score,
      password: DEFAULT_PASSWORD,
      role,
      status,
      username,
    };
  });
}

const baseUsers: LibraryUser[] = [
  {
    _id: 'U-1001',
    avatar: dicebearAvatarUrl('admin'),
    created_at: '2026-01-05T10:00:00.000Z',
    credit_score: 100,
    password: DEFAULT_PASSWORD,
    role: 'admin',
    status: 1,
    username: 'admin',
  },
  {
    _id: 'U-1002',
    avatar: dicebearAvatarUrl('vben'),
    created_at: '2026-01-08T08:30:00.000Z',
    credit_score: 100,
    password: DEFAULT_PASSWORD,
    role: 'user',
    status: 1,
    username: 'vben',
  },
  {
    _id: 'U-1003',
    avatar: dicebearAvatarUrl('lihua01'),
    created_at: '2026-01-10T12:20:00.000Z',
    credit_score: 90,
    password: DEFAULT_PASSWORD,
    role: 'user',
    status: 0,
    username: 'lihua01',
  },
  {
    _id: 'U-1004',
    avatar: dicebearAvatarUrl('chenxi02'),
    created_at: '2026-01-15T09:12:00.000Z',
    credit_score: 100,
    password: DEFAULT_PASSWORD,
    role: 'user',
    status: 1,
    username: 'chenxi02',
  },
];

const initialUsers: LibraryUser[] = [
  ...baseUsers,
  ...generateMoreUsers(Math.max(0, 60 - baseUsers.length), 5),
];

let users: LibraryUser[] = structuredClone(initialUsers);

export function resetUsers() {
  users = structuredClone(initialUsers);
}

export function listUsers() {
  return structuredClone(users);
}

export function findUserByUsername(username: string) {
  const normalized = normalizeText(username);
  if (!normalized) return null;
  return users.find((u) => normalizeText(u.username) === normalized) ?? null;
}

export function findUserById(id: string) {
  const normalized = String(id ?? '').trim();
  return users.find((u) => u._id === normalized) ?? null;
}

export function isProtectedUser(user: Pick<LibraryUser, 'username'>) {
  return PROTECTED_USERNAMES.has(normalizeText(user.username));
}

export function filterUsers(
  all: LibraryUser[],
  filters: {
    createdEnd?: number;
    createdStart?: number;
    role?: unknown;
    status?: unknown;
    username?: unknown;
  },
) {
  const username = normalizeText(filters.username);
  const role = String(filters.role ?? 'all').trim() || 'all';
  const statusRaw = filters.status ?? 'all';
  const status =
    statusRaw === 0 || statusRaw === 1 || statusRaw === '0' || statusRaw === '1'
      ? Number(statusRaw)
      : String(statusRaw).trim();

  const createdStart = Number.isFinite(filters.createdStart as number)
    ? (filters.createdStart as number)
    : null;
  const createdEnd = Number.isFinite(filters.createdEnd as number)
    ? (filters.createdEnd as number)
    : null;

  return all
    .filter((user) => {
      if (username && !normalizeText(user.username).includes(username)) return false;
      if (role !== 'all' && user.role !== role) return false;
      if (status !== 'all' && user.status !== status) return false;

      if (createdStart !== null && createdEnd !== null) {
        const ms = new Date(user.created_at).getTime();
        if (!Number.isFinite(ms) || ms < createdStart || ms > createdEnd) return false;
      }

      return true;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function createUser(input: {
  avatar?: string;
  credit_score?: unknown;
  role?: unknown;
  status?: unknown;
  username?: unknown;
}) {
  const username = String(input.username ?? '').trim();
  if (!username) {
    return { error: '用户名不能为空', user: null as LibraryUser | null };
  }

  const normalizedUsername = normalizeText(username);
  if (PROTECTED_USERNAMES.has(normalizedUsername)) {
    return { error: '用户名不可用', user: null as LibraryUser | null };
  }

  if (users.some((u) => normalizeText(u.username) === normalizedUsername)) {
    return { error: '用户名已存在', user: null as LibraryUser | null };
  }

  const role = (String(input.role ?? 'user') === 'admin' ? 'admin' : 'user') as UserRole;
  const status: UserStatus = String(input.status ?? '1') === '0' ? 0 : 1;

  const creditScoreRaw = input.credit_score ?? 100;
  const credit_score = toNumber(creditScoreRaw);
  if (!Number.isFinite(credit_score) || credit_score < 0) {
    return { error: '信用积分必须是非负数', user: null as LibraryUser | null };
  }

  const nextIdNum = Math.max(
    1005,
    ...users
      .map((u) => Number(String(u._id).replace(/^U-/, '')))
      .filter((n) => Number.isFinite(n)),
  ) + 1;

  const user: LibraryUser = {
    _id: `U-${nextIdNum}`,
    avatar: String(input.avatar ?? '').trim() || '/avatars/avatar-placeholder.svg',
    created_at: new Date().toISOString(),
    credit_score,
    password: DEFAULT_PASSWORD,
    role,
    status,
    username,
  };

  users.unshift(user);
  return { error: null, user };
}

export function updateUser(
  id: string,
  patch: Partial<Pick<LibraryUser, 'avatar' | 'credit_score' | 'role' | 'status' | 'username'>>,
) {
  const targetId = String(id ?? '').trim();
  const index = users.findIndex((u) => u._id === targetId);
  if (index < 0) return { error: '未找到用户', user: null as LibraryUser | null };

  const existing = users[index]!;
  const protectedUser = isProtectedUser(existing);

  const nextUsername = String(patch.username ?? existing.username).trim();
  const nextRole = (String(patch.role ?? existing.role) === 'admin' ? 'admin' : 'user') as UserRole;
  const nextStatus: UserStatus = String(patch.status ?? existing.status) === '0' ? 0 : 1;

  if (protectedUser) {
    if (normalizeText(nextUsername) !== normalizeText(existing.username)) {
      return { error: '内置账号禁止修改用户名', user: null as LibraryUser | null };
    }
    if (nextRole !== existing.role) {
      return { error: '内置账号禁止修改角色', user: null as LibraryUser | null };
    }
    if (nextStatus !== existing.status) {
      return { error: '内置账号禁止冻结/解冻', user: null as LibraryUser | null };
    }
  }

  if (
    normalizeText(nextUsername) !== normalizeText(existing.username) &&
    users.some((u) => normalizeText(u.username) === normalizeText(nextUsername) && u._id !== existing._id)
  ) {
    return { error: '用户名已存在', user: null as LibraryUser | null };
  }

  const creditScoreRaw = patch.credit_score ?? existing.credit_score;
  const credit_score = toNumber(creditScoreRaw);
  if (!Number.isFinite(credit_score) || credit_score < 0) {
    return { error: '信用积分必须是非负数', user: null as LibraryUser | null };
  }

  const next: LibraryUser = {
    ...existing,
    avatar: String(patch.avatar ?? existing.avatar ?? '').trim() || '/avatars/avatar-placeholder.svg',
    credit_score,
    role: nextRole,
    status: nextStatus,
    username: nextUsername,
  };

  users[index] = next;
  return { error: null, user: next };
}

export function resetUserPassword(id: string) {
  const targetId = String(id ?? '').trim();
  const index = users.findIndex((u) => u._id === targetId);
  if (index < 0) return { error: '未找到用户' };
  const existing = users[index]!;
  if (isProtectedUser(existing)) {
    return { error: '内置账号禁止重置密码' };
  }
  users[index] = { ...existing, password: DEFAULT_PASSWORD };
  return { error: null };
}

export function deleteUser(id: string) {
  const targetId = String(id ?? '').trim();
  const index = users.findIndex((u) => u._id === targetId);
  if (index < 0) return { error: '未找到用户' };
  const existing = users[index]!;
  if (isProtectedUser(existing)) {
    return { error: '内置账号禁止删除' };
  }
  users.splice(index, 1);
  return { error: null };
}
