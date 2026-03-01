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

## 常见问题

- 后端连不上 MongoDB：先确认 MongoDB 服务已启动；如需修改连接串/库名，可查看 `backend/.env`（如存在）或按 `backend/` 内配置说明调整。
- 登录账号：后端会自动初始化内置账号（如不存在则创建）`admin`、`vben`，默认密码 `123456`。
