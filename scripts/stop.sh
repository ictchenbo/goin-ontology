#!/usr/bin/env bash
# Ontology OODA 决策平台一键停止脚本（Linux）
# 用法：./scripts/stop.sh [--down]
#   --down 同时删除容器与网络（数据卷默认保留）
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> 停止服务"
if [[ "${1:-}" == "--down" ]]; then
  docker compose down
  echo "容器与网络已移除（数据卷 ooda-data 保留；如需清理：docker volume rm ooda-data）"
else
  docker compose stop
  echo "服务已停止"
fi
