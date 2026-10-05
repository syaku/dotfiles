# herdr の plugin（syaku.claude-tab-title）が pane.agent_status_changed を受けるたびに呼ぶ。Mac 用。
# Windows では同じ処理を tab-title.ps1 が行う。
# イベントを出した pane が Claude で、タブの中で最初の Claude の pane なら、タブ名をその題名に付け直す。
# jq は macOS 15 から /usr/bin に入っているので、Homebrew の無い Mac でも動く。
set -euo pipefail

# タブ名の上限の幅。半角を 1、全角を 2 と数え、超えたら末尾を … にする。0 なら切り詰めない。
max_width=10

herdr="${HERDR_BIN_PATH:-herdr}"
jq=/usr/bin/jq

pane_id="$("$jq" -r '.data.pane_id // empty' <<<"${HERDR_PLUGIN_EVENT_JSON:-}")"
[[ -n "$pane_id" ]] || exit 0

pane="$("$herdr" pane get "$pane_id")"
[[ "$("$jq" -r '.result.pane.agent // empty' <<<"$pane")" == claude ]] || exit 0
tab_id="$("$jq" -r '.result.pane.tab_id' <<<"$pane")"

# タブに Claude の pane が 2 つ以上あるときは、最初の pane の題名を使う。
# pane ID の末尾は、workspace ごとに作った順に増える番号を 32 文字で符号化したもの（herdr の encode_public_number）。
first="$("$herdr" pane list | "$jq" -r --arg tab "$tab_id" '
  def number: ltrimstr(split(":p")[0] + ":p") | split("")
    | reduce .[] as $c (0; . * 32 + ("123456789ABCDEFGHJKMNPQRSTVWXYZ0" | index($c)) + 1);
  [.result.panes[] | select(.tab_id == $tab and .agent == "claude")]
  | min_by(.pane_id | number) | .pane_id')"
[[ "$first" == "$pane_id" ]] || exit 0

label="$("$jq" -r --argjson max "$max_width" '
  def width: if . < 128 then 1 else 2 end;
  .result.pane.terminal_title_stripped // ""
  | if $max == 0 or (explode | map(width) | add // 0) <= $max then .
    else [foreach explode[] as $c (0; . + ($c | width); [., $c])]
      | map(select(.[0] <= $max - 1) | .[1]) | implode + "…"
    end' <<<"$pane")"
[[ -n "$label" ]] || exit 0

current="$("$herdr" tab get "$tab_id" | "$jq" -r '.result.tab.label')"
[[ "$label" != "$current" ]] || exit 0
"$herdr" tab rename "$tab_id" "$label"
