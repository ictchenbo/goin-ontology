#!/usr/bin/env bash
# 先生成当前数据备份，再停机恢复指定归档。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "用法：./scripts/restore.sh <backup.tar.gz>" >&2
  exit 1
fi
ARCHIVE="$(realpath "$1")"
if ! tar -tzf "$ARCHIVE" | grep -qx 'ontology-backup.db'; then
  echo "归档中缺少 ontology-backup.db" >&2
  exit 1
fi
VOLUME="$(docker inspect ontology-ooda-api --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')"
if [[ ! "$VOLUME" =~ ^[a-zA-Z0-9_.-]+$ ]]; then
  echo "无法确认 /data 数据卷" >&2
  exit 1
fi
./scripts/backup.sh "backups/pre-restore-$(date +%Y%m%d-%H%M%S).tar.gz"
docker compose stop frontend backend
docker run --rm -v "$VOLUME:/data" -v "$ARCHIVE:/backup.tar.gz:ro" alpine sh -c \
  'set -e; cd /data; tar -xzf /backup.tar.gz; rm -f ontology.db-wal ontology.db-shm; mv ontology-backup.db ontology.db'
docker compose up -d
echo "恢复完成，请检查 /api/health"
