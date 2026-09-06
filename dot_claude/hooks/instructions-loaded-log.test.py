#!/usr/bin/env python3
"""instructions-loaded-log.py のテスト。

実行: python3 ~/.claude/hooks/instructions-loaded-log.test.py

HOME を一時ディレクトリに差し替えて別プロセスで起動するので、実環境のログには触れない。
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "instructions-loaded-log.py")


def new_home():
    return tempfile.mkdtemp(prefix="iload-test-home-")


def log_path(home):
    return os.path.join(home, ".claude", "cache", "instructions-loaded.jsonl")


def run(home, payload, raw=None, args=()):
    env = dict(os.environ, HOME=home, USERPROFILE=home)
    data = raw if raw is not None else json.dumps(payload, ensure_ascii=False)
    p = subprocess.run(
        [sys.executable, HOOK, *args], input=data, capture_output=True, text=True, env=env
    )
    return p.returncode, p.stdout, p.stderr


def payload(path, reason="path_glob_match", session="s1", content="# rule\n本文"):
    return {
        "session_id": session,
        "transcript_path": "/tmp/t.jsonl",
        "cwd": "/Users/x/proj",
        "hook_event_name": "InstructionsLoaded",
        "load_reason": reason,
        "file_path": path,
        "file_size": len(content),
        "file_content": content,
    }


def rows(home):
    try:
        with open(log_path(home), encoding="utf-8") as f:
            return [json.loads(l) for l in f if l.strip()]
    except OSError:
        return []


CASES = []


def case(desc):
    def deco(fn):
        CASES.append((desc, fn))
        return fn

    return deco


def check(cond, msg):
    return None if cond else msg


@case("1. 1 件記録され exit 0")
def c1():
    home = new_home()
    code, _, err = run(home, payload("/r/a.md"))
    r = rows(home)
    return check(
        code == 0 and len(r) == 1 and r[0]["file_path"] == "/r/a.md",
        f"exit={code} rows={r} stderr={err!r}",
    )


@case("2. file_content は記録しない")
def c2():
    home = new_home()
    run(home, payload("/r/a.md", content="秘密の本文"))
    r = rows(home)
    return check(
        r and "file_content" not in r[0] and "秘密の本文" not in json.dumps(r, ensure_ascii=False),
        f"rows={r}",
    )


@case("3. 必要な項目が揃っている")
def c3():
    home = new_home()
    run(home, payload("/r/a.md", reason="session_start"))
    r = rows(home)
    want = {"ts", "session_id", "cwd", "load_reason", "file_path", "file_size"}
    return check(r and want <= set(r[0]), f"欠けた項目: {want - set(r[0]) if r else 'ログ無し'}")


@case("4. 追記される（上書きしない）")
def c4():
    home = new_home()
    run(home, payload("/r/a.md"))
    run(home, payload("/r/b.md"))
    return check(len(rows(home)) == 2, f"rows={len(rows(home))}")


@case("5. 入力の JSON が壊れていても落ちず、記録もしない")
def c5():
    home = new_home()
    code, _, _ = run(home, None, raw="{ not json")
    return check(code == 0 and rows(home) == [], f"exit={code} rows={rows(home)}")


@case("6. JSON だが dict でない")
def c6():
    home = new_home()
    code, _, _ = run(home, None, raw="[1,2,3]")
    return check(code == 0 and rows(home) == [], f"exit={code} rows={rows(home)}")


@case("7. 未知の項目は落ちる / 既知の欠落も落ちない")
def c7():
    home = new_home()
    code, _, _ = run(home, {"hook_event_name": "InstructionsLoaded", "余計": 1})
    r = rows(home)
    return check(code == 0 and len(r) == 1 and "余計" not in r[0], f"exit={code} rows={r}")


@case("8. --summary が reason 別とファイル別を出す")
def c8():
    home = new_home()
    run(home, payload("/r/a.md", reason="session_start"))
    run(home, payload("/r/b.md", reason="path_glob_match"))
    code, out, _ = run(home, None, raw="", args=("--summary",))
    return check(
        code == 0 and "session_start" in out and "path_glob_match" in out and "/r/b.md" in out,
        f"exit={code} stdout={out!r}",
    )


@case("9. --summary は同一セッション・同一 reason の重複を潰す")
def c9():
    home = new_home()
    for _ in range(3):  # compact の 3 重発火を模す
        run(home, payload("/r/a.md", reason="compact", session="s1"))
    code, out, _ = run(home, None, raw="", args=("--summary",))
    # 生の発火数は 3、潰した後のファイル別は 1
    return check("3  compact" in out.replace("     ", "  ") and "compact=1" in out, f"stdout={out!r}")


@case("10. ログが無い状態の --summary")
def c10():
    home = new_home()
    code, out, _ = run(home, None, raw="", args=("--summary",))
    return check(code == 0 and "記録がありません" in out, f"exit={code} stdout={out!r}")


@case("11. 壊れた行があっても --summary が落ちない")
def c11():
    home = new_home()
    run(home, payload("/r/a.md"))
    with open(log_path(home), "a", encoding="utf-8") as f:
        f.write("{ 壊れた行\n\n")
    code, out, _ = run(home, None, raw="", args=("--summary",))
    return check(code == 0 and "/r/a.md" in out, f"exit={code} stdout={out!r}")


def main():
    if not os.path.exists(HOOK):
        print(f"hook が無い: {HOOK}")
        return 1
    ok = 0
    for desc, fn in CASES:
        try:
            failure = fn()
        except Exception as e:
            failure = f"{e.__class__.__name__}: {e}"
        if failure is None:
            ok += 1
            print(f"  pass  {desc}")
        else:
            print(f"  FAIL  {desc}: {failure}")
    print(f"\n{ok}/{len(CASES)} passed")
    return 0 if ok == len(CASES) else 1


if __name__ == "__main__":
    sys.exit(main())
