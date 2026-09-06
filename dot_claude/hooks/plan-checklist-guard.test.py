#!/usr/bin/env python3
"""plan-checklist-guard.py のテスト。

実行: python3 ~/.claude/hooks/plan-checklist-guard.test.py
出力: 各ケースの pass/fail と、最後に合計。全件 pass なら exit 0。

チェック済み記法は文字列連結で組み立てる。このファイル自身は basename が plan.md
ではないので guard の対象外だが、記法を生で書くと plan.md へ引用・転記したときに
自己参照で block される（design 判断 7 の「新たに拒否される正当な利用 (2)」）。
"""

import json
import os
import subprocess
import sys
import tempfile

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "plan-checklist-guard.py")

DONE = "- [" + "x] "
TODO = "- [ ] "
MARKER = "消化チェックリスト"


def body(done_count, todo_count, marker=True):
    lines = []
    if marker:
        lines.append("## " + MARKER)
        lines.append("")
    for i in range(done_count):
        lines.append(DONE + f"済み {i}")
    for i in range(todo_count):
        lines.append(TODO + f"未消化 {i}")
    return "\n".join(lines) + "\n"


def run(payload, raw=None):
    """hook を起動して (exit code, stderr) を返す。"""
    data = raw if raw is not None else json.dumps(payload)
    p = subprocess.run(
        [sys.executable, HOOK],
        input=data,
        capture_output=True,
        text=True,
    )
    return p.returncode, p.stderr


def with_file(name, content):
    d = tempfile.mkdtemp(prefix="guard-test-")
    path = os.path.join(d, name)
    if content is not None:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    return path


CASES = []


def case(desc, expect_exit):
    def deco(fn):
        CASES.append((desc, expect_exit, fn))
        return fn

    return deco


@case("1. Edit で消化が 1 件増える", 0)
def c1():
    path = with_file("plan.md", body(0, 3))
    return run({
        "tool_name": "Edit",
        "tool_input": {"file_path": path, "old_string": TODO + "未消化 0", "new_string": DONE + "未消化 0"},
    })


@case("2. Edit で消化が 2 件増える", 2)
def c2():
    path = with_file("plan.md", body(0, 3))
    old = TODO + "未消化 0\n" + TODO + "未消化 1"
    new = DONE + "未消化 0\n" + DONE + "未消化 1"
    return run({
        "tool_name": "Edit",
        "tool_input": {"file_path": path, "old_string": old, "new_string": new},
    })


@case("3. Edit の replace_all で未消化 5 件を一括で倒す", 2)
def c3():
    path = with_file("plan.md", body(0, 5))
    return run({
        "tool_name": "Edit",
        "tool_input": {"file_path": path, "old_string": TODO, "new_string": DONE, "replace_all": True},
    })


@case("4. Edit で消化を 1 件外す", 0)
def c4():
    path = with_file("plan.md", body(3, 0))
    return run({
        "tool_name": "Edit",
        "tool_input": {"file_path": path, "old_string": DONE + "済み 0", "new_string": TODO + "済み 0"},
    })


@case("5. Write で現ファイルより消化が 2 件多い", 2)
def c5():
    path = with_file("plan.md", body(1, 2))
    return run({"tool_name": "Write", "tool_input": {"file_path": path, "content": body(3, 0)}})


@case("6. Write でディスクに無い新規パスに消化 3 件", 2)
def c6():
    path = with_file("plan.md", None)
    return run({"tool_name": "Write", "tool_input": {"file_path": path, "content": body(3, 0)}})


@case("7. basename が plan.md でないファイルで 2 件増える", 0)
def c7():
    path = with_file("SKILL.md", body(0, 3))
    old = TODO + "未消化 0\n" + TODO + "未消化 1"
    new = DONE + "未消化 0\n" + DONE + "未消化 1"
    return run({
        "tool_name": "Edit",
        "tool_input": {"file_path": path, "old_string": old, "new_string": new},
    })


@case("8. plan.md だが消化チェックリストの語が無い", 0)
def c8():
    path = with_file("plan.md", body(0, 3, marker=False))
    old = TODO + "未消化 0\n" + TODO + "未消化 1"
    new = DONE + "未消化 0\n" + DONE + "未消化 1"
    return run({
        "tool_name": "Edit",
        "tool_input": {"file_path": path, "old_string": old, "new_string": new},
    })


@case("9a. file_path が空", 0)
def c9a():
    return run({"tool_name": "Edit", "tool_input": {"file_path": ""}})


@case("9b. JSON が壊れている", 0)
def c9b():
    return run(None, raw="{ not json")


@case("9c. 未知の tool 名", 0)
def c9c():
    path = with_file("plan.md", body(0, 3))
    return run({"tool_name": "NotebookEdit", "tool_input": {"file_path": path, "content": body(3, 0)}})


@case("10. 対象ファイルが読めない（fail-open だが黙らない）", 0)
def c10():
    d = tempfile.mkdtemp(prefix="guard-test-")
    path = os.path.join(d, "plan.md")
    os.mkdir(path)  # ディレクトリを plan.md という名前で置く＝読み取りが失敗する
    code, err = run({"tool_name": "Write", "tool_input": {"file_path": path, "content": body(3, 0)}})
    if code == 0 and not err.strip():
        return (99, "fail-open したが stderr が空だった（黙って無効になっている）")
    return (code, err)


def main():
    if not os.path.exists(HOOK):
        print(f"hook が無い: {HOOK}")
        print("（無いまま走らせると python 自身の exit 2 を block と誤認して一部が pass する）")
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
                print(f"        stderr: {err.strip()[:200]}")
    total = len(CASES)
    print(f"\n{ok}/{total} passed")
    return 0 if ok == total else 1


if __name__ == "__main__":
    sys.exit(main())
