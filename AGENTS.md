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

## 本地运行文档/脚本
- 运行指南：`RUNNING.md`
- 一键启动（Windows Terminal 多 Tab：数据库/后端/前端/codex）：`start-dev.ps1`

### 后端（backend）
- 运行前提：本地 MongoDB 需要可连接（默认 `mongodb://127.0.0.1:27017`，数据库名 `library`；可用 `backend/.env` 覆盖）
- 安装：`pnpm -C backend install`
- 开发：`pnpm -C backend dev`
- 备用（不推荐，仅排查用）：`pnpm -C backend dev:tsx`
- 构建：`pnpm -C backend build`

### 数据脚本（backend）
- 回填用户手机号（必填+唯一）：`pnpm -C backend backfill:phones`
- 回填图书简介（仅补空值、不覆盖已有；跳过测试数据）：`pnpm -C backend backfill:book-intros`

### 前端（vue-vben-admin）
- 安装：`pnpm -C vue-vben-admin install`
- 开发：`pnpm -C vue-vben-admin dev:ele`
- 类型检查：`pnpm -C vue-vben-admin -F @vben/web-ele typecheck`
- 构建（推荐用 turbo 带依赖链）：`pnpm -C vue-vben-admin exec turbo build --filter=@vben/web-ele`

## 图书简介（Books.introduction）约定
- 字段：`introduction`（图书简介），字符串，允许为空，后端限制 `<= 300` 字符。
- 展示：主页列表表格不展示；仅在“新增/编辑图书”抽屉表单中展示与编辑。
- 接口：`GET /api/books` 返回包含 `introduction`（未设置时返回空字符串）；`POST/PUT /api/books*` 支持写入/更新。
- 批量导入：Excel 可选列 `introduction` 或 `简介`；新书写入；老书仅在 `overwrite` 且该列有值时更新。
- 数据回填：`backfill:book-intros` 只补 `introduction` 为空/不存在的记录；标题/作者/ISBN 含明显测试关键词（如 `测试/test/demo/mock` 等）会跳过不填。

## UI 入口裁剪（时区按钮）
- 当前已隐藏顶部栏“时区切换”按钮入口（仅隐藏入口，不移除底层时区能力）。
- 说明：偏好设置会缓存到 LocalStorage；若你本地仍显示旧按钮，可清理对应站点的 LocalStorage 后刷新。

## 登录（后端内置账号）
- 后端启动后会自动初始化内置账号（如果不存在则创建）：`admin`、`vben`
- 默认密码：`123456`
- 鉴权方式：业务接口使用 `Authorization: Bearer <accessToken>`；刷新使用 HttpOnly cookie（`POST /api/auth/refresh`）
- 重要：刷新 `accessToken` 会轮换 token，旧 token 立即失效（继续用旧 token 调业务接口会返回 `401`）

## Windows / nvm 注意事项
- Windows 下 `nvm use <version>` 可能需要管理员终端才会真正切换生效。
- 若 `pnpm install`/`turbo build` 出现 `spawn EPERM`，请尝试在管理员终端重试相同命令。

## 协作流程约定（对 Codex/Agent）

1. 代码修改前先写计划文档：
   - 先在根目录新增/更新对应的计划文档（例如：`个人中心开发计划.md`）
   - 计划文档标题必须带版本号与日期（例如：`v1.0（YYYY-MM-DD）`），并写明范围、接口/页面改动点、验收点
   - 等我确认计划文档内容后，再开始实际开发与改代码

2. 接口开发完成后必须冒烟：
   - 只要涉及后端接口新增/修改（含字段/校验/鉴权/会话策略调整），开发完成后必须至少跑一遍冒烟
   - 冒烟形式不限（启动后端+前端走关键流程，或用脚本/curl 调用关键接口），但需要覆盖本次改动的主路径
   - 冒烟命令/步骤与结果需要补充记录到对应的计划文档（同版本号下追加即可）
