#!/usr/bin/env bash
# Ontology OODA 决策平台一键启动脚本（Linux）
# 用法：./scripts/start.sh [--build]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# 端口可用环境变量覆盖；默认 3000/18000
BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-18000}"
export BACKEND_PORT FRONTEND_PORT

echo "==> 检查依赖"
if ! command -v docker >/dev/null 2>&1; then
  echo "错误：未找到 docker，请先安装 Docker" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "错误：Docker 守护进程未运行" >&2
  exit 1
fi

if ! command -v docker compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
  echo "错误：未找到 docker compose 插件" >&2
  exit 1
fi

echo "==> 端口配置：后端=${BACKEND_PORT} 前端=${FRONTEND_PORT}"

BUILD_FLAG=""
if [[ "${1:-}" == "--build" ]]; then
  BUILD_FLAG="--build"
fi

echo "==> 启动服务"
docker compose up -d ${BUILD_FLAG}

echo "==> 等待健康检查"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
    echo "后端已就绪"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "警告：后端健康检查超时，请查看 docker compose logs backend" >&2
    exit 1
  fi
  sleep 2
done

for i in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:${FRONTEND_PORT}/healthz" >/dev/null 2>&1; then
    echo "前端已就绪"
    break
  fi
  if [[ $i -eq 15 ]]; then
    echo "警告：前端健康检查超时，请查看 docker compose logs frontend" >&2
    exit 1
  fi
  sleep 2
done

echo ""
echo "启动完成："
echo "  前端: http://localhost:${FRONTEND_PORT}"
echo "  后端: http://localhost:${BACKEND_PORT}/api/health"
echo "  停止: ./scripts/stop.sh"
