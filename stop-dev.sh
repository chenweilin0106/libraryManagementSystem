#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

SESSION_NAME="lms-dev"

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "未找到命令：$name。请先安装并加入 PATH。" >&2
    exit 1
  fi
}

require_command tmux

DOCKER_AVAILABLE=1
if ! command -v docker >/dev/null 2>&1; then
  DOCKER_AVAILABLE=0
  echo "警告：未找到命令：docker，将跳过停止容器，仅关闭 tmux session：$SESSION_NAME" >&2
elif ! docker info >/dev/null 2>&1; then
  DOCKER_AVAILABLE=0
  echo "警告：Docker 引擎不可用，将跳过停止容器，仅关闭 tmux session：$SESSION_NAME" >&2
fi

if [ "$DOCKER_AVAILABLE" -eq 1 ]; then
  echo "停止 Redis：docker compose -f docker/redis/compose.yml down（保留数据卷）"
  if [ -f "$ROOT/docker/redis/compose.yml" ]; then
    docker compose -f "$ROOT/docker/redis/compose.yml" down || true
  else
    echo "未找到文件：docker/redis/compose.yml（跳过）"
  fi

  echo "停止 MongoDB：docker compose -f docker/mongo/compose.yml down（保留数据卷）"
  if [ -f "$ROOT/docker/mongo/compose.yml" ]; then
    docker compose -f "$ROOT/docker/mongo/compose.yml" down || true
  else
    echo "未找到文件：docker/mongo/compose.yml（跳过）"
  fi
fi

echo "停止前端/后端：tmux kill-session -t $SESSION_NAME"
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

if [ "$DOCKER_AVAILABLE" -eq 0 ]; then
  echo "提示：由于 Docker 不可用，本次未执行 docker compose down；Docker 可用后请再运行一次 ./stop-dev.sh（容器可能因 restart: unless-stopped 自动重启）。" >&2
fi

echo "已停止。"
