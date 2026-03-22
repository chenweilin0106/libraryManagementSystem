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
  "message": "ok",
  "data": {}
}
```

失败示例（以 HTTP 403 为例；业务上仍应保持正确的 HTTP 状态码）：

```json
{
  "code": 403,
  "message": "用户名或密码错误",
  "data": null
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
  "message": "ok",
  "data": {
    "accessToken": "xxx"
  }
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
- `phone`（国内手机号，前端用于右上角用户下拉与个人中心展示，建议后端始终返回）
- `roles: string[]`
- `homePath?: string`

当前角色模型：

- `roles: ['super']`
- `roles: ['admin']`
- `roles: ['user']`

首页跳转：

- `super -> /analytics`
- `admin -> /analytics`
- `user -> /user-reservations`

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

## 2.8 个人中心-更新基本资料

`PUT /api/user/profile`

说明：

- 仅允许更新**当前登录用户**（不允许传 userId）
- `username/roles` 在个人中心中为只读；管理员如需修改角色，请到“用户管理”中操作

请求体（JSON）：

```ts
type UpdateMyProfileBody = {
  realName: string;
  introduction?: string;
  phone?: string;
  // avatar?: string; // 后续如接入头像上传再补齐
};
```

成功响应：返回更新后的用户信息对象（通用结构 data 解包后为对象，字段以 `UserInfo` 为准）。

错误：

- 400：`realName` 为空
- 400：`phone` 格式不合法
- 401：未登录或登录已过期
- 409：`phone` 已存在

---

## 2.9 个人中心-修改密码

`PUT /api/user/password`

请求体（JSON）：

```ts
type ChangeMyPasswordBody = {
  oldPassword: string;
  newPassword: string;
};
```

成功响应：通用结构（`code===0`），`data` 返回空对象：

```json
{}
```

错误：

- 400：参数缺失
- 403：旧密码错误
- 409：新密码与旧密码相同
- 401：未登录或登录已过期

重要说明（会话策略）：

- 修改密码成功后，服务端会删除该用户的所有会话（access/refresh 同时失效）
- 前端需要提示用户并**强制退出重新登录**

---

## 3. 图书管理（Books）

### 3.1 列表分页/筛选

`GET /api/books`

Query：

- `page`, `pageSize`
- `title?`, `author?`, `isbn?`, `category?`
- `status?`: `'all' | 'normal' | 'deleted'`
- `sortBy?`: `'created_at' | 'current_stock'`（可选）
- `sortOrder?`: `'asc' | 'desc'`（可选，默认 desc）

响应（通用结构 data 解包后）：

```ts
type BooksListResponseData = {
  items: Array<{
    isbn: string;
    title: string;
    author: string;
    introduction: string; // 简介（<= 300 字；可为空字符串）
    category: string;
    cover_url: string;
    total_stock: number;
    current_stock: number;
    is_deleted: boolean;
    // 最近一次上/下架审计信息（演示项目：仅保留最后一次；未发生过则为 null）
    shelved_at: string | null; // ISO
    shelved_by_user_id: string | null;
    shelved_by_username: string | null;
    unshelved_at: string | null; // ISO
    unshelved_by_user_id: string | null;
    unshelved_by_username: string | null;
    created_at: string; // ISO
  }>;
  total: number;
};
```

### 3.2 新增图书

`POST /api/books`

说明：

- 新书入库默认处于“已下架”（`is_deleted=true`）状态，需管理员手动调用上架接口（`PUT /api/books/:isbn/shelf`，`{ "is_deleted": false }`）后，用户端才可预约/借阅。

Body：

```ts
type CreateBookBody = {
  isbn: string;
  title: string;
  author: string;
  introduction?: string;  // 简介（可选，<= 300 字）
  category: string;
  cover_url: string;      // http(s) URL 或以 / 开头；为空时后端默认 /covers/cover-placeholder.svg
  total_stock: number;    // >= 0 的整数
  current_stock: number;  // >= 0 的整数 且 <= total_stock
};
```

错误约束（建议与 mock 一致）：

- 400：字段为空 / `总库存不合法` / `当前可借数量不合法` / `当前可借数量不能大于总库存` / `cover_url` 格式不合法
- 409：ISBN 已存在

### 3.3 编辑图书

`PUT /api/books/:isbn`

Body 同新增。

错误：

- 400：参数不合法
- 404：未找到原 ISBN
- 409：将 ISBN 修改为已存在的 ISBN / 图书处于上架状态，禁止编辑，请先下架

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

- 400：`is_deleted` 缺失或不是 boolean
- 404：未找到图书
- 409：存在未结束借阅/预约记录或库存未回收，禁止下架
- 409：无可借库存，禁止上架

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
- `introduction` 或 `简介`（可空，<= 300 字；仅在新书创建/覆盖策略下写入）
- `category`（新书必填；老书可空）
- `cover_url`（可空；http(s) URL 或以 / 开头；为空时新书默认 /covers/cover-placeholder.svg）
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

### 3.7 删除图书（物理删除，仅已下架可用）

`DELETE /api/books/:isbn`

说明：

- 仅 `admin | super` 可调用
- 仅允许删除已下架图书（`is_deleted=true`）；未下架返回冲突
- 物理删除数据库记录

错误：

- 400：ISBN 为空
- 403：权限不足
- 404：图书不存在
- 409：图书未下架，禁止删除

### 3.8 Excel 导入提交（批量入库）

`POST /api/books/import/commit`

说明：

- 对“新书行（Excel 命中不存在的 ISBN）”：创建新书后默认处于“已下架”（`is_deleted=true`）状态，需管理员手动上架。
- 对“老书行（Excel 命中已存在的 ISBN）”：仅处理库存与字段覆盖策略，不修改该书当前 `is_deleted`（保持上/下架状态不变）。
- 额外规则：当 `conflict_strategy=overwrite` 且命中“上架老书”（`is_deleted=false`）时，该行直接失败（`action=failed`），提示 `图书处于上架状态，禁止覆盖字段，请先下架`。

Body：

```ts
type BooksImportCommitBody = {
  import_id: string;
  // 处理重复 ISBN 的策略（仅对“Excel 行命中老书”生效）
  conflict_strategy: 'increment_stock' | 'skip' | 'overwrite';
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

权限：
- 管理员接口（`role=admin`）

Query：

- `page`, `pageSize`
- `username?`
- `isbn?`
- `title?`, `author?`, `category?`
- `status?`: `'all' | 'reserved' | 'reserve_overdue' | 'borrowed' | 'borrow_overdue' | 'returned' | 'canceled'`
- `borrowStart?`, `borrowEnd?`（毫秒）
- `returnStart?`, `returnEnd?`（毫秒）
- `sortBy?`:
  - 兼容字段：`'borrow_date' | 'due_date' | 'return_date'`
  - 新字段：`'reserved_at' | 'pickup_due_at' | 'borrowed_at' | 'return_due_at' | 'returned_at' | 'created_at'`
- `sortOrder?`: `'asc' | 'desc'`（可选，默认 `desc`）

返回记录结构（data 解包后）：

```ts
type BorrowRecord = {
  record_id: string;
  user_id: string;
  username: string;
  book_id: string;
  isbn: string;
  book_title: string;
  status:
    | 'reserved'
    | 'reserve_overdue'
    | 'borrowed'
    | 'borrow_overdue'
    | 'returned'
    | 'canceled';
  reserved_at?: string;       // 'YYYY-MM-DD HH:mm:ss'
  pickup_due_at?: string;     // 'YYYY-MM-DD HH:mm:ss'
  borrowed_at?: string;       // 'YYYY-MM-DD HH:mm:ss'
  return_due_at?: string;     // 'YYYY-MM-DD HH:mm:ss'
  returned_at?: string;       // 'YYYY-MM-DD HH:mm:ss'
  // 兼容字段：供旧页面/旧查询逻辑复用
  borrow_date: string;        // reserved_at 或 borrowed_at
  due_date: string;           // pickup_due_at 或 return_due_at
  return_date?: string;       // returned_at
  borrow_days: number;
  fine_amount: number;
};

type BorrowsListResponseData = {
  items: BorrowRecord[];
  total: number;
};
```

### 4.1.1 我的借阅/预约记录

`GET /api/borrows/my`

权限：
- 登录用户可用（仅返回自己的记录；忽略前端传入的 username 等字段）

Query：

- `page`, `pageSize`
- `isbn?`
- `title?`, `author?`, `category?`
- `status?`: `'all' | 'reserved' | 'reserve_overdue' | 'borrowed' | 'borrow_overdue' | 'returned' | 'canceled'`
- `borrowStart?`, `borrowEnd?`（毫秒）
- `returnStart?`, `returnEnd?`（毫秒）

返回同 `BorrowRecord` + `BorrowsListResponseData`。

### 4.2 借书

`POST /api/borrows/borrow`

权限：
- 管理员接口（`role=admin`）

Body：

```ts
type BorrowBookBody = {
  isbn: string;
  username: string;
  borrowed_at?: string;  // 可为空/可省略则后端补当前时间
  borrow_days?: number;  // 可为空/可省略则默认 30
  return_due_at?: string; // 可为空/可省略则后端自行生成/回填
  // 兼容旧字段：
  borrow_date?: string;
  due_date?: string;
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
  status:
    | 'reserved'
    | 'reserve_overdue'
    | 'borrowed'
    | 'borrow_overdue'
    | 'returned'
    | 'canceled';
  reserved_at?: string;
  pickup_due_at?: string;
  borrowed_at?: string;
  return_due_at?: string;
  returned_at?: string;
  borrow_date: string;
  due_date: string;
  return_date?: string;
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
- 用户存在“逾期未处理（`status in reserve_overdue/borrow_overdue` 且未归还）”记录：禁止借阅（409）

并发/一致性建议：

- 借书成功需要**扣减库存**（`current_stock - 1`），需要事务或原子更新保证不出现负库存

补充约定（预约取书）：
- 若同一用户同一本书存在“待取书（reserved）且未取消/未归还”记录，则本接口会将该记录转为 `borrowed`（不重复扣库存）。
- 若同一用户同一本书存在“待取超期（reserve_overdue）”记录，则本接口拒绝确认借出，需先取消预约。

### 4.2.1 预约（用户端）

`POST /api/borrows/reserve`

权限：
- 登录用户可用（为自己预约）

Body：

```ts
type ReserveBookBody = {
  isbn: string;
};
```

业务约束：
- 图书不存在/下架/无库存：返回 404/409
- 同一用户同一本书存在未结束记录：不可重复预约（409）
- 存在逾期未处理记录：禁止预约（409）

成功返回结构与 `BorrowBookResponseData` 一致（`record.status = 'reserved'`）。

### 4.2.2 取消预约（用户端）

`PUT /api/borrows/:recordId/cancel`

权限：
- 登录用户可用（仅允许取消自己的记录）
- 管理员可取消任意 `reserved / reserve_overdue` 记录

业务约束：
- 仅 `status='reserved' | 'reserve_overdue'` 的记录允许取消（409）
- 取消成功会**回补库存（幂等）**：
  - `reserved`：回补库存（`current_stock + 1`，不超过 `total_stock`）
  - `reserve_overdue`：
    - 若该记录的库存尚未释放，则回补库存；
    - 若库存已被“预约超期自动释放”或已回补过，则**不重复回补**。
  - 说明：后端使用 `borrows.reservation_stock_released_at` 作为幂等标记（该字段不在接口响应体中返回）。

成功返回：`BorrowRecord`

### 4.3 还书

`PUT /api/borrows/:recordId/return`

权限：
- 管理员接口（`role=admin`）

Body：

```ts
type ReturnBookBody = {
  returned_at?: string; // 可为空/可省略则后端补当前时间
  fine_amount: number;
  // 兼容旧字段：
  return_date?: string;
};
```

业务约束：

- 记录不存在（404）
- `reserved / reserve_overdue` 记录不可直接还书（409）
- 记录不可还（例如已归还/已取消）返回冲突（409）
- 还书成功需要**回补库存**（`current_stock + 1`，不超过 `total_stock`）

---

## 5. 用户管理（Users）

### 5.1 列表分页/筛选

`GET /api/users`

Query：

- `page`, `pageSize`
- `username?`（模糊匹配）
- `role?`: `'all' | 'super' | 'admin' | 'user'`
- `status?`: `'all' | 0 | 1`
- `createdStart?`, `createdEnd?`（毫秒）
- `sortBy?`: `'created_at' | 'role'`（可选，默认 `created_at`）
- `sortOrder?`: `'asc' | 'desc'`（可选，默认 `desc`）

返回（data 解包后）：

```ts
type UsersListResponseData = {
  items: Array<{
    _id: string;
    username: string;
    phone: string;        // 国内手机号（11 位），必填且唯一
    role: 'super' | 'admin' | 'user';
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
- `admin` 仅允许创建 `user`
- `super` 允许创建 `admin | user`
- 不允许通过用户管理创建新的 `super`

### 5.3 编辑用户

`PUT /api/users/:id`

Body 同新增。

错误：

- 404：用户不存在
- 409：用户名冲突
- 403：内置账号保护（见 5.6）
- 403：`admin` 仅可编辑 `user`
- 403：仅 `super` 可修改角色

### 5.4 重置密码

`PUT /api/users/:id/reset-password`

说明：

- mock 中默认重置为 `123456`
- 真实后端应重置为安全的默认策略（或随机密码 + 通知），但如果要保持前端不改动，建议先按 `123456` 实现
- `admin` 仅允许重置 `user`
- `super` 允许重置 `admin | user`

重要说明（会话策略）：

- 重置密码成功后，服务端会删除该用户的所有会话（access/refresh 同时失效）
- 前端需要提示用户并要求其重新登录

错误：

- 404：用户不存在
- 403：内置账号禁止重置

### 5.5 删除用户

说明：

- `admin` 仅允许删除 `user`
- `super` 允许删除 `admin | user`
- `super` 用户不允许作为用户管理目标被编辑/删除/重置

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

## 7. 状态码建议（与 mock 对齐）

- `200`: 成功（业务成功/失败由 `code` 决定）
- `400`: 参数校验失败（缺字段、数值不合法等）
- `401`: 未登录或 token 无效
- `403`: 禁止操作（例如内置账号保护）
- `404`: 资源不存在
- `409`: 冲突（重复创建、重复借阅、状态不允许变更等）
- `429`: 请求过于频繁（可选：Redis 限流）

---

## 附录 A. 开发/冒烟辅助接口（dev-only）

> 说明：该类接口不被前端业务依赖，仅用于冒烟脚本或开发联调。
>
> 安全约束：
> - 仅在 `NODE_ENV !== 'production'` 时可用（生产环境返回 404）。
> - 需要管理员鉴权（`Authorization: Bearer <accessToken>`）。

### A.1 强制预约超期（用于验证“超期释放库存 + 取消幂等”）

`POST /api/dev/smoke/borrows/force-reserve-overdue`

Body：

```ts
type ForceReserveOverdueBody = {
  record_id: string;
};
```

成功响应（data 解包后）：

```ts
type ForceReserveOverdueResponseData = {
  record_id: string;
  status: string; // 期望为 reserve_overdue
  reservation_stock_released_at: string | null; // ISO；若库存释放成功则为非空
};
```
