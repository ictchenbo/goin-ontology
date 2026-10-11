#!/usr/bin/env bash
# 在线备份 SQLite 与附件，输出可恢复的 tar.gz 包。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
DEST="${1:-backups/ooda-$(date +%Y%m%d-%H%M%S).tar.gz}"
mkdir -p "$(dirname "$DEST")"
if ! docker inspect ontology-ooda-api >/dev/null 2>&1; then
  echo "后端容器不存在，无法在线备份" >&2
  exit 1
fi
docker exec ontology-ooda-api node dist/db/backup.js /data/ontology-backup.db
docker exec ontology-ooda-api sh -c 'mkdir -p /data/attachments && tar -czf /data/backup-bundle.tar.gz -C /data ontology-backup.db attachments'
docker cp ontology-ooda-api:/data/backup-bundle.tar.gz "$DEST"
docker exec ontology-ooda-api sh -c 'rm -f /data/ontology-backup.db /data/backup-bundle.tar.gz'
echo "备份完成：$DEST"
