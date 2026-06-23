#!/usr/bin/env bash
# vault-catalog の OpenSearch index を更新する。
# 通常は差分 ingest (last_run_iso 以降の content_hash 差分)。--full でフル再 ingest。
#
# Usage:
#   vault-catalog-reindex.sh              # 差分 ingest
#   vault-catalog-reindex.sh --full       # フル再 ingest (kuromoji 辞書変更時等)
#   vault-catalog-reindex.sh --no-rsync   # rsync をスキップ (apps-vm 側は既に同期済み想定)
#   vault-catalog-reindex.sh --help       # このヘルプ
#
# 環境変数で上書き可能 (apps-vm 構成が変わった場合):
#   VAULT_LOCAL    Mac 側 vault notes/ ディレクトリ
#   APPS_VM_HOST   apps-vm のホスト名
#   SNAPSHOT_DST   apps-vm 側 rsync 着信先
#   COMPOSE_DIR    apps-vm 側 compose stack ディレクトリ

set -euo pipefail

VAULT_LOCAL="${VAULT_LOCAL:-$HOME/workspace/notes/obsidian/Life/notes/}"
APPS_VM_HOST="${APPS_VM_HOST:-app.syaku.me}"
SNAPSHOT_DST="${SNAPSHOT_DST:-/srv/vault-catalog/vault-snapshot/notes/}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/apps/vault-catalog}"

full=""
do_rsync="yes"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --full) full="--full" ;;
    --no-rsync) do_rsync="no" ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [[ "$do_rsync" == "yes" ]]; then
  echo "[reindex] rsync $VAULT_LOCAL -> $APPS_VM_HOST:$SNAPSHOT_DST"
  rsync -a --delete "$VAULT_LOCAL" "$APPS_VM_HOST:$SNAPSHOT_DST"
fi

# docker compose run は引数を渡すと CMD を上書きするため、--full を渡すときは
# Dockerfile CMD と同じ引数列を明示する (フル ingest の頻度は低く drift 容認)。
# 差分時は引数なしで Dockerfile CMD のまま実行する。
if [[ -n "$full" ]]; then
  echo "[reindex] docker compose run --rm indexer (full)"
  ssh "$APPS_VM_HOST" "cd '$COMPOSE_DIR' && docker compose run --rm indexer \
    --vault /vault --scope notes --ingest \
    --embed-url http://embed:8080/embed \
    --opensearch-url http://opensearch:9200 \
    --index vault-notes \
    --state-index vault-notes-state \
    --full"
else
  echo "[reindex] docker compose run --rm indexer (incremental)"
  ssh "$APPS_VM_HOST" "cd '$COMPOSE_DIR' && docker compose run --rm indexer"
fi
