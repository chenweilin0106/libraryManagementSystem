#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

SESSION_NAME="lms-dev"
HOST_ALL=0
NO_ATTACH=0
FRONTEND_PORT="5777"

usage() {
  cat <<'EOF'
用法：
  ./start-dev.sh [--host-all] [--no-attach]

参数：
  --host-all    前端以 --host 0.0.0.0 启动（Windows 侧访问不到 localhost 时的兜底）
  --no-attach   启动后不自动 attach 到 tmux（便于脚本化/CI/自检）
EOF
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "未找到命令：$name。请先安装并加入 PATH。" >&2
    exit 1
  fi
}

wait_container_healthy() {
  local container_name="$1"
  local timeout_seconds="${2:-60}"
  local interval_seconds="${3:-2}"

  local elapsed=0

  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    local status
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container_name" 2>/dev/null || true)"

    if [ "$status" = "healthy" ] || [ "$status" = "no-healthcheck" ]; then
      return 0
    fi

    if [ "$elapsed" -eq 0 ]; then
      echo "等待容器就绪：$container_name ..."
    fi

    sleep "$interval_seconds"
    elapsed=$((elapsed + interval_seconds))
  done

  echo "等待容器就绪超时：$container_name（${timeout_seconds}s）。可用 'docker ps' / 'docker logs $container_name' 排查。" >&2
  return 1
}

load_frontend_port() {
  local env_file="$ROOT/vue-vben-admin/apps/web-ele/.env.development"
  if [ ! -f "$env_file" ]; then
    return 0
  fi

  local line
  line="$(grep -E '^[[:space:]]*VITE_PORT=' "$env_file" | head -n 1 || true)"
  if [ -z "$line" ]; then
    return 0
  fi

  local port="${line#VITE_PORT=}"
  port="${port%$'\r'}"
  port="${port%\"}"
  port="${port#\"}"
  port="${port%\'}"
  port="${port#\'}"

  if [[ "$port" =~ ^[0-9]+$ ]]; then
    FRONTEND_PORT="$port"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host-all)
      HOST_ALL=1
      shift
      ;;
    --no-attach)
      NO_ATTACH=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command docker
require_command tmux
require_command pnpm

load_frontend_port

if ! docker info >/dev/null 2>&1; then
  echo "Docker 引擎不可用。请先确认 Docker Desktop / docker engine 已启动。" >&2
  exit 1
fi

if [ ! -f "$ROOT/docker/mongo/compose.yml" ]; then
  echo "未找到文件：docker/mongo/compose.yml" >&2
  exit 1
fi

if [ ! -f "$ROOT/docker/redis/compose.yml" ]; then
  echo "未找到文件：docker/redis/compose.yml" >&2
  exit 1
fi

echo "启动 Mongo：docker compose -f docker/mongo/compose.yml up -d"
docker compose -f "$ROOT/docker/mongo/compose.yml" up -d

echo "启动 Redis：docker compose -f docker/redis/compose.yml up -d"
docker compose -f "$ROOT/docker/redis/compose.yml" up -d

wait_container_healthy "lms-mongo" 60 2 || true
wait_container_healthy "lms-redis" 60 2 || true

echo "Redis 自检：docker exec lms-redis redis-cli ping（期望输出：PONG）"
docker exec lms-redis redis-cli ping || true

echo "Mongo 自检：docker exec lms-mongo mongosh --quiet --eval \"db.adminCommand({ ping: 1 })\""
docker exec lms-mongo mongosh --quiet --eval 'db.adminCommand({ ping: 1 })' || true

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "检测到 tmux session 已存在：$SESSION_NAME（将直接 attach）"
else
  echo "创建 tmux session：$SESSION_NAME"

  tmux new-session -d -s "$SESSION_NAME" -n mongo "bash -lc 'docker logs -f lms-mongo'"
  tmux new-window -t "$SESSION_NAME" -n redis "bash -lc 'docker logs -f lms-redis'"
  tmux new-window -t "$SESSION_NAME" -n backend "bash -lc 'cd \"$ROOT\" && pnpm -C backend dev'"

  # 备注：在部分环境中，Vite + Node 20 可能触发 V8 的 fatal error（SIGILL）。
  # 使用 --no-turbo-inlining 作为兜底，避免开发服务器异常退出。
  frontend_cmd="node --no-turbo-inlining ../../node_modules/vite/bin/vite.js --mode development --port $FRONTEND_PORT"
  if [ "$HOST_ALL" -eq 1 ]; then
    frontend_cmd="$frontend_cmd --host 0.0.0.0"
  fi
  tmux new-window -t "$SESSION_NAME" -n frontend "bash -lc 'cd \"$ROOT/vue-vben-admin/apps/web-ele\" && $frontend_cmd'"

  tmux set-option -t "$SESSION_NAME" -g remain-on-exit on
  tmux select-window -t "$SESSION_NAME:backend"
fi

if [ "$NO_ATTACH" -eq 1 ]; then
  echo "已启动。手动进入：tmux attach -t $SESSION_NAME"
  exit 0
fi

exec tmux attach -t "$SESSION_NAME"
