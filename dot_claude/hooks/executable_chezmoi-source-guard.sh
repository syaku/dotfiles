#!/usr/bin/env bash
# PreToolUse ガード: chezmoi 管理下の target を Edit/Write で直接編集しようとしたら止める。
# 正しくは source（~/.local/share/chezmoi/）を編集する（dotfiles.md / dotfiles-chezmoi.md）。
#
# 判定: chezmoi source-path "$f" が exit 0（= 管理 target）なら block(exit 2)。
#   source 本体 / .chezmoiignore 済み（local-*.md 等）/ runtime ファイルは "not managed"
#   = exit 1 → 素通し（exit 0）。Phase 0 で実機確認済みの分類ロジック。
#
# 確実性のため permissionDecision:"ask" ではなく exit 2 を使う
#   （defaultMode:auto + skipAutoPermissionPrompt:true では ask が握り潰される公算）。

f=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$f" ] && exit 0

if src=$(chezmoi source-path "$f" 2>/dev/null); then
  printf 'これは chezmoi 管理下の target です。直接編集せず source を編集してください:\n  %s\n' "$src" >&2
  exit 2
fi
exit 0
