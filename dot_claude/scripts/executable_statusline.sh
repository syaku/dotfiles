#!/usr/bin/env bash
# Claude Code の status line（2 行）。
#   1 行目: 󰉋 ディレクトリ │ 󰘬 ブランチ（dirty なら ●）
#   2 行目: 󰍛 コンテキストバー │ 󰚩 モデル │ 󰓅 effort │ 󰏘 output_style │ 🕖 5h・📅 7d
#
# 入力は stdin の JSON。フィールド定義は https://code.claude.com/docs/en/statusline
# 欠落しうるフィールドは空ならセグメントごと落とす。
#   .context_window.used_percentage  セッション初期は null
#   .rate_limits                     Pro/Max の初回 API 応答後のみ
#   .effort                          reasoning effort に対応したモデルのみ
#
# 前提: Nerd Fonts 3.x（UDEV Gothic NF で全グリフの存在を確認済み）と truecolor。
# 配色は Catppuccin Mocha に合わせた固定値で、暗い背景を想定している。
# 通常時は無彩色寄り、コンテキストとレート制限が 70% で peach、90% で red に振れる。
#
# アイコンは Material Design 系（Nerd Fonts の md-*）。線の太さと字面が揃うため。
# コードポイントは nerd-fonts の glyphnames.json で確定した値。レート制限だけは
# 絵文字で、単位のラベル（5h・7d）を絵文字に代えている。絵文字は色が固定なので
# しきい値の色は数値側だけに乗る。
# サブスクリプション利用のため cost（.cost.total_cost_usd）は表示しない。
#
# 動作確認:
#   echo '{"model":{"display_name":"Opus 5"},"workspace":{"current_dir":"'"$HOME"'"},
#          "context_window":{"used_percentage":78},"effort":{"level":"high"},
#          "output_style":{"name":"default"},
#          "rate_limits":{"five_hour":{"used_percentage":31.5}}}' | ~/.claude/scripts/statusline.sh

set -uo pipefail

# Catppuccin Mocha
MAUVE=$'\033[38;2;203;166;247m'
PINK=$'\033[38;2;245;194;231m'
BLUE=$'\033[38;2;137;180;250m'
SKY=$'\033[38;2;137;220;235m'
GREEN=$'\033[38;2;166;227;161m'
YELLOW=$'\033[38;2;249;226;175m'
PEACH=$'\033[38;2;250;179;135m'
RED=$'\033[38;2;243;139;168m'
TEAL=$'\033[38;2;148;226;213m'
TEXT=$'\033[38;2;166;173;200m'
OVERLAY=$'\033[38;2;108;112;134m'
TRACK=$'\033[38;2;69;71;90m'    # バーの未充填部（surface1）
TRACK_BG=$'\033[48;2;69;71;90m' # 部分ブロックの背後を埋める
RESET=$'\033[0m'

SEP="${OVERLAY}  ${RESET}" # powerline の細い区切り

# しきい値で色を返す（90 以上は red、70 以上は peach、それ以外は teal）
level_color() {
	if [ "$1" -ge 90 ]; then
		printf '%s' "$RED"
	elif [ "$1" -ge 70 ]; then
		printf '%s' "$PEACH"
	else
		printf '%s' "$TEAL"
	fi
}

input=$(cat)

# jq は 1 回だけ呼ぶ（status line は頻繁に実行されるのでプロセス起動を抑える）。
# 数値は整数に丸め、欠落・null は空行にして 1 値 1 行で受け取る。
# タブ区切り + read だと IFS のタブが空フィールドを潰すため行分割にしている。
vals=()
while IFS= read -r line; do
	vals+=("$line")
done < <(printf '%s' "$input" | jq -r '
  def pct: if . == null then "" else (. | round | tostring) end;
  [ .model.display_name // "?",
    .workspace.current_dir // .cwd // "",
    (.context_window.used_percentage | pct),
    .effort.level // "",
    .output_style.name // "",
    (.rate_limits.five_hour.used_percentage | pct),
    (.rate_limits.seven_day.used_percentage | pct)
  ] | .[]' 2>/dev/null)

model=${vals[0]:-?}
cur_dir=${vals[1]:-}
ctx=${vals[2]:-}
effort=${vals[3]:-}
style=${vals[4]:-}
r5=${vals[5]:-}
r7=${vals[6]:-}

# --- 1 行目: ディレクトリとブランチ ----------------------------------------

work_dir=${cur_dir:-$PWD}

# 表示用に $HOME を ~ に畳む。git に渡すのは畳む前の work_dir。
disp_dir=$work_dir
case "$disp_dir" in
"$HOME"/*) disp_dir="~${disp_dir#"$HOME"}" ;;
"$HOME") disp_dir="~" ;;
esac

line1="${BLUE}󰉋${RESET} ${TEXT}${disp_dir}${RESET}"

branch=$(git -C "$work_dir" symbolic-ref --quiet --short HEAD 2>/dev/null) ||
	branch=$(git -C "$work_dir" rev-parse --short HEAD 2>/dev/null) || branch=""

if [ -n "$branch" ]; then
	if [ -n "$(git -C "$work_dir" status --porcelain 2>/dev/null | head -n 1)" ]; then
		line1="${line1}${SEP}${YELLOW}󰘬${RESET} ${TEXT}${branch}${RESET} ${YELLOW}●${RESET}"
	else
		line1="${line1}${SEP}${GREEN}󰘬${RESET} ${TEXT}${branch}${RESET}"
	fi
fi

# --- 2 行目: コンテキスト・モデル・effort・output_style・レート制限 ----------

line2=""

if [ -n "$ctx" ]; then
	# 幅 12 のバーを 1/8 ブロック単位で描く（端数は部分ブロックで表現）
	width=12
	eighths=$((ctx * width * 8 / 100))
	[ "$eighths" -gt $((width * 8)) ] && eighths=$((width * 8))
	full=$((eighths / 8))
	rem=$((eighths % 8))

	parts=("" "▏" "▎" "▍" "▌" "▋" "▊" "▉")
	fill_color=$(level_color "$ctx")

	bar=""
	i=0
	while [ "$i" -lt "$full" ]; do
		bar="${bar}█"
		i=$((i + 1))
	done
	bar="${fill_color}${bar}"

	used=$full
	if [ "$rem" -gt 0 ]; then
		bar="${bar}${TRACK_BG}${parts[$rem]}${RESET}${fill_color}"
		used=$((full + 1))
	fi

	empty=""
	i=$used
	while [ "$i" -lt "$width" ]; do
		empty="${empty}█"
		i=$((i + 1))
	done

	line2="${fill_color}󰍛${RESET} ${bar}${RESET}${TRACK}${empty}${RESET} ${TEXT}${ctx}%${RESET}"
	[ "$ctx" -ge 90 ] && line2="${line2} 🔥"
fi

# display_name（"Opus 5"・"Opus 5 (1M context)" など）からファミリー名だけ取り出す。
# 未知のファミリーは display_name のまま出して、取りこぼしに気付けるようにする。
case "$model" in
*Opus*) model="Opus" ;;
*Sonnet*) model="Sonnet" ;;
*Haiku*) model="Haiku" ;;
*Fable*) model="Fable" ;;
esac

line2="${line2:+${line2}${SEP}}${MAUVE}󰚩${RESET} ${TEXT}${model}${RESET}"

if [ -n "$effort" ]; then
	line2="${line2}${SEP}${SKY}󰓅${RESET} ${TEXT}${effort}${RESET}"
fi

if [ -n "$style" ]; then
	line2="${line2}${SEP}${PINK}󰏘${RESET} ${TEXT}${style}${RESET}"
fi

# 5h は時計、7d はカレンダーの絵文字で区別する（テキストのラベルは置かない）
rate=""
if [ -n "$r5" ]; then
	rate="🕖 $(level_color "$r5")${r5}%${RESET}"
fi
if [ -n "$r7" ]; then
	rate="${rate:+${rate}  }📅 $(level_color "$r7")${r7}%${RESET}"
fi
if [ -n "$rate" ]; then
	line2="${line2}${SEP}${rate}"
fi

# --- 出力 -----------------------------------------------------------------

printf '%s\n' "$line1"
printf '%s\n' "$line2"
exit 0
