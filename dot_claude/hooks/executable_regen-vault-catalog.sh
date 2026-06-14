#!/usr/bin/env bash
# SessionStart hook: Obsidian vault 配下のセッションで機械生成カタログを再生成する。
#
# 常時ロードされる <vault>/.ai-index/vault-catalog.md を最新化し、その回のセッションで
# Life/CLAUDE.md の @import 経由で standing context（prompt cache の Project context レイヤ）に
# 載せる。CLAUDE.md は session 開始時に 1 回読まれて固定されるので、再生成は session 開始前の
# このタイミングでしか「その回」に反映できない（mid-session 編集は反映されない）。
#
# cwd が workspace 配下でないセッション（他リポジトリ作業）では no-op にして context を汚さない。
# 失敗は握り潰す（カタログ更新の失敗で session 開始をブロックしない。stale でも @import は機能する）。
set -uo pipefail

VAULT="$HOME/workspace/notes/obsidian/Life"

case "$PWD" in
  "$HOME/workspace"*) ;;
  *) exit 0 ;;
esac

python3 "$HOME/.claude/scripts/vault_catalog.py" --vault "$VAULT" --format md >/dev/null 2>&1 || true
exit 0
