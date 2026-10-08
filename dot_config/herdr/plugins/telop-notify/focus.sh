# telop のカードをクリックしたときに telop-app から起動される。Mac 用。Windows では focus.ps1 が同じことをする。
# 使い方: focus.sh <herdr の絶対パス> <pane_id> [<herdr の socket>]
# herdr の中のフォーカスをその pane に移し、WezTerm を前に出す。
# telop-app は herdr の環境を持たないので、herdr の場所と繋ぐ server（メインか下パネルか）は notify.sh が引数で渡す。
set -euo pipefail

herdr="$1"
pane_id="$2"
socket="${3:-}"

if [[ -n "$socket" ]]; then
	export HERDR_SOCKET_PATH="$socket"
fi
"$herdr" agent focus "$pane_id" >/dev/null
/usr/bin/open -a WezTerm
