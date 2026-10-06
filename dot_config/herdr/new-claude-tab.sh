# herdr の custom command（prefix+a）から呼ぶ。新しいタブを作り、そのシェルを claude に置き換える。
# Windows 以外で使う。Windows では同じ処理を new-claude-tab.nu が行う。
# herdr にはタブごとに起動するものを選ぶプロファイルが無いので、タブのシェルに exec claude を打ち込む。
# claude を終えるとペインも閉じる。
# herdr と jq の実行ファイルは、GUI から起動された herdr の PATH に無いことがあるので引数で受け取る。
# 同じ directory に claude-args.local があれば、1 行 1 引数で claude に渡す（空行と # で始まる行は飛ばす）。
# 渡す引数はマシンごとに違うので、claude-args.local は chezmoi で同期しない。
set -euo pipefail

herdr="$1"
jq="$2"

args=()
local_args="$(dirname "$0")/claude-args.local"
if [[ -f "$local_args" ]]; then
	while IFS= read -r line || [[ -n "$line" ]]; do
		[[ -z "$line" || "$line" == \#* ]] && continue
		# pane run はシェルに文字列として打ち込むので、1 引数ずつクォートする。
		args+=("$(printf '%q' "$line")")
	done <"$local_args"
fi

pane="$("$herdr" tab create --focus | "$jq" -r '.result.root_pane.pane_id')"
"$herdr" pane run "$pane" exec claude ${args[@]+"${args[@]}"}
