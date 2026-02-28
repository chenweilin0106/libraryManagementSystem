# 项目说明（libraryManagementSystem）

## 目录结构
- `backend/`：后端（独立 Node.js 项目，Koa + TypeScript + MongoDB 官方 Driver）
- `vue-vben-admin/`：前端（pnpm workspaces + turbo 的 monorepo）
  - 日常开发入口：`vue-vben-admin/apps/web-ele/`

## 后端接口契约
- 接口契约文档：`backend/API_CONTRACT.md`（后端需与当前前端请求形态对齐）

## 前端当前约定（已裁剪后的目标形态）
- 仅保留 4 个一级业务路由：
  - `/analytics`（数据分析）
  - `/books`（图书管理）
  - `/borrows`（借阅管理）
  - `/users`（用户管理）
- 业务页面目录：`vue-vben-admin/apps/web-ele/src/views/library/*`
- 业务路由模块：`vue-vben-admin/apps/web-ele/src/router/routes/modules/library.ts`

## 环境与常用命令
- Node：建议 `>=20.19.0`（Vite 构建要求）
- pnpm：建议 `>=10`

### 后端（backend）
- 运行前提：本地 MongoDB 需要可连接（默认 `mongodb://127.0.0.1:27017`，数据库名 `library`；可用 `backend/.env` 覆盖）
- 安装：`pnpm -C backend install`
- 开发：`pnpm -C backend dev`
- 备用（不推荐，仅排查用）：`pnpm -C backend dev:tsx`
- 构建：`pnpm -C backend build`

### 前端（vue-vben-admin）
- 安装：`pnpm -C vue-vben-admin install`
- 开发：`pnpm -C vue-vben-admin dev:ele`
- 类型检查：`pnpm -C vue-vben-admin -F @vben/web-ele typecheck`
- 构建（推荐用 turbo 带依赖链）：`pnpm -C vue-vben-admin exec turbo build --filter=@vben/web-ele`

## 登录（后端内置账号）
- 后端启动后会自动初始化内置账号（如果不存在则创建）：`admin`、`vben`
- 默认密码：`123456`
- 鉴权方式：业务接口使用 `Authorization: Bearer <accessToken>`；刷新使用 HttpOnly cookie（`POST /api/auth/refresh`）
- 重要：刷新 `accessToken` 会轮换 token，旧 token 立即失效（继续用旧 token 调业务接口会返回 `401`）

## Windows / nvm 注意事项
- Windows 下 `nvm use <version>` 可能需要管理员终端才会真正切换生效。
- 若 `pnpm install`/`turbo build` 出现 `spawn EPERM`，请尝试在管理员终端重试相同命令。
