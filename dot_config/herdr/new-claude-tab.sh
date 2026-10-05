# herdr の custom command（prefix+a）から呼ぶ。新しいタブを作り、そのシェルを claude に置き換える。
# Windows 以外で使う。Windows では同じ処理を new-claude-tab.nu が行う。
# herdr にはタブごとに起動するものを選ぶプロファイルが無いので、タブのシェルに exec claude を打ち込む。
# claude を終えるとペインも閉じる。
# herdr と jq の実行ファイルは、GUI から起動された herdr の PATH に無いことがあるので引数で受け取る。
set -euo pipefail

herdr="$1"
jq="$2"

pane="$("$herdr" tab create --focus | "$jq" -r '.result.root_pane.pane_id')"
"$herdr" pane run "$pane" exec claude
