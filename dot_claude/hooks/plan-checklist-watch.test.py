#!/usr/bin/env python3
"""plan-checklist-watch.py のテスト。

実行: python3 ~/.claude/hooks/plan-checklist-watch.test.py
状態ファイルはテスト専用の session_id を使うので、実セッションの状態を汚さない。
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
WATCH = os.path.join(HERE, "plan-checklist-watch.py")
STATE_DIR = os.path.expanduser("~/.claude/cache/plan-checklist-watch")

DONE = "- [" + "x] "
TODO = "- [ ] "
MARKER = "消化チェックリスト"

SESSION = "watch-test-session"


def body(done_count, todo_count):
    lines = ["## " + MARKER, ""]
    for i in range(done_count):
        lines.append(DONE + f"済み {i}")
    for i in range(todo_count):
        lines.append(TODO + f"未消化 {i}")
    return "\n".join(lines) + "\n"


def write_plan(done, todo):
    d = tempfile.mkdtemp(prefix="watch-test-")
    path = os.path.join(d, "plan.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(body(done, todo))
    return path


def set_state(mapping):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(os.path.join(STATE_DIR, f"{SESSION}.json"), "w", encoding="utf-8") as f:
        json.dump(mapping, f)


def get_state():
    try:
        with open(os.path.join(STATE_DIR, f"{SESSION}.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def clear_state():
    try:
        os.remove(os.path.join(STATE_DIR, f"{SESSION}.json"))
    except FileNotFoundError:
        pass


def run(payload, raw=None):
    data = raw if raw is not None else json.dumps(payload)
    p = subprocess.run([sys.executable, WATCH], input=data, capture_output=True, text=True)
    return p.returncode, p.stderr


def stop_payload(active=False):
    return {"hook_event_name": "Stop", "session_id": SESSION, "stop_hook_active": active}


CASES = []


def case(desc, expect_exit):
    def deco(fn):
        CASES.append((desc, expect_exit, fn))
        return fn

    return deco


@case("1. 把握件数と一致（跳ねなし）", 0)
def c1():
    clear_state()
    path = write_plan(2, 1)
    set_state({path: 2})
    return run(stop_payload())


@case("2. 1 件だけ増えた", 0)
def c2():
    clear_state()
    path = write_plan(3, 0)
    set_state({path: 2})
    return run(stop_payload())


@case("3. 3 件増えた（報告する）", 2)
def c3():
    clear_state()
    path = write_plan(4, 0)
    set_state({path: 1})
    code, err = run(stop_payload())
    if code == 2 and str(get_state().get(path)) != "4":
        return (99, f"報告後に把握件数が更新されていない: {get_state()}")
    if code == 2 and "+3" not in err:
        return (99, f"増分が報告に出ていない: {err}")
    return code, err


@case("4. stop_hook_active が真なら何もしない", 0)
def c4():
    clear_state()
    path = write_plan(4, 0)
    set_state({path: 1})
    return run(stop_payload(active=True))


@case("5. 追跡集合が空", 0)
def c5():
    clear_state()
    return run(stop_payload())


@case("6. 追跡していたファイルが消えている（追跡から落とす）", 0)
def c6():
    clear_state()
    path = write_plan(1, 0)
    os.remove(path)
    set_state({path: 1})
    code, err = run(stop_payload())
    if code == 0 and path in (get_state() or {}):
        return (99, "消えたファイルが追跡集合に残っている")
    return code, err


@case("7. 入力の JSON が壊れている", 0)
def c7():
    clear_state()
    return run(None, raw="{ not json")


@case("8. 把握件数が数値でない（壊れた状態）", 0)
def c8():
    clear_state()
    path = write_plan(5, 0)
    set_state({path: "こわれた値"})
    return run(stop_payload())


def main():
    if not os.path.exists(WATCH):
        print(f"hook が無い: {WATCH}")
        return 1
    ok = 0
    for desc, expect, fn in CASES:
        code, err = fn()
        if code == expect:
            ok += 1
            print(f"  pass  {desc}")
        else:
            print(f"  FAIL  {desc}: expected exit {expect}, got {code}")
            if err.strip():
                print(f"        stderr: {err.strip()[:300]}")
    clear_state()
    total = len(CASES)
    print(f"\n{ok}/{total} passed")
    return 0 if ok == total else 1


if __name__ == "__main__":
    sys.exit(main())
