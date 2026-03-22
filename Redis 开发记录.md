# Redis 开发记录

## 适用范围
- 功能：Redis 接入、缓存、限流、一键启动中的 Redis 启动逻辑。
- 相关文件：
  - `docker/redis/compose.yml`
  - `backend/src/db/redis.ts`
  - `backend/src/utils/redis-cache.ts`
  - `backend/src/utils/rate-limit.ts`
  - `backend/src/routes/analytics.ts`
  - `start-dev.ps1`

## 当前状态
- 已接入开发环境 Redis（Docker）。
- 已落地缓存、限流。
- `start-dev.ps1` 已支持在 Docker 引擎未就绪时自动尝试拉起 Docker Desktop 并等待。

## 目录
- `2026-03-14 v1.0`：Redis 接入方案、缓存与榜单/限流落地
- `2026-03-15 v1.1`：Redis tab 启动修复

---

## 2026-03-14 v1.0

### 背景
- 后端以 MongoDB 为主存储，部分高频读接口在数据量增大后可能变慢。
- 目标是引入 Redis 作为缓存与临时计算结果存储，不改变现有前端接口形态。
- 开发环境通过 Docker Desktop / WSL2 启动 Redis 容器。

### 论文需求对齐
- 热点数据缓存：查询结果。
- 数据分析缓存：统计类接口结果。
- 键值示例：
  - 限流：`limit:req:{ip}`
- JWT 黑名单暂不纳入本次范围，避免与现有 refresh 轮换策略重复。

### 本次范围
- 新增开发环境 Redis Compose 配置。
- 后端新增 Redis 客户端封装与缓存工具方法。
- 第一批缓存接口：
  - `GET /api/books`
  - `GET /api/analytics/overview`
  - `GET /api/books/:isbn`
- 第二批缓存接口：
  - `GET /api/borrows/my`
  - `GET /api/borrows`
  - `GET /api/users`
- 新增可开关限流（当前先保护 analytics 相关接口）。

### 不包含
- 生产环境部署方案。
- 鉴权/会话策略改造。
- 与 Redis 无直接关系的前端页面改造。

### 方案与改动点
#### Docker
- 提供 `docker/redis/compose.yml`
  - 镜像：`redis:7-alpine`
  - 端口：`127.0.0.1:6379:6379`
  - 持久化：volume `lms-redis-data`
  - 健康检查：`redis-cli ping`

#### 后端配置
- `backend/.env.example` 新增：
  - `REDIS_ENABLED`
  - `REDIS_URL`
  - `REDIS_KEY_PREFIX`
  - `REDIS_DEFAULT_TTL_SECONDS`
  - `RATE_LIMIT_ENABLED`
  - `RATE_LIMIT_WINDOW_SECONDS`
  - `RATE_LIMIT_MAX_REQUESTS`
- 策略：
  - `REDIS_ENABLED=0` 时完全不连接 Redis
  - Redis 连接失败自动降级为“不走缓存”

#### 缓存 key 与失效
- 前缀：`lms:`
- 使用版本号避免扫库式删除：
  - `lms:ver:books`
  - `lms:ver:borrows`
  - `lms:ver:users`
- 典型 key：
  - `cache:books:list:v{ver}:{hash}`
  - `cache:analytics:overview:v{books-borrows-users}:{mode}`
  - `cache:borrows:list:v{ver}:{hash}`
  - `cache:users:list:v{ver}:{hash}`

#### 限流
- key 形态：`limit:req:{ip}:{scope}`
- 采用固定窗口：
  - 首次请求 `INCR` 后设置 TTL
  - 超过阈值返回 `429`
- 当前保护接口：
  - `GET /api/analytics/overview`

### 验收点
- Redis 容器可稳定启动并返回 `PONG`
- `REDIS_ENABLED=1` 时缓存可命中；关闭或 Redis 宕机时接口仍正常
- 写操作后对应缓存能通过版本号立即失效
- 限流开启后可正确返回 `429`

### 冒烟记录
#### 2026-03-14：第一批缓存
- 环境：
  - Docker Desktop：Engine running
  - Redis：`lms-redis`，`redis-cli ping = PONG`
  - MongoDB 服务：`Running`
- 步骤：
  - 启动后端：`PORT=3010 REDIS_ENABLED=1 node backend/dist/server.js`
  - 连续请求：
    - `GET /api/books?page=1&pageSize=20`
    - `GET /api/analytics/overview?mode=hybrid`
  - 使用 `redis-cli --scan --pattern 'lms:cache:*'` 检查 key
- 结果：
  - `books` 列表缓存 key = `1`
  - `analytics overview` 缓存 key = `1`

#### 2026-03-14：第二批缓存
- 连续请求：
  - `GET /api/books`
  - `GET /api/books/:isbn`
  - `GET /api/analytics/overview`
  - `GET /api/users`
  - `GET /api/borrows`
  - `GET /api/borrows/my`
- 结果：
  - 各接口均生成对应缓存 key
  - `INCR lms:ver:books` 后生成新版本 key，符合预期

#### 2026-03-14：限流
- 参数：
  - `RATE_LIMIT_ENABLED=1`
  - `RATE_LIMIT_WINDOW_SECONDS=60`
  - `RATE_LIMIT_MAX_REQUESTS=2`
- 步骤：
  - 连续请求 3 次 `GET /api/analytics/overview?mode=hybrid`
- 结果：
  - 第 1、2 次返回 `200`
  - 第 3 次返回 `429`

---

## 2026-03-22 v1.2

### 范围
- 移除未被页面使用的热门图书榜单接口：`GET /api/analytics/hot-books`。
- 同步移除相关 Redis ZSET 统计逻辑（`rank:hot_books`）与借阅成功时的递增动作。

### 验收点
- 后端不再暴露 `/api/analytics/hot-books`。
- Redis 仅保留缓存与限流相关 key，不再依赖 `rank:hot_books`。

---

## 2026-03-15 v1.1

### 范围
- 仅调整 `start-dev.ps1` 中 Redis tab 的启动逻辑。
- 不改后端/前端/数据库/Redis compose 内容。

### 现状问题
- Docker Desktop 未启动或引擎未就绪时，脚本会连续执行多个失败命令并刷屏。
- 之前只提示“请先打开 Docker Desktop”，不会自动拉起或等待引擎就绪。

### 目标
- 检测 Docker 引擎不可用时：
  1. 尝试拉起 Docker Desktop
  2. 轮询等待引擎就绪
  3. 就绪后再执行 `docker compose up -d`
- 若超时，输出一次清晰错误并停止后续动作。

### 方案与改动点
- 新增 Docker 引擎预检：优先 `docker info`
- 引擎不可用时：
  - 尝试 `Start-Service com.docker.service`
  - 尝试 `Start-Process Docker Desktop.exe`
  - 等待最多 `120s`
- 所有 `docker ...` 调用统一包装为“失败即 throw”

### 验收点
- Docker Desktop 关闭时，脚本能自动尝试拉起并等待
- 引擎就绪后能成功启动 Redis 容器
- 超时时只输出一次清晰错误

### 冒烟记录
- 场景 A：Docker Desktop 关闭
  - 操作：运行 `.\test-redis-docker.ps1`
  - 结果：成功自动拉起 Docker Desktop 并启动 Redis 容器
- 场景 B：Docker Desktop 已启动
  - 操作：`docker exec lms-redis redis-cli ping`
  - 结果：输出 `PONG`
