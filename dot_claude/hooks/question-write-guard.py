#!/usr/bin/env python3
"""PreToolUse フック（Edit|Write|MultiEdit）: 問いに無言の書き込みで応じようとしたら ask で止める。

背景: ユーザの問い・指摘（「〜は関係ないのでは?」）を、自分が出していた提案への go と
読み替えて、返答文を書かずにファイルを書き込んだ（rules/agent-behavior.md の承認ゲート節、
接地 2026-09-14）。規範文はロード済みでも効かなかった。失敗の観測可能な形は
「直近の人の発話が問いで終わる → その後 assistant の本文（text）が 1 つも無いまま書き込み」
なので、ここを transcript の照合で機械的に拾う。

判定:
  1. transcript を末尾から読み、直近の人の発話を探す。人の発話として数えるのは
     - type=="user" かつ origin.kind=="human" かつ message.content が str のもの
     - type=="attachment" の queued_command（作業中に送られた発話）で origin.kind=="human"
     task-notification・tool_result・[Request interrupted ...] は数えない。
  2. その発話より後に assistant の text ブロック（空白以外を含む）があれば素通し。
     thinking は数えない。
     ただし 2026-09-14 の実測では、ターンの途中でツール呼び出しと並べて出した本文は
     transcript に書かれず、残るのはターン末の本文だけだった。なので実際には「問いで
     始まったターンの中の書き込み（scratchpad 以外）は、途中で答えていても ask」になる。
     規範（問いのターンは回答して終え、書き込みは明示の指示を待つ）とは向きが揃うので
     このままにしている。
  3. 発話が問いの形で終わり、依頼の語（ください・お願い 等）を含まなければ ask。

止める先を ask にする理由: 依頼を問いの形で書く発話（「直せますか?」）を取りこぼしなく
除外する方法は無い。ask なら偽陽性のコストは確認 1 回で済む。auto mode でも ask は
抑止されない（chezmoi-source-guard.sh のコメント、2026-06-13 docs 確認）。

素通しにするもの: scratchpad（/tmp/claude-*, /private/tmp/claude-*）への書き込み、
subagent からの呼び出し（agent_id がある）、入力や transcript が読めないとき。
このフックの故障で作業を止めない。

観測: 判定を ~/.claude/cache/question-write-guard.jsonl に 1 行ずつ残す（発話本文は残さない）。

テスト: python3 ~/.claude/hooks/question-write-guard.test.py
"""

import json
import os
import re
import sys
import time

sys.dont_write_bytecode = True  # ~/.claude/hooks/ に __pycache__ を作らない

LOG_PATH = os.path.expanduser("~/.claude/cache/question-write-guard.jsonl")
LOG_MAX_BYTES = 1024 * 1024

CHUNK = 256 * 1024
MAX_SCAN_BYTES = 16 * 1024 * 1024  # これより前にしか人の発話が無ければ判定しない

SCRATCH_PREFIXES = ("/tmp/claude-", "/private/tmp/claude-")

# 末尾の句読点・空白を落としてから照合する。
TRAILING = re.compile(r"[\s。．.！!、,]+$")
QUESTION_END = re.compile(
    r"(\?|？|ですか|ますか|でしょうか|ませんか|のでは|んですかね|ですかね|かね|かな)$"
)
REQUEST_WORDS = re.compile(
    r"(ください|下さい|お願い|してほしい|して欲しい|くれますか|くれませんか|もらえますか|"
    r"もらえませんか|いただけますか|いただけませんか|頂けますか|(?<!どう)やって|進めて)"
)


def log(record):
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        try:
            if os.path.getsize(LOG_PATH) >= LOG_MAX_BYTES:
                os.replace(LOG_PATH, LOG_PATH + ".1")
        except OSError:
            pass
        record["ts"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError:
        pass


def iter_rows_reversed(path):
    """JSONL を末尾から 1 行ずつ dict で返す。壊れた行は飛ばす。"""
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        pos = f.tell()
        scanned = 0
        rest = b""
        while pos > 0 and scanned < MAX_SCAN_BYTES:
            size = min(CHUNK, pos)
            pos -= size
            scanned += size
            f.seek(pos)
            buf = f.read(size) + rest
            lines = buf.split(b"\n")
            rest = lines[0]  # 先頭は行の途中かもしれないので次のチャンクへ持ち越す
            for line in reversed(lines[1:]):
                row = parse(line)
                if row is not None:
                    yield row
        if pos == 0:
            row = parse(rest)
            if row is not None:
                yield row


def parse(line):
    line = line.strip()
    if not line:
        return None
    try:
        row = json.loads(line)
    except ValueError:
        return None
    return row if isinstance(row, dict) else None


def human_prompt(row):
    """人の発話なら本文を返す。そうでなければ None。"""
    if row.get("type") == "user":
        origin = row.get("origin") or {}
        content = (row.get("message") or {}).get("content")
        if origin.get("kind") == "human" and isinstance(content, str) and not row.get("isCompactSummary"):
            return content
    if row.get("type") == "attachment":
        a = row.get("attachment") or {}
        if a.get("type") == "queued_command" and (a.get("origin") or {}).get("kind") == "human":
            prompt = a.get("prompt")
            if isinstance(prompt, str):
                return prompt
    return None


def has_assistant_text(row):
    if row.get("type") != "assistant":
        return False
    content = (row.get("message") or {}).get("content")
    if isinstance(content, str):
        return bool(content.strip())
    if isinstance(content, list):
        return any(
            isinstance(b, dict) and b.get("type") == "text" and str(b.get("text", "")).strip()
            for b in content
        )
    return False


def is_question(text):
    lines = [l for l in text.strip().splitlines() if l.strip()]
    if not lines:
        return False
    last = TRAILING.sub("", lines[-1])
    return bool(QUESTION_END.search(last)) and not REQUEST_WORDS.search(text)


def decide(payload):
    """(decision, reason) を返す。decision は "ask" か "pass"。"""
    if payload.get("agent_id"):
        return "pass", "subagent"
    file_path = str((payload.get("tool_input") or {}).get("file_path") or "")
    if file_path.startswith(SCRATCH_PREFIXES):
        return "pass", "scratchpad"
    transcript = payload.get("transcript_path")
    if not transcript:
        return "pass", "no-transcript-path"
    try:
        for row in iter_rows_reversed(transcript):
            if has_assistant_text(row):
                return "pass", "answered"
            prompt = human_prompt(row)
            if prompt is not None:
                return ("ask", "question-unanswered") if is_question(prompt) else ("pass", "not-question")
    except OSError:
        return "pass", "transcript-unreadable"
    return "pass", "no-human-prompt"


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return 0
    if not isinstance(payload, dict):
        return 0
    decision, reason = decide(payload)
    log({
        "session_id": payload.get("session_id"),
        "tool_name": payload.get("tool_name"),
        "has_transcript_path": bool(payload.get("transcript_path")),
        "decision": decision,
        "reason": reason,
    })
    if decision == "ask":
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "ask",
                "permissionDecisionReason": (
                    "直近のユーザ発話は問いの形で、まだ本文で答えていません。"
                    "問い・指摘は書き込みの承認ではありません。先に回答し、書き込むなら明示の指示を待ってください"
                    "（rules/agent-behavior.md 承認ゲート節）。"
                ),
            }
        }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # フックの故障で作業を止めない
        sys.exit(0)
