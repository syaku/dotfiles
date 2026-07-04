#!/bin/bash
# PostToolUse hook: format edited/written files by extension.
# Input: JSON on stdin with tool_input.file_path (Claude Code hook spec).
# Runs formatters only if the binary is available; silently no-op otherwise.

input=$(cat)
file=$(printf '%s' "$input" | python3 -c 'import sys, json; d=json.load(sys.stdin); print(d.get("tool_input", {}).get("file_path", ""))' 2>/dev/null)

[ -z "$file" ] && exit 0
[ ! -f "$file" ] && exit 0

case "$file" in
  *.sh|*.bash|*.zsh)
    if command -v shfmt >/dev/null 2>&1; then
      shfmt -w "$file" >/dev/null 2>&1 || true
    fi
    ;;
  */workflows/*.js|*/workflows/*.mjs|*/workflows/*.cjs)
    if command -v prettier >/dev/null 2>&1; then
      prettier --write --log-level warn "$file" >/dev/null 2>&1 || true
    fi
    ;;
esac
exit 0
