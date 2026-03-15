# 前端仓库指南（vue-vben-admin）

## 项目结构
- 本仓库是 `pnpm` workspaces + `turbo` 的 monorepo。
- 日常开发以 `apps/web-ele/` 为主（Element Plus 版本应用）。
- 共享能力与基础设施主要在 `packages/` 与 `internal/`。

## 当前项目状态（已裁剪）
- 管理员端仅保留 4 个一级业务路由：
  - `/analytics`（数据分析）
  - `/books`（图书管理）
  - `/borrows`（借阅管理）
  - `/users`（用户管理）
- 用户端新增 3 个一级业务路由：
  - `/user-reservations`（图书预定）
  - `/user-borrow-records`（借阅记录）
  - `/profile`（个人中心）
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

## 二次封装组件使用约定
- 优先使用项目二次封装的组件/Hook（如 `useVbenVxeGrid`、`useVbenDrawer`、`useVbenForm`、`Page` 等），避免绕过封装直接使用底层库的另一套写法。
- 当需要实现某个功能时（如：表格高度自适应、表格+搜索表单、抽屉表单提交、动态标题/按钮文案、输入框插槽等），若 `playground/src/views/examples/**` 已有同类效果，则优先参照示例代码的写法与组合方式（配置项结构、生命周期回调、提交方式等），仅在示例未覆盖或确有业务差异时再进行最小化自定义。

## 表格页高度约定（重要）
- 表格页（`useVbenVxeGrid` + `gridOptions.height: 'auto'`）外层统一使用 `<Page auto-content-height>`，避免表格把页面无限撑高。

## 交互默认约定
- 图片展示：默认使用 `ElImage` 的预览能力（`preview-src-list` + `preview-teleported`），并做封面占位/加载失败兜底。
- 数据操作：默认二次确认（`ElMessageBox.confirm`），成功 `ElMessage.success`，失败提示使用后端返回的 `error` 字段（已由全局请求拦截器统一处理）。

## Windows / nvm 注意事项
- Windows 下 `nvm use <version>` 可能需要管理员终端才会真正切换生效。
- 若 `pnpm install`/`turbo build` 出现 `spawn EPERM`，请尝试在管理员终端重试相同命令。
