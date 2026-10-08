# herdr の plugin（syaku.telop-notify）が pane.agent_status_changed を受けるたびに呼ぶ。Mac 用。
# Windows では同じ処理を notify.ps1 が行う。
# 入力待ち（blocked）と完了（done）になったときだけ、pane の題名を送信元にして telop に送る。
# jq は macOS 15 から /usr/bin に入っているので、Homebrew の無い Mac でも動く。
set -euo pipefail

jq=/usr/bin/jq
# plugin は herdr のサーバーから起動され、PATH に ~/.local/bin があるとは限らないので、絶対パスで呼ぶ。
telop="${TELOP_BIN:-$HOME/.local/bin/telop}"

event="${HERDR_PLUGIN_EVENT_JSON:-}"
status="$("$jq" -r '.data.agent_status // empty' <<<"$event")"

case "$status" in
blocked)
	level=warn
	text="入力待ちになりました"
	;;
done)
	level=info
	text="完了しました"
	;;
*) exit 0 ;;
esac

herdr="${HERDR_BIN_PATH:-herdr}"
pane_id="$("$jq" -r '.data.pane_id // empty' <<<"$event")"

# 出来事の title は schema にはあるが、実際の pane.agent_status_changed には入っていないことがあるので、
# 無ければ pane の題名を取り直す。取れなくても送る（送信元は pane ID になる）。
title="$("$jq" -r '.data.title // empty' <<<"$event")"
if [[ -z "$title" && -n "$pane_id" ]]; then
	title="$("$herdr" pane get "$pane_id" 2>/dev/null |
		"$jq" -r '.result.pane.terminal_title_stripped // .result.pane.terminal_title // empty')" || title=""
fi

# 題名の先頭の回転スピナーを落とし、空白をまとめる（agentbar のメニューの名前と同じ）。
# 落とすのは既知のグリフだけにする。非英数字を一律に落とすと、`~/workspace> …` や `【調査】…` の先頭まで削る。
name="$("$jq" -rn --arg title "$title" --arg pane "$pane_id" '
  def spinners: ["◐","◑","◒","◓","✳","✽","⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  def strip_spinner: sub("^\\s+"; "") as $t
    | if ($t | length) > 0 and (spinners | index($t[0:1])) != null then $t[1:] else $t end;
  ($title | strip_spinner | strip_spinner | strip_spinner | strip_spinner
    | gsub("\\s+"; " ") | sub("^ "; "") | sub(" $"; "")) as $name
  | if $name == "" then $pane else $name end')"

# カードのクリックで focus.sh がその pane に飛ぶ。telop-app の PATH には herdr が無いので絶対パスにし、
# 下パネルのような別のセッションの pane にも飛べるよう、この出来事を出した server の socket も渡す。
if [[ -z "$pane_id" ]]; then
	exec "$telop" send --source "$name" --level "$level" -- "$text"
fi
herdr_path="$(command -v "$herdr" || true)"
plugin_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
action="$("$jq" -cn --arg focus "$plugin_dir/focus.sh" --arg herdr "${herdr_path:-$herdr}" \
	--arg pane "$pane_id" --arg socket "${HERDR_SOCKET_PATH:-}" \
	'["/bin/bash", $focus, $herdr, $pane] + (if $socket == "" then [] else [$socket] end)')"
exec "$telop" send --source "$name" --level "$level" --action "$action" -- "$text"
