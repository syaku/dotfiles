#!/usr/bin/env bash
# vault-catalog の OpenSearch index を更新する。
# 通常は差分 ingest (last_run_iso 以降の content_hash 差分)。--full でフル再 ingest。
#
# Usage:
#   vault-catalog-reindex.sh              # 差分 ingest
#   vault-catalog-reindex.sh --full       # フル再 ingest (kuromoji 辞書変更時等)
#   vault-catalog-reindex.sh --no-rsync   # rsync をスキップ (k3s のノードは既に同期済み想定)
#   vault-catalog-reindex.sh --help       # このヘルプ
#
# 環境変数で上書き可能:
#   VAULT_LOCAL    Mac 側 vault notes/ ディレクトリ
#   K3S_HOST       k3s のノードの ssh の宛先 (~/.ssh/config の Host k3s)
#   SNAPSHOT_DST   k3s のノードの rsync 着信先 (indexer の Job が /vault として読む)
#   JOB_TIMEOUT    Job の完了を待つ秒数

set -euo pipefail

VAULT_LOCAL="${VAULT_LOCAL:-$HOME/workspace/notes/obsidian/Life/notes/}"
K3S_HOST="${K3S_HOST:-k3s}"
SNAPSHOT_DST="${SNAPSHOT_DST:-/srv/vault-catalog/vault-snapshot/notes/}"
JOB_TIMEOUT="${JOB_TIMEOUT:-1800}"

cronjob="indexer-incremental"
do_rsync="yes"

while [[ $# -gt 0 ]]; do
	case "$1" in
	--full) cronjob="indexer-full" ;;
	--no-rsync) do_rsync="no" ;;
	-h | --help)
		sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
		exit 0
		;;
	*)
		echo "unknown option: $1" >&2
		exit 2
		;;
	esac
	shift
done

if [[ "$do_rsync" == "yes" ]]; then
	echo "[reindex] rsync $VAULT_LOCAL -> $K3S_HOST:$SNAPSHOT_DST"
	rsync -a --delete "$VAULT_LOCAL" "$K3S_HOST:$SNAPSHOT_DST"
fi

# Mac の kubectl は k3s の API へのトンネルが要り、LaunchAgent から起動したときには張れないので、
# ノードの kubectl で CronJob から Job を作る。
# kubectl wait は complete と failed の片方しか待てず、失敗するとタイムアウトまで止まるので、Job の状態を読んで待つ。
job="${cronjob}-$(date +%Y%m%d%H%M%S)"
echo "[reindex] create job/$job from cronjob/$cronjob"
ssh "$K3S_HOST" "set -eu
  ns=vault-catalog
  kubectl -n \$ns create job --from=cronjob/$cronjob $job
  deadline=\$(( \$(date +%s) + $JOB_TIMEOUT ))
  while :; do
    state=\$(kubectl -n \$ns get job/$job -o jsonpath='{.status.succeeded}/{.status.failed}')
    case \"\$state\" in
      1/*) result=0; break ;;
      */[1-9]*) result=1; break ;;
    esac
    if [ \$(date +%s) -ge \$deadline ]; then echo '[reindex] timeout' >&2; result=1; break; fi
    sleep 5
  done
  kubectl -n \$ns logs job/$job --tail=20 || true
  exit \$result"
