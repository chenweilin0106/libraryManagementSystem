# 前端仓库指南（vue-vben-admin）

## 项目结构
- 本仓库是 `pnpm` workspaces + `turbo` 的 monorepo。
- 日常开发以 `apps/web-ele/` 为主（Element Plus 版本应用）。
- 共享能力与基础设施主要在 `packages/` 与 `internal/`。

## 当前项目状态（已裁剪）
- 仅保留 4 个一级业务路由：
  - `/analytics`（数据分析）
  - `/books`（图书管理）
  - `/borrows`（借阅管理）
  - `/users`（用户管理）
- 业务路由模块：`apps/web-ele/src/router/routes/modules/library.ts`
- 业务页面目录：`apps/web-ele/src/views/library/*`
- 已移除演示/概览相关路由与页面目录：`dashboard`、`demos`、`vben`、`profile`、`about` 等

## 常用命令
环境要求：Node `>=20.19.0`，pnpm `>=10.0.0`（见 `package.json`）。

- 安装依赖：`pnpm install`
- 开发（web-ele）：`pnpm dev:ele`
- 类型检查（web-ele）：`pnpm -F @vben/web-ele typecheck`
- 构建（推荐，带依赖链）：`pnpm exec turbo build --filter=@vben/web-ele`

## Web-Ele 常用路径
- 路由：`apps/web-ele/src/router/routes/`
- 页面：`apps/web-ele/src/views/`
  - 业务页面：`apps/web-ele/src/views/library/`
- API：`apps/web-ele/src/api/`
- 静态资源：`apps/web-ele/public/`

## 代码规范
- 统一 2 空格缩进、LF、每行 100 字符（见 `.editorconfig`）。
- 使用 Prettier（`.prettierrc.mjs`），配合 ESLint（`eslint.config.mjs`）与 Stylelint（`stylelint.config.mjs`）。
- 改动优先集中在 `apps/web-ele/src/`；尽量避免动 `packages/*`（除非确有必要）。

## Windows / nvm 注意事项
- Windows 下 `nvm use <version>` 可能需要管理员终端才会真正切换生效。
- 若 `pnpm install`/`turbo build` 出现 `spawn EPERM`，请尝试在管理员终端重试相同命令。

