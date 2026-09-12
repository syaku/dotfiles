#!/usr/bin/env python3
"""UserPromptSubmit フック: 短い訂正発話を検出し、逐語の読み直しを指示する文脈を注入する。

背景（接地: 2026-09-12）: 省略の多い短い訂正（「違います」＋一行）を受けるたびに、モデルが
その一行を整った命題に補完して新しい枠に乗り換え、前の発話を逐語で読み直さないまま
3 回連続でずれた。訂正が短いほど補完で埋めやすく、乗り換えが速いほど枠ごとずれる。

分業: 発火はこのスクリプトが決定論的に行う（マーカー一致＋短さ）。訂正されたのが何かの
判定と読み直しはモデルが行う。誤発火の代償は「引用してから続ける」が一手増えるだけなので
偽陽性側に倒してある。長い訂正は意図した読みが本文に書かれていることが多いので対象外。

出力は plain stdout（exit 0）。UserPromptSubmit では stdout がそのまま文脈として渡る。
"""

import json
import sys

MAX_LEN = 200  # これを超える発話は「意図が本文に書かれている」とみなして発火しない

# 訂正マーカー。部分一致。汎用すぎる語（「ではなく」単独など）は入れない。
MARKERS = (
    "違います",
    "違う",
    "逆です",
    "逆で",
    "そうではなく",
    "そういう話では",
    "そういう意味では",
    "言ってない",
    "言っていない",
    "していません",
    "してません",
    "引き摺",
    "引きず",
    "別の話",
    "読み違え",
    "誤解",
    "勘違い",
    "何を言ってるのか",
    "何を言っているのか",
    "分かりません",
    "わかりません",
    "話が噛み合",
    "戻って",
)

CONTEXT = (
    "[correction-reread] 短い訂正発話の可能性があります。新しい枠に乗り換える前に:\n"
    "1. 直前の自分の応答のどの読みが訂正されたかを特定する。\n"
    "2. ユーザの今回の発話と、それが参照する過去のユーザ発話を逐語で引用する（要約しない）。\n"
    "3. 自分の読みを一行で言い直してから続ける。\n"
    "補完で埋めた内容をユーザの主張として扱わない。"
)


def prompt_text(data):
    for key in ("prompt", "user_prompt", "user_input"):
        v = data.get(key)
        if isinstance(v, str):
            return v
    return ""


def is_correction(text):
    t = text.strip()
    if not t or len(t) > MAX_LEN:
        return False
    if t.startswith("/") or t.startswith("!"):
        return False  # slash command / shell
    if "<teammate-message" in t or "<task-notification" in t:
        return False  # 人の発話ではない注入
    return any(m in t for m in MARKERS)


def main():
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except Exception:
        return 0
    if is_correction(prompt_text(data)):
        sys.stdout.write(CONTEXT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
