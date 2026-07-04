#!/bin/bash
# inbox 滞留件数を数え、1 件以上なら macOS 通知を出す。
# drain 本体は判断ゲートを持つため自動実行せず、リマインドのみ。

INBOX="$HOME/workspace/notes/obsidian/Life/inbox"
LOG_DIR="$HOME/Library/Logs/claude-scheduled"

if [ ! -d "$INBOX" ]; then
	echo "$(date -Iseconds) inbox not found: $INBOX" >>"$LOG_DIR/drain-reminder.log"
	exit 0
fi

# README.md は inbox 運用用の案内なので除外
count=$(find "$INBOX" -maxdepth 1 -type f -name "*.md" ! -name "README.md" | wc -l | tr -d ' ')

echo "$(date -Iseconds) inbox_count=$count" >>"$LOG_DIR/drain-reminder.log"

if [ "$count" -gt 0 ]; then
	/usr/bin/osascript -e "display notification \"inbox に $count 件滞留しています。/drain で処理してください。\" with title \"drain reminder\""
fi
