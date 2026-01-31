# 后端约定（backend）

## 技术栈与目标
- Node.js + TypeScript + Koa
- REST API（统一前缀 `/api`）
- MongoDB：使用官方 `mongodb` driver（不使用 ORM/ODM，如 Mongoose/Prisma）

## 当前已提供能力
- 入口：`src/server.ts`
- 应用组装：`src/app.ts`
- 路由：`src/routes/*`
- Mongo 连接：`src/db/mongo.ts`
- 健康检查：`GET /api/health`

## 接口与错误约定
- 统一返回：`{ code, message, data }`
  - 成功：`code=0`
  - 失败：`code=HTTP状态码`，`data=null`
- 统一错误处理中间件：`src/middlewares/error-handler.ts`
- 未命中路由返回 404：`{ code:404, message:'Not Found', data:null }`

## 配置（环境变量）
- `PORT`：服务端口（默认 3000）
- `MONGODB_URI`：MongoDB 连接串（默认 `mongodb://127.0.0.1:27017`）
- `MONGODB_DB`：数据库名（默认 `library`）
- 建议使用 `backend/.env`（可参考 `backend/.env.example`）

## 代码组织建议（新增功能时）
- 路由与控制器：`src/routes/`
- 数据访问层：`src/db/`（尽量把 collection 操作封装成模块）
- 参数校验/转换：放在 `src/utils/` 或按业务新建 `src/validators/`
- 通用中间件：`src/middlewares/`

