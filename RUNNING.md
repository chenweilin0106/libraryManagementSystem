# 运行指南（本地开发 / Windows）

## 前置条件

- Node.js：建议 `>= 20.19.0`
- pnpm：建议 `>= 10`
- MongoDB：已安装为 Windows 服务（本项目后端默认连接 `mongodb://127.0.0.1:27017`，数据库名 `library`）

## 1) 启动 MongoDB（Windows 服务）

两种方式任选其一：

- 图形界面：打开“服务”（运行 `services.msc`）→ 找到 **MongoDB** → 启动
- PowerShell（通常需要管理员权限）：
  - 查看状态：`Get-Service MongoDB`
  - 启动服务：`Start-Service MongoDB`
  - 停止服务：`Stop-Service MongoDB`

如果你的服务名称不是 `MongoDB`，可以用：`Get-Service *mongo*` 搜索真实服务名。

## 2) 启动后端（Koa + TypeScript）

在项目根目录执行：

```bash
pnpm -C backend install
pnpm -C backend dev
```

- 健康检查：`http://localhost:3000/api/health`

## 3) 启动前端（Vue Vben Admin / web-ele）

再开一个终端，在项目根目录执行：

```bash
pnpm -C vue-vben-admin install
pnpm -C vue-vben-admin dev:ele
```

- 访问地址：`http://localhost:5777`

## 4) （可选）启动 Redis（Docker Desktop / WSL2 后端）

用途：为后端的缓存/性能优化做准备；未接入前不影响现有功能。

在项目根目录执行：

```bash
# 启动（后台）
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" compose -f docker/redis/compose.yml up -d

# 自检（期望输出：PONG）
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" exec lms-redis redis-cli ping

# 停止（保留数据卷）
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" compose -f docker/redis/compose.yml down

# 停止并清理数据卷（谨慎）
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" compose -f docker/redis/compose.yml down -v
```

### 4.1 （可选）后端启用 Redis 缓存

默认关闭；需要时在 `backend/.env`（如不存在可新建）里显式开启：

```bash
REDIS_ENABLED=1
REDIS_URL=redis://127.0.0.1:6379/0
REDIS_KEY_PREFIX=lms:
REDIS_DEFAULT_TTL_SECONDS=30
```

说明：
- Redis 不可用/连接失败会自动降级为“不走缓存”，不影响接口正确性。
- 已缓存的接口：`/api/books`、`/api/books/:isbn`、`/api/analytics/overview`、`/api/users`、`/api/borrows`、`/api/borrows/my`。

### 4.2 （可选）Redis 限流（论文：`limit:req:{ip}`）

默认关闭；需要时在 `backend/.env` 开启（建议只保护较重接口，如 analytics）：

```bash
RATE_LIMIT_ENABLED=1
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_MAX_REQUESTS=60
```

说明：
- 当前已对 `GET /api/analytics/overview` 接入限流；超限返回 HTTP `429`。

## 常见问题

- 后端连不上 MongoDB：先确认 MongoDB 服务已启动；如需修改连接串/库名，可查看 `backend/.env`（如存在）或按 `backend/` 内配置说明调整。
- 登录账号：后端会自动初始化内置账号（如不存在则创建）`admin`、`vben`，默认密码 `123456`。
