# LibraryManagementSystem 后端接口契约（基于当前 mock）

本文档用于：你在开发真实后端（`backend/`）时，**按当前 mock 的接口形态与字段**实现同名接口，从而让前端无需改动即可切换到真实后端。

> 约定：本文档中的路径均以 `/api` 为前缀（前端开发时 `Vite proxy` 会把 `/api/*` 代理到 mock/后端）。

---

## 1. 基础约定

### 1.1 Base URL

- 开发环境前端请求前缀：`/api`
- 真实后端建议直接提供：`http(s)://<host>/api/*`

### 1.2 鉴权

除 `/auth/login`、`/auth/refresh`、`/auth/logout` 外，其他业务接口默认需要：

- `Authorization: Bearer <accessToken>`

未携带/无效 token：

- HTTP `401`

### 1.3 通用响应结构（requestClient 解包）

前端 `requestClient` 通过拦截器按以下结构解包 `data`，成功码 `code === 0`：

```json
{
  "code": 0,
  "data": {},
  "error": null,
  "message": "ok"
}
```

失败示例（`code === -1`）：

```json
{
  "code": -1,
  "data": null,
  "error": "xxx",
  "message": "SomeErrorType"
}
```

### 1.4 分页结构

列表接口统一返回：

```json
{
  "items": [],
  "total": 0
}
```

分页参数：

- `page`: number，默认 1
- `pageSize`: number，默认 10/20（前端常用 20），建议后端限制最大 100

### 1.5 时间筛选参数（毫秒时间戳）

借阅、用户列表的时间范围筛选使用 epoch 毫秒（`number`）：

- `createdStart` / `createdEnd`
- `borrowStart` / `borrowEnd`
- `returnStart` / `returnEnd`

约定：

- 后端按“闭区间”处理：`start <= ms <= end`
- 前端在“只选日期（YYYY-MM-DD）”时，会把 `end` 自动扩展到当天 `23:59:59.999`

---

## 2. 认证与基础信息（前端登录必需）

### 2.1 登录

`POST /api/auth/login`

请求体：

```json
{
  "username": "admin",
  "password": "123456"
}
```

成功响应（通用结构，`data` 中至少包含 `accessToken`）：

```json
{
  "code": 0,
  "data": {
    "accessToken": "xxx"
  },
  "error": null,
  "message": "ok"
}
```

失败：

- HTTP `403`（用户名或密码错误）

### 2.2 刷新 accessToken（cookie）

`POST /api/auth/refresh`

说明：

- 前端用的是 `baseRequestClient` 调用（不走通用响应解包拦截器）
- 请求会携带 cookie（`withCredentials: true`）
- **刷新成功后旧的 `accessToken` 会立即失效**（服务端会话内的 `access_token` 会被替换/轮换），前端需要用返回的新 token 覆盖本地 token；继续使用旧 token 访问业务接口会返回 `401`
- 当前实现仅刷新 `accessToken`（refresh token 仍保存在 cookie 中且不随该接口返回更新）

响应体：**直接返回新的 accessToken 字符串**（非通用结构）

```text
<accessToken>
```

失败：

- HTTP `403`（refresh token 不存在/无效）

### 2.3 退出登录（清理 refresh cookie）

`POST /api/auth/logout`

- 前端不依赖返回体（可返回通用结构或空字符串）

### 2.4 获取权限码

`GET /api/auth/codes`

成功返回 `string[]`（通用结构解包后就是数组）：

```json
["AC_100100", "AC_100110"]
```

### 2.5 获取用户信息

`GET /api/user/info`

成功返回用户信息对象（字段以前端 `@vben/types` 的 `UserInfo` 为准），至少需要：

- `username`
- `realName`
- `phone`（国内手机号，前端用于“个人中心-安全设置”展示，建议后端始终返回）
- `roles: string[]`
- `homePath?: string`

### 2.6 获取菜单

`GET /api/menu/all`

返回路由记录数组（字段结构以 `@vben/types` 的 `RouteRecordStringComponent[]` 为准）。

---

### 2.7 上传文件（本地存储）

> 用途：图书封面（`books.cover_url`）、用户头像等需要“上传后可被浏览器直接访问”的场景。
>
> 说明：由于 `<img src>` 无法自动携带 `Authorization`，上传后的文件通过 **公开** 的 `/api/uploads/*` 访问。

#### 2.7.1 上传

`POST /api/upload`

Body（JSON）：

```ts
type UploadBody = {
  // base64 dataUrl：data:image/png;base64,xxxx
  dataUrl: string;
};
```

响应（data 解包后）：

```ts
type UploadResponseData = {
  url: string; // 例如：/api/uploads/1700000000000-xxxx.webp
};
```

约束：

- 仅支持 `png/jpg/webp/gif` 的 base64 dataUrl

#### 2.7.2 读取上传文件（公开）

`GET /api/uploads/:file`

返回对应图片二进制内容（`Content-Type` 根据后缀设置）。

---

## 3. 图书管理（Books）

### 3.1 列表分页/筛选

`GET /api/books`

Query：

- `page`, `pageSize`
- `title?`, `author?`, `isbn?`, `category?`
- `status?`: `'all' | 'normal' | 'deleted'`
- `sortBy?`: `'created_at'`（可选）
- `sortOrder?`: `'asc' | 'desc'`（可选，默认 desc）

响应（通用结构 data 解包后）：

```ts
type BooksListResponseData = {
  items: Array<{
    isbn: string;
    title: string;
    author: string;
    category: string;
    cover_url: string;
    total_stock: number;
    current_stock: number;
    is_deleted: boolean;
    created_at: string; // ISO
  }>;
  total: number;
};
```

### 3.2 新增图书

`POST /api/books`

Body：

```ts
type CreateBookBody = {
  isbn: string;
  title: string;
  author: string;
  category: string;
  cover_url: string;
  total_stock: number;    // >= 0
  current_stock: number;  // >= 0 且 <= total_stock
};
```

错误约束（建议与 mock 一致）：

- 400：字段为空 / `total_stock` 不合法 / `current_stock` 不合法 / `current_stock > total_stock`
- 409：ISBN 已存在

### 3.3 编辑图书

`PUT /api/books/:isbn`

Body 同新增。

错误：

- 400：参数不合法
- 404：未找到原 ISBN
- 409：将 ISBN 修改为已存在的 ISBN

### 3.4 上/下架（软删除）

`PUT /api/books/:isbn/shelf`

Body：

```json
{ "is_deleted": true }
```

说明：

- 只改变 `is_deleted`，**不物理删除**
- 下架后的书不可借阅（借书接口会返回冲突）

错误：

- 404：未找到图书

### 3.5 ISBN 查询（借书抽屉查询用）

`GET /api/books/:isbn`

返回（用于借书时自动填充）：

```ts
type BookByIsbnResponseData = {
  book_id: string;        // `B-${isbn}`
  isbn: string;
  title: string;
  total_stock: number;
  current_stock: number;
};
```

### 3.6 Excel 导入预览（批量入库）

`POST /api/books/import/preview`

用途：上传 Excel，由后端解析并返回“预览数据 + 行级校验结果”，前端用于展示确认。

Body：

```ts
type BooksImportPreviewBody = {
  // base64 dataUrl（FileReader.readAsDataURL）
  dataUrl: string;
  filename?: string;
};
```

Excel 模板列（第一行表头，字段名大小写不敏感）：

- `isbn`（必填）
- `title`（新书必填；老书可空）
- `author`（新书必填；老书可空）
- `category`（新书必填；老书可空）
- `cover_url`（可空，线上图片 URL）
- `add_stock`（必填，>= 1，本次入库数量）

响应（data 解包后）：

```ts
type BooksImportPreviewResponseData = {
  import_id: string;
  rows: Array<{
    row_number: number; // Excel 行号（从 2 开始，表头为第 1 行）
    isbn: string;
    title: string;
    author: string;
    category: string;
    cover_url: string;
    add_stock: number;
    exists: boolean;
    existing_is_deleted: boolean;
    is_valid: boolean;
    errors: string[];
  }>;
  summary: {
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
    existing_rows: number;
    new_rows: number;
  };
};
```

### 3.7 Excel 导入提交（批量入库）

`POST /api/books/import/commit`

Body：

```ts
type BooksImportCommitBody = {
  import_id: string;
  // 处理重复 ISBN 的策略（仅对“Excel 行命中老书”生效）
  conflict_strategy: 'increment_stock' | 'skip' | 'overwrite';
  // 命中老书且本次 add_stock > 0 时是否自动上架（默认 true）
  auto_unshelf?: boolean;
};
```

响应（data 解包后）：

```ts
type BooksImportCommitResponseData = {
  summary: {
    created: number;
    incremented: number;
    overwritten: number;
    skipped: number;
    failed: number;
  };
  items: Array<{
    row_number: number;
    isbn: string;
    action:
      | 'created'
      | 'incremented'
      | 'overwritten'
      | 'skipped'
      | 'failed';
    error?: string;
  }>;
};
```

---

## 4. 借阅管理（Borrows）

### 4.1 列表分页/筛选

`GET /api/borrows`

Query：

- `page`, `pageSize`
- `username?`
- `isbn?`
- `status?`: `'all' | 'borrowed' | 'returned' | 'overdue' | 'reserved' | 'canceled'`
- `borrowStart?`, `borrowEnd?`（毫秒）
- `returnStart?`, `returnEnd?`（毫秒）

返回记录结构（data 解包后）：

```ts
type BorrowRecord = {
  record_id: string;
  user_id: string;
  username: string;
  book_id: string;
  isbn: string;
  book_title: string;
  status: 'borrowed' | 'returned' | 'overdue' | 'reserved' | 'canceled';
  borrow_date: string;        // 'YYYY-MM-DD HH:mm:ss'
  due_date: string;           // 'YYYY-MM-DD HH:mm:ss'
  return_date?: string;       // 'YYYY-MM-DD HH:mm:ss'
  borrow_days: number;
  fine_amount: number;
};

type BorrowsListResponseData = {
  items: BorrowRecord[];
  total: number;
};
```

### 4.2 借书

`POST /api/borrows/borrow`

Body：

```ts
type BorrowBookBody = {
  isbn: string;
  username: string;
  borrow_date?: string;  // 可为空/可省略则后端补当前时间
  borrow_days?: number;  // 可为空/可省略则默认 30
  due_date?: string;     // 可为空/可省略则后端自行生成/回填
};
```

成功返回：

```ts
type BorrowRecord = {
  record_id: string;
  user_id: string;
  username: string;
  book_id: string;
  isbn: string;
  book_title: string;
  status: 'borrowed' | 'returned' | 'overdue' | 'reserved' | 'canceled';
  borrow_date: string;        // 'YYYY-MM-DD HH:mm:ss'
  due_date: string;           // 'YYYY-MM-DD HH:mm:ss'
  return_date?: string;       // 'YYYY-MM-DD HH:mm:ss'
  borrow_days: number;
  fine_amount: number;
};

type BorrowBookResponseData = {
  record: BorrowRecord;
  book: unknown; // 当前前端不强依赖该字段结构（可返回更新后的 Book/库存信息）
};
```

业务约束（与 mock 保持一致）：

- ISBN/username 不能为空（400）
- 图书不存在（404）
- 图书下架（409）
- 无库存（409）
- 同一用户同一本书存在未归还记录：不可重复借（409）
- 用户存在“逾期未处理（fine_amount>0 且 overdue 且未归还）”记录：禁止借阅（409）

并发/一致性建议：

- 借书成功需要**扣减库存**（`current_stock - 1`），需要事务或原子更新保证不出现负库存

### 4.3 还书

`PUT /api/borrows/:recordId/return`

Body：

```ts
type ReturnBookBody = {
  return_date?: string; // 可为空/可省略则后端补当前时间
  fine_amount: number;
};
```

业务约束：

- 记录不存在（404）
- 记录不可还（例如已归还）返回冲突（409）
- 还书成功需要**回补库存**（`current_stock + 1`，不超过 `total_stock`）

---

## 5. 用户管理（Users）

### 5.1 列表分页/筛选

`GET /api/users`

Query：

- `page`, `pageSize`
- `username?`（模糊匹配）
- `role?`: `'all' | 'admin' | 'user'`
- `status?`: `'all' | 0 | 1`
- `createdStart?`, `createdEnd?`（毫秒）

返回（data 解包后）：

```ts
type UsersListResponseData = {
  items: Array<{
    _id: string;
    username: string;
    phone: string;        // 国内手机号（11 位），必填且唯一
    role: 'admin' | 'user';
    status: 0 | 1;
    credit_score: number;
    avatar?: string;
    created_at: string; // ISO
    password: string;   // mock 存在该字段；真实后端建议不要返回明文密码
  }>;
  total: number;
};
```

### 5.2 新增用户

`POST /api/users`

Body：

```ts
type CreateUserBody = {
  username: string;
  phone: string;          // 国内手机号（11 位），必填且唯一
  role: 'admin' | 'user';
  status: 0 | 1;
  credit_score: number; // >= 0
  avatar?: string;      // 目前前端传的是 URL（可能是 blob:）
};
```

建议约束：

- `username` 不能为空（400）
- `phone` 不能为空且符合国内手机号格式（400）
- `credit_score` 必须为非负数（400）
- `username` 唯一（409）
- `phone` 唯一（409）
- 禁止创建内置账号同名：`admin`、`vben`（400/409 均可，mock 为 400）

### 5.3 编辑用户

`PUT /api/users/:id`

Body 同新增。

错误：

- 404：用户不存在
- 409：用户名冲突
- 403：内置账号保护（见 5.6）

### 5.4 重置密码

`PUT /api/users/:id/reset-password`

说明：

- mock 中默认重置为 `123456`
- 真实后端应重置为安全的默认策略（或随机密码 + 通知），但如果要保持前端不改动，建议先按 `123456` 实现

错误：

- 404：用户不存在
- 403：内置账号禁止重置

### 5.5 删除用户

`DELETE /api/users/:id`

错误：

- 404：用户不存在
- 403：内置账号禁止删除

### 5.6 内置账号保护规则

至少保护以下用户名（不区分大小写）：

- `admin`
- `vben`

需要后端强制保护（前端虽然也禁用按钮，但不能只靠前端）：

- 禁止删除
- 禁止重置密码

---

### 5.7 批量导入用户（Excel）

> 说明：用于“用户管理-导入 Excel”批量新增用户。接口采用 `preview -> commit` 两步，避免直接入库造成不可控影响。

#### 5.7.1 预览

`POST /api/users/import/preview`

Body（JSON）：

```ts
type UsersImportPreviewBody = {
  // base64 dataUrl：data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,xxxx
  dataUrl: string;
  filename?: string;
};
```

Excel 表头（第一行，大小写不敏感）：

- 必填：`username`, `phone`
- 可选：`role`（`admin|user`，默认 `user`）、`status`（`0|1`，默认 `1`）、`credit_score`（>=0，默认 `100`）、`avatar`（URL，可为空）

返回（data 解包后）：

```ts
type UsersImportPreviewResponseData = {
  import_id: string;
  rows: Array<{
    row_number: number;
    username: string;
    phone: string;
    role: 'admin' | 'user';
    status: 0 | 1;
    credit_score: number;
    avatar: string;
    exists: boolean;   // phone 是否已存在
    is_valid: boolean; // 是否可导入
    errors: string[];
  }>;
  summary: {
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
    existing_rows: number;
    new_rows: number;
  };
};
```

#### 5.7.2 提交入库

`POST /api/users/import/commit`

Body（JSON）：

```ts
type UsersImportCommitBody = {
  import_id: string;
};
```

返回（data 解包后）：

```ts
type UsersImportCommitResponseData = {
  summary: {
    created: number;
    failed: number;
  };
  items: Array<{
    row_number: number;
    username: string;
    phone: string;
    action: 'created' | 'failed';
    error?: string;
  }>;
};
```
- 禁止冻结/解冻（status 不允许变更）
- 禁止改用户名
- 禁止改角色

允许项（按当前前端实现思路）：

- 允许调整 `avatar` / `credit_score`（如果你希望也禁止，可以后续统一收紧并同步改前端）

---

## 6. 数据分析（Analytics）

### 6.1 总览

`GET /api/analytics/overview`

Query（debug，后续可移除）：

- `mode?`: `static | dynamic | hybrid`
  - `static`：纯“原前端假数据”
  - `dynamic`：纯“基于当前 books/borrows/users 的统计”
  - `hybrid`：以原假数据为基线，叠加动态变化增量并放大（当前默认）

返回（data 解包后）：

```ts
type AnalyticsOverviewResponseData = {
  overview: {
    usersTotal: number;
    usersNew7d: number;
    borrowsTotal: number;
    borrowsNew7d: number;
    returnsTotal: number;
    returnsNew7d: number;
    visitsTotal: number;
    visitsNew7d: number;
  };
  trends: { labels: string[]; borrows: number[]; returns: number[] };
  monthlyBorrows: { labels: string[]; values: number[] };
  composition: { current: number[]; previous: number[] }; // 借书/还书/预约/逾期（长度 4）
  channels: { online: number; offline: number };
  topCategories: Array<{ name: string; value: number }>;
};
```

---

## 7. 状态码建议（与 mock 对齐）

- `200`: 成功（业务成功/失败由 `code` 决定）
- `400`: 参数校验失败（缺字段、数值不合法等）
- `401`: 未登录或 token 无效
- `403`: 禁止操作（例如内置账号保护）
- `404`: 资源不存在
- `409`: 冲突（重复创建、重复借阅、状态不允许变更等）
