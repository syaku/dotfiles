#!/usr/bin/env python3
"""Stop フック: 追跡中の plan.md でチェック済みが 1 件を超えて増えていたら報告する。

予防層 (plan-checklist-guard・PreToolUse) は Edit / Write しか見られない。auto mode の
harness は読み書きを Bash に寄せるよう指示するので、sed -i / heredoc で一括更新されると
予防層は素通りする。この検出層はファイルの実際の件数を見るので、書き込みの経路に依存
しない——止められない代わりに、経路を問わず検出できる。

報告は exit 2 で行う。Stop フックの exit 2 は停止を止めて stderr をモデルへ返すので、
その場で見える。報告後に把握件数を更新するため、同じ跳ねで繰り返し止まることはない。
stop_hook_active が真のときは何もしない（二重発火の保険）。

追跡集合は plan-checklist-guard が育てる。このセッションで一度も Edit / Write の対象に
ならなかった plan.md は入らない。
"""

import json
import os
import sys

import importlib.util

sys.dont_write_bytecode = True  # ~/.claude/hooks/ に __pycache__ を作らない
_spec = importlib.util.spec_from_file_location(
    "plan_checklist_state",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "plan-checklist-state.py"),
)
state = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(state)


def main():
    try:
        data = json.loads(sys.stdin.read())
    except Exception:
        return 0

    if data.get("stop_hook_active"):
        return 0

    session_id = data.get("session_id")
    tracked = state.load(session_id)
    if not tracked:
        return 0

    jumps = []
    updated = {}
    for path, known in tracked.items():
        current, text = state.read_counts(path)
        if current is None:
            continue  # 消えた・読めない → 追跡から落とす
        updated[path] = current
        try:
            known = int(known)
        except (TypeError, ValueError):
            continue
        delta = current - known
        if delta > 1:
            jumps.append((path, known, current, delta))

    state.save(session_id, updated)

    if not jumps:
        return 0

    lines = ["このターンで、把握していない経路から消化チェックリストが一括更新されています。"]
    for path, known, current, delta in jumps:
        lines.append(f"  {path}: {known} 件 → {current} 件（+{delta}）")
    lines.append(
        "  予防層（PreToolUse）は Edit / Write しか見ないので、Bash（sed -i / heredoc 等）"
        "経由の書き込みはここで初めて分かります。"
    )
    lines.append(
        "  各項目に検証の裏付けがあるか確認してください。無い項目はチェックを外し、"
        "1 ターン = 1 増分に戻してください。"
    )
    print("\n".join(lines), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
