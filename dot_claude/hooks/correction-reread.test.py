#!/usr/bin/env python3
"""correction-reread.py のテスト。

実行: python3 ~/.claude/hooks/correction-reread.test.py
別プロセスで起動し stdin に UserPromptSubmit 相当の JSON を渡して stdout を見る。
"""

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "correction-reread.py")


def run(prompt, key="prompt", raw=None):
    data = raw if raw is not None else json.dumps(
        {"session_id": "s1", "hook_event_name": "UserPromptSubmit", key: prompt},
        ensure_ascii=False,
    )
    p = subprocess.run([sys.executable, HOOK], input=data, capture_output=True, text=True)
    return p.returncode, p.stdout


CASES = []


def case(desc):
    def deco(fn):
        CASES.append((desc, fn))
        return fn

    return deco


def fires(prompt, **kw):
    code, out = run(prompt, **kw)
    assert code == 0, code
    return "[correction-reread]" in out


@case("短い訂正で発火する（2026-09-12 の実例）")
def _():
    for p in (
        "違います。受け入れ条件は外から注入しているのでそれはもっともらしく守るはずです。",
        "拘束の話すらしていません現状のLLMでは自動で設計を作れないという話をしています。",
        "また直前の話を引き摺ってますね。",
        "そこまでは言ってないので駄目と言われました。",
        "どちらかというと私の解釈は逆で、設計に届かないから頻繁に作り直すという感じですね。",
        "正直何を言ってるのか分かりません。",
    ):
        assert fires(p), p


@case("訂正語を含まない短い発話では発火しない")
def _():
    for p in ("hookとrules両方作ってmemoryは消してください", "まあ、ギャンブルですけど。", "ok"):
        assert not fires(p), p


@case("長い発話は訂正語を含んでも発火しない")
def _():
    p = "違います。" + "この点は前回の議論で述べた通りで、" * 20
    assert len(p) > 200
    assert not fires(p)


@case("slash command / shell / 注入は対象外")
def _():
    assert not fires("/model 違います")
    assert not fires("! echo 違います")
    assert not fires("<teammate-message teammate_id=\"x\">違います</teammate-message>")


@case("prompt 以外のキー名でも読める")
def _():
    assert fires("違います。", key="user_prompt")
    assert fires("違います。", key="user_input")


@case("壊れた入力でも exit 0・無出力")
def _():
    code, out = run(None, raw="not json")
    assert code == 0 and out == ""
    code, out = run(None, raw="")
    assert code == 0 and out == ""


def main():
    failed = 0
    for desc, fn in CASES:
        try:
            fn()
            print(f"ok   {desc}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {desc}: {e}")
    print(f"\n{len(CASES) - failed}/{len(CASES)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
