#!/usr/bin/env bash
# 已部署实例的只读烟雾测试；完整闭环由 backend/tests/acceptance-api.test.ts 验证。
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3000/api}"
API_BASE="${API_BASE%/}"
if [[ "$API_BASE" != */api ]]; then API_BASE="$API_BASE/api"; fi

health="$(curl -fsS "$API_BASE/health")"
if [[ "$health" != *'"status":"ok"'* ]]; then
  echo "后端健康检查未通过" >&2
  exit 1
fi

unauthorized="$(curl -sS -o /dev/null -w '%{http_code}' "$API_BASE/cases")"
if [[ "$unauthorized" != 401 ]]; then
  echo "未登录访问应返回 401，实际 $unauthorized" >&2
  exit 1
fi

echo "健康检查与未登录保护通过：$API_BASE"
