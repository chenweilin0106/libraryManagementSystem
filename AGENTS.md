# 项目说明（libraryManagementSystem）

## 目录结构
- `backend/`：后端（独立 Node.js 项目，Koa + TypeScript + MongoDB 官方 Driver）
- `vue-vben-admin/`：前端（pnpm workspaces + turbo 的 monorepo）
  - 日常开发入口：`vue-vben-admin/apps/web-ele/`

## 后端接口契约
- 接口契约文档：`backend/API_CONTRACT.md`（后端需与当前前端请求形态对齐）

## 前端当前约定（已裁剪后的目标形态）
- 管理员端仅保留 4 个一级业务路由：
  - `/analytics`（数据分析）
  - `/books`（图书管理）
  - `/borrows`（借阅管理）
  - `/users`（用户管理）
- 用户端新增 3 个一级业务路由：
  - `/user-reservations`（图书预定）
  - `/user-borrow-records`（借阅记录）
  - `/profile`（个人中心）
- 重要：管理员端默认**不展示**用户端 3 个路由菜单。如需管理员联调用户端页面，请显式设置前端环境变量 `VITE_ENABLE_ADMIN_USER_PAGES=true` 并重启前端（默认保持关闭，避免出现多余菜单）。
- 业务页面目录：`vue-vben-admin/apps/web-ele/src/views/library/*`
- 业务路由模块：`vue-vben-admin/apps/web-ele/src/router/routes/modules/library.ts`

## 环境与常用命令
- Node：建议 `>=20.19.0`（Vite 构建要求）
- pnpm：建议 `>=10`

## 本地运行文档/脚本
- 运行指南：`RUNNING.md`
- 一键启动（Windows Terminal 多 Tab：数据库/Redis/后端/前端/codex）：`start-dev.ps1`
  - Redis：若检测 Docker 引擎不可用，会尝试拉起 Docker Desktop 并等待就绪（最多 120s），再启动容器。
  - codex：tab 入口为 `pwsh`（外观与其它 tab 一致），随后进入 WSL 启动 `codex`；`codex` 退出后保留 WSL shell（退出 WSL 后回到 PowerShell）。

## Redis（缓存/榜单/限流）
- Redis（Docker）启动：见 `RUNNING.md` 的“4)（可选）启动 Redis”
- 后端启用 Redis 缓存：在 `backend/.env` 配置 `REDIS_ENABLED=1`（默认关闭）
- 热门图书榜单（论文 `rank:hot_books`）：管理员接口 `GET /api/analytics/hot-books`
- Redis 限流（论文 `limit:req:{ip}`）：在 `backend/.env` 配置 `RATE_LIMIT_ENABLED=1`（默认关闭），超限返回 `429`

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

1. 代码修改前先维护功能文档：
   - 先检查根目录是否已有对应功能的文档，优先复用现有文档，不要同一功能按日期重复新建多份。
   - 有现成文档时：在原文档内按日期/版本继续往下追加（例如新增 `## 2026-03-15 v1.1` 小节）。
   - 没有现成文档时：再新建根目录文档，文件名统一建议为：`<功能>开发记录.md`。
   - 文档标题/小节必须带版本号与日期（例如：`v1.0（YYYY-MM-DD）` 或 `## 2026-03-15 v1.1`），并写明范围、接口/页面改动点、验收点。
   - 等我确认本次文档内容后，再开始实际开发与改代码。

2. 接口开发完成后必须冒烟：
   - 只要涉及后端接口新增/修改（含字段/校验/鉴权/会话策略调整），开发完成后必须至少跑一遍冒烟。
   - 冒烟形式不限（启动后端+前端走关键流程，或用脚本/curl 调用关键接口），但需要覆盖本次改动的主路径。
   - 冒烟命令/步骤与结果需要补充记录到对应功能文档的同一文件内，按日期/版本继续追加，不再额外拆单独文档。

3. 任何非只读操作前必须先检查当前分支：
   - 只要要修改代码、修改文档、删除文件、提交、合并、推送，就先确认当前不在 `main`/`master`。
   - 如果当前就在 `main`/`master`，默认禁止继续执行写操作，必须先新建或切换到合适分支。
   - 只有我明确要求直接在 `main`/`master` 上操作时，才允许例外。

## Git 提交约定（重要）
### 目标
- 提交可审阅、可回滚、可定位问题：尽量“小步提交”，按功能/层次拆分。

### 拆分原则
- **不要合一笔提交**：后端/前端/文档尽量分开；同一层内也按“一个改动点一笔提交”拆。
- 每笔提交尽量能独立说明问题与改动（避免“顺手改了很多小东西”混进同一笔）。
- 尽量保持每笔提交编译/类型检查可通过（必要时可把依赖改动提前提交）。

### 提交信息
- 建议格式：`<type>(scope): <summary>`
  - `type`：`feat`/`fix`/`refactor`/`chore`/`docs` 等
  - `scope`：`backend`/`frontend`/`docs`/具体模块名
  - `summary`：一句话说明做了什么
- 参考示例：
  - `feat(backend): add list sorting options`
  - `feat(frontend): move profile menu to bottom`
  - `docs(records): add page development notes`
  - `chore(git): stop tracking idea workspace file`

### 不要提交的内容
- 本地 IDE/个人环境文件（例如 `.idea/workspace.xml` 这类变动）默认不提交，除非团队明确需要共享。

### 推送前自检
- 后端：至少 `pnpm -C backend build`（或等价的 `tsc` 编译检查）
- 前端：至少 `pnpm -C vue-vben-admin -F @vben/web-ele typecheck`（或等价的 `vue-tsc`）
- 若跑了冒烟：把步骤/结果追加到对应计划文档的“冒烟记录”里。

### 开发完成后的收尾动作
- 完成功能开发、自检与必要冒烟后，先向我汇报本次结果，再进入 Git 收尾动作。
- 我（Codex/Agent）只负责按你要求拆分修改并执行 `git add`，`git commit`；不会默认执行 `git push`、分支合并/删除等操作。
- 未经我明确确认，不要主动执行远程推送、合并分支、删除远程分支等操作。

### Windows 下 `git push` 常见问题（Codex/自动化环境）
- 现象 1（SSH）：`ssh.exe: fatal error - couldn't create signal pipe, Win32 error 5`
  - 背景：Git for Windows 自带的 `C:\\Program Files\\Git\\usr\\bin\\ssh.exe`（MSYS2 兼容层）在某些受限/非交互环境中可能无法创建内部信号管道而失败。
  - 推荐修复：让 Git 改用系统原生 OpenSSH：
    - `git config --global core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe"`
    - 验证：`git config --global core.sshCommand`、`ssh -V`
    - 回退：`git config --global --unset core.sshCommand`
- 现象 2（HTTPS）：`schannel: ... SEC_E_NO_CREDENTIALS`
  - 背景：系统凭据（GCM/Token）在自动化环境里不可用或未配置。
  - 处理：用交互式终端重新登录 Git 凭据，或改用 SSH key/agent 方案。

## 前端启动 + DevTools MCP（chrome-devtools）

目标：方便让 Agent 启动 Element 前端，并用 MCP 自动打开浏览器进入页面做调试。

- 启动前端（Element）：
  - 在 `vue-vben-admin/` 下运行：`pnpm dev:ele`
  - 等待 Vite 输出：`Local: http://localhost:<port>/`

- 使用 DevTools MCP 打开页面（用于调试，不要求截图）：
  - `mcp__chrome-devtools__new_page` 打开：`http://localhost:<port>/`
  - `mcp__chrome-devtools__wait_for` 等待关键字（例如：`登录`）
  - （可选）最大化窗口（等同点最大化）：`mcp__chrome-devtools__press_key` 发送 `Meta+ArrowUp`

- 备注：
  - MCP 启动的浏览器通常是隔离 profile（看起来“默认设置”）属于正常现象。
  - 可能先出现 `about:blank` 标签页，属正常。

- 停止前端：
  - 启动终端 `Ctrl+C`；必要时用 `netstat -ano | findstr :<port>` 找 PID，再 `taskkill /PID <pid> /F`

## Page + 表格页（VxeGrid）使用注意
背景：表格页常用 `gridOptions.height: 'auto'`（自适应），如果外层容器高度不受控，会导致页面被表格内容不断撑高，看起来像“高度无限扩大”。

推荐写法（对齐官方示例）：
- **页面层**：表格页统一用 `<Page auto-content-height>` 限制内容区高度，让内容区滚动而不是整页增长。
- **表格层**：`gridOptions.height: 'auto'`，不要写死像素高度（除非你明确想要固定高度的表格容器）。

最小示例（Page 限高 + Table 自适应）：
```text
<script lang="ts" setup>
import type { VxeGridProps } from '#/adapter/vxe-table';
import { Page } from '@vben/common-ui';
import { useVbenVxeGrid } from '#/adapter/vxe-table';

const gridOptions: VxeGridProps<any> = { height: 'auto', columns: [], data: [] };
const [Grid] = useVbenVxeGrid({ gridOptions });
</script>

<template>
  <Page auto-content-height title="列表页">
    <Grid />
  </Page>
</template>
```

## 开发要求（UI/交互）
### 图片展示
- 展示图片默认使用可预览组件：优先 `ElImage` + `preview-src-list` + `preview-teleported`，并提供加载失败兜底（占位图）。

### 数据操作
- 所有“会改变数据”的操作（新增/编辑/删除/下架/上架/借阅/还书/预约/取消预约等）默认需要二次确认：
  - 使用 `ElMessageBox.confirm(...)`，点击取消要 `try/catch` 直接 return。
  - 成功给 `ElMessage.success(...)`；失败由全局请求错误提示展示后端原因（如“无库存/已下架/权限不足”等）。
