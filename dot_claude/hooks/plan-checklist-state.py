#!/usr/bin/env python3
"""plan-checklist-guard / plan-checklist-watch が共有する状態の読み書き。

状態はセッションごとに ~/.claude/cache/plan-checklist-watch/<session_id>.json に置く。
中身は {plan.md の絶対パス: 最後に把握したチェック済み件数}。

なぜ状態が要るか: 予防層 (guard・PreToolUse) は Edit / Write しか見られず、Bash
(sed -i / heredoc) 経由の書き込みを止められない。検出層 (watch・Stop) がターン境界で
ファイルの実際の件数を見て、把握していた件数からの跳ねを報告する——ファイルの状態を
見るので書き込みの経路に依存しない。

限界: このセッションで一度も Edit / Write の対象にならなかった plan.md は追跡集合に
入らないので、Bash だけで最初から最後まで書かれた場合は検出できない。
"""

import json
import os
import re

CHECKED = re.compile(r"^[ \t]*- \[x\]", re.MULTILINE)
MARKER = "消化チェックリスト"
STATE_DIR = os.path.expanduser("~/.claude/cache/plan-checklist-watch")


def state_path(session_id):
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", session_id or "default")
    return os.path.join(STATE_DIR, f"{safe}.json")


def load(session_id):
    try:
        with open(state_path(session_id), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save(session_id, data):
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        tmp = state_path(session_id) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, state_path(session_id))
    except Exception:
        pass  # 状態が残せなくても本体の判定は止めない


def count_checked(text):
    return len(CHECKED.findall(text))


def read_counts(path):
    """(件数, 本文) を返す。読めなければ (None, None)。"""
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except Exception:
        return None, None
    return count_checked(text), text


def is_target(path, text):
    return os.path.basename(path) == "plan.md" and MARKER in (text or "")
