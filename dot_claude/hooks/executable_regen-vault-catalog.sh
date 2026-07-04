#!/usr/bin/env bash
# SessionStart hook: workspace 配下のセッションで機械生成カタログを再生成する。
#
# <vault>/.ai-index/vault-catalog.md を最新化する。かつては CLAUDE.md の @import で
# standing context に常時ロードしていたが、トークンコストのため解除済み（2026-06）。
# 現在の想定消費者は workflow subagent への動的索引組込み（--format json。未実装）で、
# md 側は「安く再生成できる索引」として鮮度維持だけ続けている（消費者が付くまでの待機状態）。
# CLAUDE.md が再び @import する場合に備え、session 開始前のこのタイミングを維持する
# （CLAUDE.md は session 開始時に 1 回読まれて固定されるため）。
#
# cwd が workspace 配下でないセッション（他リポジトリ作業）では no-op。
# 失敗は握り潰す（カタログ更新の失敗で session 開始をブロックしない）。
set -uo pipefail

# $HOME 末尾スラッシュを除去（Windows Git Bash は $HOME=/c/Users/name/ のように
# 末尾スラッシュ付きで来ることがあり、"$HOME/workspace" が // を含むと PWD glob に
# マッチせず no-op になる。macOS の $HOME は末尾スラッシュ無しなのでこの正規化は no-op）。
home="${HOME%/}"
VAULT="$home/workspace/notes/obsidian/Life"

case "$PWD" in
"$home/workspace"*) ;;
*) exit 0 ;;
esac

python3 "$home/.claude/scripts/vault_catalog.py" --vault "$VAULT" --format md >/dev/null 2>&1 || true
exit 0
