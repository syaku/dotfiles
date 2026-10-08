# herdr の plugin（syaku.telop-notify）が pane.agent_status_changed を受けるたびに呼ぶ。Mac 用。
# Windows では同じ処理を notify.ps1 が行う。
# 入力待ち（blocked）と完了（done）になったときだけ、pane の題名を送信元にして telop に送る。
# jq は macOS 15 から /usr/bin に入っているので、Homebrew の無い Mac でも動く。
set -euo pipefail

jq=/usr/bin/jq

# herdr のカードは紫の地にし、入力待ちと完了をアイコン（telop が持つ Phosphor の名前）で分ける。
color="#6a4bb0"

# telop send を通さず、受け口へ 1 行の JSON を直接書く。telop send に --color と --icon を渡すと、
# 古い telop が知らないオプションとして本文ごと拒むので、telop を先に更新するまでカードが出なくなる。
# 受け口の場所は telop の README の取り決め（TELOP_SOCKET で上書き、空なら決まらない）に合わせる。
if [[ -n "${TELOP_SOCKET+set}" ]]; then
	socket="$TELOP_SOCKET"
elif [[ -n "${HOME:-}" ]]; then
	socket="$HOME/.config/telop/telop.sock"
else
	socket=""
fi
if [[ -z "$socket" ]]; then
	echo "telop の受け口の場所が決まりません（HOME か TELOP_SOCKET が空）" >&2
	exit 1
fi

event="${HERDR_PLUGIN_EVENT_JSON:-}"
status="$("$jq" -r '.data.agent_status // empty' <<<"$event")"

case "$status" in
blocked)
	level=warn
	icon=hand
	text="入力待ちになりました"
	;;
done)
	level=info
	icon=confetti
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
# pane ID が無ければ飛ぶ先が無いので、action を付けない。
action=null
if [[ -n "$pane_id" ]]; then
	herdr_path="$(command -v "$herdr" || true)"
	plugin_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
	action="$("$jq" -cn --arg focus "$plugin_dir/focus.sh" --arg herdr "${herdr_path:-$herdr}" \
		--arg pane "$pane_id" --arg socket "${HERDR_SOCKET_PATH:-}" \
		'["/bin/bash", $focus, $herdr, $pane] + (if $socket == "" then [] else [$socket] end)')"
fi

# 受け口は改行で行を区切るので、-c で 1 行にする。送信元が空なら書かない（telop send と同じく送信元の行を出さない）。
line="$("$jq" -cn --arg text "$text" --arg source "$name" --arg level "$level" \
	--arg color "$color" --arg icon "$icon" --argjson action "$action" \
	'{text: $text, level: $level, color: $color, icon: $icon}
	 + (if $source == "" then {} else {source: $source} end)
	 + (if $action == null then {} else {action: $action} end)')"

# -w 2 は telop send の締切（2 秒）に合わせる。受け口が無いときと書けないときは nc が 0 以外で終わる。
printf '%s\n' "$line" | /usr/bin/nc -U -w 2 "$socket"
