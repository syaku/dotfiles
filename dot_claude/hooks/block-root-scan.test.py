#!/usr/bin/env python3
"""block-root-scan.py のテスト。

実行: python3 ~/.claude/hooks/block-root-scan.test.py

hook を別プロセスで起動し、Bash の tool_input を stdin に渡して exit code を見る。
"""

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "block-root-scan.py")

# 実際に走ったコマンド (2026-09-17 / 09-25 / 09-26) と、その変形
BLOCK = [
    'find / -name "spring-security-web-*.jar" 2>/dev/null | head -5',
    'cd /x/review-pr && find / -name "spymemcached*.jar" 2>/dev/null | head -5; find ~/.gradle ~/.m2 -name x',
    'cd /x && find . -maxdepth 2 -iname node_modules && grep -rn "DYNAMIC_CONFIG_EXTS" $(find / -path "*/@expo/config/build*" -iname "*.js" 2>/dev/null) 2>/dev/null | head -5',
    'cd / && find / -maxdepth 6 -path "*app*node_modules/@expo/config" -type d 2>/dev/null | head -5',
    "cd / && find . -name foo",
    "cd /; rg -l foo",
    "find -L / -name foo",
    "sudo find / -name foo",
    "rg foo /",
    "grep -rn foo /",
    "grep -R foo / --include=*.jar",
    "du -sh /*",
    "fd foo /",
    "ls -R /",
    'find "/" -name foo',
    "echo x | xargs -I{} find / -name {}",
]

PASS = [
    "find . -name foo",
    "find ~/.gradle ~/.m2 -name 'spymemcached*.jar'",
    "find /Users/me/workspace -maxdepth 6 -type d -path '*/node_modules/@expo/config'",
    "grep -n foo /etc/hosts",
    "grep foo /",
    "ls /",
    "ls -la /usr/local",
    "cd / && ls",
    "cd / && find /usr/local -name foo",
    "sed -e 's/a/b/' file | tr / _",
    "git log --oneline -5",
    "rg foo src/",
    # 文字列として find / を書いているだけのもの
    "git commit -F - <<'EOF'\nsubject\n\n最後に `find /` を実行していた。\nEOF",
    "git commit -F - <<EOF\n`cd / && find .` の形も\nEOF",
    'gh pr create --title "x" --body "agent が `find /` を実行していた"',
    "echo 'find / -name foo'",
    "grep -n 'find /' SKILL.md",
]


def run(cmd):
    p = subprocess.run(
        [sys.executable, HOOK],
        input=json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}}),
        capture_output=True,
        text=True,
    )
    return p.returncode


def main():
    failures = []
    for c in BLOCK:
        if run(c) != 2:
            failures.append(f"止めるべきなのに通した: {c}")
    for c in PASS:
        if run(c) != 0:
            failures.append(f"通すべきなのに止めた: {c}")
    for f in failures:
        print(f)
    print(f"{len(BLOCK) + len(PASS) - len(failures)}/{len(BLOCK) + len(PASS)} ok")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
