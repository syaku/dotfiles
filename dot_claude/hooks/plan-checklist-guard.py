#!/usr/bin/env python3
"""PreToolUse ガード: plan.md の消化チェックリストを 1 回の編集で複数件倒すのを止める。

背景: implement2 は「1 ターン = 1 増分」で進み、チェックは検証を通った増分にだけ付ける
規範になっている。だがそれは prompt 層の規範で、正規表現による一括置換で 24 項目を
まとめて倒し、実体の無い項目が完了記録に化けた事象が観測されている（2026-09-03）。
この hook はその一括を決定論層で止める。

対象: basename が plan.md で、編集後の本文に「消化チェックリスト」の語を含むファイル。
判定: 編集後の全文をシミュレートし、行頭のチェック済み記法の数が 1 を超えて増えたら block。

差分の文字列だけを見ないのは、Edit の replace_all が old_string / new_string の 1 対で
k 箇所を置換するため。文字列差分では +1 に見えて、観測された失敗（一括置換）と同形の
経路を素通りさせる。

fail-open: 入力が読めない・未知の tool・対象ファイルが読めない場合は通す（exit 0）。
ただし黙って無効にはせず、判定できなかった理由を stderr に 1 行出す。

限界: Bash（sed -i / heredoc / python）経由の書き込みは PreToolUse の matcher
（Edit|Write）に掛からないので止められない。その経路は検出層（plan-checklist-watch）
が担う。
"""

import json
import os
import re
import sys

MARKER = "消化チェックリスト"
CHECKED = re.compile(r"^[ \t]*- \[x\]", re.MULTILINE)
TARGET_BASENAME = "plan.md"


def warn(msg):
    print(msg, file=sys.stderr)


def resolve(file_path, cwd):
    if os.path.isabs(file_path):
        return file_path
    return os.path.normpath(os.path.join(cwd or os.getcwd(), file_path))


def simulate(tool_name, tool_input, before):
    """編集後の全文を返す。判定できない tool なら None。"""
    if tool_name == "Write":
        return tool_input.get("content")
    if tool_name == "Edit":
        old = tool_input.get("old_string")
        new = tool_input.get("new_string")
        if old is None or new is None:
            return None
        if tool_input.get("replace_all"):
            return before.replace(old, new)
        return before.replace(old, new, 1)
    return None


def main():
    try:
        data = json.loads(sys.stdin.read())
    except Exception:
        return 0  # 入力が壊れている。ここは hook の管轄外なので黙って通す。

    tool_input = data.get("tool_input") or {}
    file_path = tool_input.get("file_path") or ""
    if not file_path:
        return 0

    path = resolve(file_path, data.get("cwd"))
    if os.path.basename(path) != TARGET_BASENAME:
        return 0

    try:
        with open(path, encoding="utf-8") as f:
            before = f.read()
    except FileNotFoundError:
        before = ""  # 新規作成。基準は空。
    except OSError as e:
        warn(f"plan-checklist-guard: {path} を読めないので検査を省略しました（{e.__class__.__name__}）")
        return 0

    after = simulate(data.get("tool_name"), tool_input, before)
    if after is None:
        return 0

    if MARKER not in after and MARKER not in before:
        return 0

    delta = len(CHECKED.findall(after)) - len(CHECKED.findall(before))
    if delta <= 1:
        return 0

    warn(
        f"消化チェックリストを 1 回の編集で {delta} 件倒そうとしています（1 件までに制限しています）。\n"
        "  実装は 1 ターン = 1 増分で進めてください。検証を通した項目を 1 件ずつ倒します。\n"
        "  plan.md の複製・復元なら Edit / Write ではなく cp を使ってください。"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
