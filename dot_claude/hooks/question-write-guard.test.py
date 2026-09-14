#!/usr/bin/env python3
"""question-write-guard.py のテスト。

実行: python3 ~/.claude/hooks/question-write-guard.test.py

transcript は一時ディレクトリに組み、HOME も差し替えて hook を別プロセスで起動するので、
実環境の transcript やログには触れない。transcript の行の形は 2026-09-14 に実セッションの
JSONL で確かめたもの（人の発話 = type:user + origin.kind:human + content:str、作業中の発話 =
attachment.queued_command、assistant はブロックごとに 1 行）。
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "question-write-guard.py")


def human(text):
    return {"type": "user", "origin": {"kind": "human"}, "message": {"role": "user", "content": text}}


def notification(text):
    return {"type": "user", "origin": {"kind": "task-notification"}, "message": {"role": "user", "content": text}}


def interrupted():
    return {"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "[Request interrupted by user]"}]}}


def queued(text):
    return {"type": "attachment", "attachment": {"type": "queued_command", "prompt": text, "origin": {"kind": "human"}}}


def thinking():
    return {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "thinking", "thinking": "..."}]}}


def text(t):
    return {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": t}]}}


def tool_use(name="Read"):
    return {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "tool_use", "name": name, "input": {}}]}}


def tool_result():
    return {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "content": "ok"}]}}


def meta(kind):
    return {"type": kind}


def run(rows=None, file_path="/Users/x/Library/LaunchAgents/a.plist", raw_stdin=None, **extra):
    home = tempfile.mkdtemp(prefix="qwg-test-home-")
    payload = {"hook_event_name": "PreToolUse", "tool_name": "Write", "tool_input": {"file_path": file_path}}
    if rows is not None:
        path = os.path.join(home, "t.jsonl")
        with open(path, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        payload["transcript_path"] = path
    payload.update(extra)
    p = subprocess.run(
        [sys.executable, HOOK],
        input=raw_stdin if raw_stdin is not None else json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        text=True,
        env=dict(os.environ, HOME=home),
    )
    return p.returncode, p.stdout


def asked(out):
    try:
        return json.loads(out)["hookSpecificOutput"]["permissionDecision"] == "ask"
    except (ValueError, KeyError, TypeError):
        return False


CASES = []


def case(desc):
    def deco(fn):
        CASES.append((desc, fn))
        return fn

    return deco


def expect_ask(rows, **kw):
    code, out = run(rows, **kw)
    return None if code == 0 and asked(out) else f"ask を期待: exit={code} stdout={out!r}"


def expect_pass(rows, **kw):
    code, out = run(rows, **kw)
    return None if code == 0 and out.strip() == "" else f"素通しを期待: exit={code} stdout={out!r}"


INCIDENT = "じゃあどの道テンプレートを複製するんだからパスの話は関係ないのでは?"


@case("1. 接地の再現: 問い → thinking・Read・メタ行だけで書き込み → ask")
def c1():
    return expect_ask([
        text("それでよいですか。"), human(INCIDENT), meta("last-prompt"), meta("permission-mode"),
        thinking(), tool_use("Read"), tool_result(), thinking(),
    ])


@case("2. 問いに本文で答えてから書き込む → 素通し")
def c2():
    return expect_pass([human(INCIDENT), thinking(), text("ご指摘のとおりです。"), tool_use("Read"), tool_result()])


@case("3. 依頼の語を含む問い → 素通し")
def c3():
    return expect_pass([human("これを直してもらえますか?")])


@case("4. 問いでない指示 → 素通し")
def c4():
    return expect_pass([human("Bを実装して、Aも追記してください")])


@case("5. 「？」の無い問い（〜ですか。）→ ask")
def c5():
    return expect_ask([human("質問しただけで書き込んだのはなぜですか。")])


@case("6. 作業中に送られた問い（queued_command）→ ask")
def c6():
    return expect_ask([human("plist を作ってください"), text("作ります"), tool_use("Write"), tool_result(),
                       queued("質問しただけで書き込んだのはなぜですか?")])


@case("7. task-notification・中断マーカーは人の発話として数えない")
def c7():
    return expect_ask([human(INCIDENT), interrupted(), notification("<task-notification>done?</task-notification>")])


@case("8. 「どうやって」は依頼の語に数えない → ask")
def c8():
    return expect_ask([human("どうやって調べたんですか?")])


@case("9. scratchpad への書き込み → 素通し")
def c9():
    return expect_pass([human(INCIDENT)], file_path="/private/tmp/claude-502/x/scratchpad/a.txt")


@case("10. subagent からの呼び出し → 素通し")
def c10():
    return expect_pass([human(INCIDENT)], agent_id="abc")


@case("11. transcript_path が無い → 素通し")
def c11():
    return expect_pass(None)


@case("12. transcript が存在しない → 素通し")
def c12():
    code, out = run(None, transcript_path="/nonexistent/t.jsonl")
    return None if code == 0 and out.strip() == "" else f"exit={code} stdout={out!r}"


@case("13. 入力の JSON が壊れていても落ちない")
def c13():
    code, out = run(raw_stdin="{ not json")
    return None if code == 0 and out.strip() == "" else f"exit={code} stdout={out!r}"


@case("14. 壊れた行が混じっても判定できる")
def c14():
    home = tempfile.mkdtemp(prefix="qwg-test-broken-")
    path = os.path.join(home, "t.jsonl")
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(human(INCIDENT), ensure_ascii=False) + "\n{ broken\n")
    code, out = run(None, transcript_path=path)
    return None if code == 0 and asked(out) else f"exit={code} stdout={out!r}"


@case("15. チャンク境界をまたぐ長い transcript でも直近の発話を拾う")
def c15():
    filler = [tool_result() | {"pad": "x" * 5000} for _ in range(200)]  # 約 1MB
    return expect_ask([human("最初の依頼をしてください")] + filler + [human(INCIDENT)] + filler[:60])


@case("16. 複数行の発話は最終行の形で判定する")
def c16():
    return expect_pass([human("これは関係ないのでは?\nとりあえず続けて。")])


def main():
    if not os.path.exists(HOOK):
        print(f"hook が無い: {HOOK}")
        return 1
    ok = 0
    for desc, fn in CASES:
        try:
            failure = fn()
        except Exception as e:  # テスト自体の事故も FAIL として見せる
            failure = f"{e.__class__.__name__}: {e}"
        if failure is None:
            ok += 1
            print(f"  pass  {desc}")
        else:
            print(f"  FAIL  {desc}: {failure}")
    total = len(CASES)
    print(f"\n{ok}/{total} passed")
    return 0 if ok == total else 1


if __name__ == "__main__":
    sys.exit(main())
