# Redis 接入计划 v1.0（2026-03-14）

## 背景
- 现状：后端以 MongoDB 为主存储，部分高频读接口（如图书列表、数据分析总览）可能在数据量上来后出现响应变慢。
- 目标：引入 Redis 作为缓存与临时计算结果存储，优先优化“读多写少/计算重”的接口，且不改变前端的接口形态（以 `backend/API_CONTRACT.md` 为准）。
- 运行方式：开发环境借助 Docker Desktop（WSL2 后端）启动 Redis 容器。

## 论文需求对齐（摘要）
结合你的论文中的描述，本项目的 Redis 主要用于：
- 热点数据缓存：热门图书列表、各种查询结果（减少对 MongoDB 的高频读取压力）。
- 数据分析缓存：统计类接口（全量统计/聚合计算）结果缓存或“增量数据”缓存。
- Redis 键值设计示例（论文口径）：
  - 热门图书榜单：`rank:hot_books`（ZSET，score=借阅次数，member=图书ID）
  - （可选）接口限流：`limit:req:{ip}`（String，TTL=1分钟）
- （可选增强）鉴权：论文提到“JWT + Redis 黑名单”。但当前项目 refresh 会轮换 accessToken，是否需要黑名单需结合现有会话策略再决定（建议后置）。

## 目标
- 本地一键启动 Redis（容器化），并可在 Windows/WSL2 环境稳定使用。
- 后端提供可开关的 Redis 连接（未启用 Redis 时不影响现有功能）。
- 对关键接口增加缓存（先小步落地），具备明确的失效策略与可观测性（日志/指标至少二选一）。

## 范围
### 本次计划包含
- 新增开发环境 Redis 的 Docker Compose 配置（仅 dev 用，不强行替代现有 MongoDB Windows 服务启动方式）。
- 后端新增 Redis 客户端封装与缓存工具方法（JSON 序列化、TTL、错误降级）。
- 缓存落地点（第一批）：
  - `GET /api/books`（列表分页/筛选）
  - `GET /api/analytics/overview`（按 `mode` 维度缓存，优先 `dynamic/hybrid`）
  - （可选）`GET /api/books/:isbn`（借书抽屉查询）

### 本次计划不包含
- 生产环境部署方案（后续单独补一份部署/运维说明）。
- 鉴权/会话策略改造（当前 refresh cookie 机制保持不变）。
- 前端页面改动（除非为了展示性能数据，且需要你额外确认）。

## 方案与改动点
### 0. 环境（已完成）
- 已在仓库内提供：`docker/redis/compose.yml`
- 已在 `RUNNING.md` 增加启动/自检/停止命令
- 当前本机验证：`lms-redis` 容器可健康运行，`redis-cli ping` 返回 `PONG`

### A. Docker：提供 Redis 服务（dev）
- 新增：`docker/redis/compose.yml`（或仓库根 `compose.redis.yml`，二选一，最终以你确认的目录为准）
  - 镜像：固定一个明确版本（例如 `redis:7-alpine`），避免“latest 漂移”
  - 端口：仅绑定到本机环回，避免局域网暴露（示例：`127.0.0.1:6379:6379`）
  - 持久化：可选（默认开 volume，便于调试；也可在 dev 关闭以保持无状态）
  - 健康检查：`redis-cli ping`

### B. 后端：Redis 连接与开关
- 依赖选择：优先使用官方 `redis`（node-redis）客户端（如你们更偏好 `ioredis`，可改用）
- 配置项（新增到 `backend/.env.example`，并在 `backend/src` 配置加载处接入）：
  - `REDIS_ENABLED=1|0`（默认 0）
  - `REDIS_URL=redis://127.0.0.1:6379/0`
  - `REDIS_KEY_PREFIX=lms:`（避免与其他项目冲突）
  - `REDIS_DEFAULT_TTL_SECONDS=30`（默认 TTL，按接口单独覆盖）
- 运行策略：
  - `REDIS_ENABLED=0`：完全不连接 Redis
  - Redis 连接失败：记录告警日志并自动降级为“不走缓存”（不影响业务正确性）

### C. 缓存 Key 与失效策略（避免扫库式 DEL）
- 基础：统一 key 前缀 `lms:` + 资源名 + 版本号 + 业务维度（query/模式等）
- 推荐策略：为每类资源维护一个“版本号”（`INCR`），把版本号拼进缓存 key，实现“写入即全量失效”的效果：
  - `lms:ver:books`
  - `lms:ver:borrows`（用于 analytics）
  - `lms:ver:users`（用于 analytics）
- 示例（概念）：
  - `lms:books:list:v{booksVer}:{hash(query)}`
  - `lms:analytics:overview:v{booksVer}-{borrowsVer}-{usersVer}:{mode}`
- 写操作触发版本号递增（落地点示例）：
  - 图书：新增/编辑/上架下架/导入提交 → `INCR lms:ver:books`
  - 借阅：借书/预约/取消/还书 → `INCR lms:ver:borrows`
  - 用户：新增/编辑/删除/重置密码/导入提交 → `INCR lms:ver:users`

### D. 接口落地（第一批）
- `GET /api/books`
  - TTL：建议 10–30s（按页面刷新频率调）
  - 缓存维度：完整 query（page/pageSize/title/author/isbn/category/status/sortBy/sortOrder）
- `GET /api/analytics/overview`
  - TTL：建议 10–30s
  - 缓存维度：`mode`（`static|dynamic|hybrid`）
- （可选）`GET /api/books/:isbn`
  - TTL：建议 60–300s
  - 失效：`booksVer` 变化自动失效

### E. 接口落地（第二批：缓存各种查询）
按“收益/风险比”从高到低：

- `GET /api/books/:isbn`
  - 场景：借阅/预约抽屉查询
  - TTL：60–300s
  - Key：`ver:books + isbn`
- `GET /api/borrows/my`
  - 场景：用户端“借阅记录/预约记录”列表会频繁刷新
  - TTL：5–15s（注意该接口的 `status` 依赖“当前时间”计算，TTL 不宜过长）
  - Key：`ver:borrows + userId + queryHash`
- `GET /api/borrows`（管理员列表）
  - TTL：5–15s（同上，`status` 依赖当前时间）
  - Key：`ver:borrows + queryHash`
- `GET /api/users`（管理员列表）
  - TTL：10–30s
  - Key：`ver:users + queryHash`
- 第三批（更偏“减少无意义请求”，可后置）：
  - `GET /api/menu/all`（按 role 缓存）
  - `GET /api/auth/codes`（按 role 缓存）
  - `GET /api/user/info`（按 userId 缓存，用户资料变更时失效）

### D.1 后续阶段（先写进计划，不在第一批做）
- 热门图书榜单（论文键值：`rank:hot_books`）
  - 借阅成功时：`ZINCRBY` 借阅次数
  - 展示接口：可新增 `GET /api/analytics/hot-books`（或复用现有 analytics 返回 topCategories/榜单字段）
- （可选）接口限流（论文键值：`limit:req:{ip}`）
  - 仅用于保护极易被刷的统计/查询接口（例如数据分析），并提供开关
- （可选）JWT 黑名单
  - 需要与现有“refresh 轮换 accessToken”策略一起评估，避免重复与复杂化

### E. 可观测性（最小可用）
- 日志（至少）：
  - Redis 连接成功/失败
  - 缓存命中/未命中（可按 debug 级别）
  - 缓存写入失败（降级提示）
- （可选）在 `GET /api/analytics/overview` 返回头里加 `X-Cache: HIT|MISS`（仅 dev，生产关闭）

## 验收点
- Redis 容器能稳定启动：`docker compose ... up -d` 后 `redis-cli ping` 返回 `PONG`。
- `backend` 在 `REDIS_ENABLED=1` 时可连接 Redis；在 `REDIS_ENABLED=0` 或 Redis 宕机时不影响接口可用性（仅无缓存）。
- 第一批接口缓存生效：
  - 连续请求 `GET /api/books` / `GET /api/analytics/overview` 有明显命中（日志或 `X-Cache`）。
  - 发生写操作后（如新增图书/借书），对应缓存能按版本号策略立即失效。
- 第二批接口缓存生效：
  - `GET /api/books/:isbn`、`GET /api/borrows/my`、`GET /api/borrows`、`GET /api/users` 连续请求可命中缓存（可用 Redis key 数量变化或 debug 日志确认）。
  - 发生写操作后（图书维护/借阅流程/用户维护）相关缓存能通过版本号立即失效。

## 变更记录
- 2026-03-14：创建本计划文档（待你确认后再开始实际开发与改代码）。

## 冒烟记录
- 2026-03-14（已通过）
  - 环境：
    - Docker Desktop：Engine running
    - Redis 容器：`lms-redis`（`redis-cli ping` = `PONG`）
    - MongoDB Windows 服务：`MongoDB`（Running）
  - 冒烟步骤（临时端口避免冲突）：
    - 启动后端：`PORT=3010 REDIS_ENABLED=1 node backend/dist/server.js`
    - 调用健康检查：`GET /api/health`（期望 `data.status=ok`）
    - 登录拿 token：`POST /api/auth/login`（admin/123456）
    - 连续两次请求：
      - `GET /api/books?page=1&pageSize=20`
      - `GET /api/analytics/overview?mode=hybrid`
    - Redis 自检：统计缓存 key（`docker exec lms-redis redis-cli --scan --pattern 'lms:cache:*'`）
  - 结果：
    - Books 列表缓存 key 数量：`1`
    - Analytics overview 缓存 key 数量：`1`
    - 说明：已确认在 `REDIS_ENABLED=1` 时接口可正常返回且缓存可写入；Redis 连接失败时会自动降级为“不走缓存”（不影响接口正确性）。

- 2026-03-14（已通过，第二批：缓存各种查询）
  - 环境：
    - Redis 容器：`lms-redis`（`PING=PONG`）
    - MongoDB Windows 服务：`MongoDB`（Running）
  - 冒烟步骤（临时端口）：
    - 启动后端：`PORT=3011 REDIS_ENABLED=1 node backend/dist/server.js`
    - 登录：
      - 管理员：admin/123456（用于 `/books`、`/books/:isbn`、`/analytics/overview`、`/users`、`/borrows`）
      - 普通用户：vben/123456（用于 `/borrows/my`）
    - 对每个接口连续请求两次（验证可命中缓存）：
      - `GET /api/books?page=1&pageSize=20`
      - `GET /api/books/:isbn`（取列表第 1 条的 isbn）
      - `GET /api/analytics/overview?mode=hybrid`
      - `GET /api/users?page=1&pageSize=20`
      - `GET /api/borrows?page=1&pageSize=20&status=all`
      - `GET /api/borrows/my?page=1&pageSize=20&status=all`
    - Redis 自检：统计缓存 key（`redis-cli --scan --pattern 'lms:cache:*'`）
    - 版本号失效自检：`INCR lms:ver:books` 后再次请求 `GET /api/books`，确认生成新版本 key
  - 结果：
    - 缓存 key 数量：
      - `books:list=1`、`books:isbn=1`、`analytics=1`、`users:list=1`、`borrows:list=1`、`borrows:my=1`
    - 版本号失效：
      - `books:list` key 数量从 `1` 增长到 `2`（符合“版本号变化生成新 key”的预期）

- 2026-03-14（已通过：热门图书榜单 `rank:hot_books`）
  - 接口：
    - `GET /api/analytics/hot-books?limit=10`（管理员）
  - 写入规则：
    - 管理员借阅接口 `POST /api/borrows/borrow` 成功后：`ZINCRBY rank:hot_books +1`（member=`B-${isbn}`）
    - 预约取书转“借阅中”（同接口内部处理）同样会递增一次
  - 回退策略：
    - Redis 未启用/暂无榜单数据：回退 MongoDB 聚合统计（仅用于保证接口可用）
  - 冒烟结果：
    - `GET /api/analytics/hot-books` 可正常返回（Redis 榜单为空时回退生效）
    - 执行一次“借阅 + 归还”后，`ZSCORE rank:hot_books B-<isbn>` 从空变为 `1`（榜单计数递增生效）

- 2026-03-14（已通过：接口限流 `limit:req:{ip}`）
  - 开关与参数（见 `backend/.env.example`）：
    - `RATE_LIMIT_ENABLED=1`
    - `RATE_LIMIT_WINDOW_SECONDS=60`
    - `RATE_LIMIT_MAX_REQUESTS=2`（冒烟时为了快速验证临时调小）
  - 限流范围（当前先保护较重接口）：
    - `GET /api/analytics/overview`
    - `GET /api/analytics/hot-books`
  - 冒烟步骤：
    - 启动后端：`PORT=3014 REDIS_ENABLED=1 RATE_LIMIT_ENABLED=1 RATE_LIMIT_MAX_REQUESTS=2 node backend/dist/server.js`
    - 管理员登录后连续请求 3 次 `GET /api/analytics/overview?mode=hybrid`
  - 结果：
    - 第 1、2 次返回 200，第 3 次返回 429（限流生效）
