# Redis 启动脚本修复计划 v1.0（2026-03-15）

## 范围
- 仅调整一键启动脚本 `start-dev.ps1` 的 **Redis** 这个 tab 的启动逻辑。
- 不改动后端/前端/数据库/Redis compose 文件内容（`docker/redis/compose.yml`）。

## 现状与问题
- 当 Docker Desktop 未启动或引擎未就绪时，脚本直接执行：
  - `docker compose ... up -d`
  - `docker exec ... redis-cli ping`
  - `docker ps ...`
  会连续输出多次同类错误（连接 `dockerDesktopLinuxEngine` 失败），不利于定位问题。
- 脚本当前只提示“请先打开 Docker Desktop”，但不会自动拉起 Docker Desktop，也不会等待引擎就绪。

## 目标
- 若检测 Docker 引擎不可用：
  1) 尝试拉起 Docker Desktop（尽力而为：启动服务/启动桌面程序）；
  2) 等待引擎就绪（带超时）；
  3) 引擎就绪后再启动 Redis 容器。
- 若超时仍不可用：只输出一次清晰错误与下一步提示，并停止后续动作（避免重复刷屏）。

## 计划改动点（待确认后实施）
1. 在 Redis tab 内新增 Docker 引擎预检：优先 `docker info`（失败则视为引擎不可用）。
2. 若引擎不可用：
   - 尝试 `Start-Service com.docker.service`（若服务存在；无管理员权限时允许失败但不阻断）；
   - 尝试 `Start-Process "...\Docker Desktop.exe"` 拉起 Docker Desktop；
   - 轮询等待引擎就绪（默认 120 秒，2 秒间隔）。
3. 将所有 `docker ...` 外部命令包装为“失败即 throw”，避免后续步骤继续执行导致多次重复报错。

## 验收点
- Docker Desktop 关闭时运行 `.\start-dev.ps1`：
  - Redis tab 会自动尝试拉起 Docker Desktop；
  - 会显示等待进度；
  - 引擎就绪后能成功启动 Redis 容器；
  - 若超时，输出明确错误并停止（不会再执行 `redis-cli ping`/`docker ps`）。
- Docker Desktop 已开启且引擎就绪时：
  - 仍能正常 `compose up -d`；
  - `redis-cli ping` 输出 `PONG`；
  - `docker ps` 能看到 `lms-redis`。

## 冒烟记录（完成改动后补充）
- 场景 A（Docker Desktop 关闭）：
  - 命令：`.\start-dev.ps1`
  - 结果：
- 场景 B（Docker Desktop 已启动）：
  - 命令：`.\start-dev.ps1`
  - 结果：

## 冒烟记录（2026-03-15）
- 场景 A（Docker Desktop 关闭）：
  - 操作：运行临时测试脚本 `.\test-redis-docker.ps1`
  - 结果：脚本检测到引擎不可用后自动拉起 Docker Desktop 并等待；随后成功启动 Redis 容器。
- 场景 B（Docker Desktop 已启动）：
  - 操作：`docker exec lms-redis redis-cli ping`
  - 结果：输出 `PONG`；Docker Desktop 里可见容器 `lms-redis` 正常运行。
