#!/usr/bin/env python3
"""InstructionsLoaded フック: CLAUDE.md / rules がいつ・なぜ読まれたかを JSONL に落とす。

背景: paths 付き rules は「置けば読まれる」前提で書かれてきたが、実際に読まれたかを
確かめる手段が無く、2026-09-06 の調査では手作業の A/B で確定 4 件・未確定 3 件までしか
詰められなかった（長いセッションで発火が止まる条件、Edit / Write が trigger か、
`**/.claude/**` が fresh session で発火するか）。InstructionsLoaded は payload に
file_path と load_reason を持つので、この観測は決定論層に置ける。

止めない・変えない。このイベントは block できず、出力も terminalSequence と
systemMessage 以外は無視される（公式リファレンス）。純粋な観測専用。

file_content は公式の payload 例に載っているが記録しない（rules 全文がログに毎回積まれる
ため）。代わりに file_size を残す。ただし 2.1.263 の実測では path_glob_match の payload に
file_size も file_content も含まれておらず、来た項目だけを残す作りにしてある。

集計: python3 ~/.claude/hooks/instructions-loaded-log.py --summary
      （--summary はフックとしてではなく人が手で叩く経路。stdin を読まない）

既知の癖（anthropics/claude-code の issue）:
  - compact 1 回につきファイルあたり 3 回発火する（#52176）。数えるときは重複を潰す。
  - /clear では発火しない（#31017）。ログの空白がそのまま「読まれていない」を意味しない。
"""

import json
import os
import sys
import time

sys.dont_write_bytecode = True  # ~/.claude/hooks/ に __pycache__ を作らない

LOG_PATH = os.path.expanduser("~/.claude/cache/instructions-loaded.jsonl")
MAX_BYTES = 5 * 1024 * 1024  # これを超えたら 1 世代だけ退避して切り直す

FIELDS = ("session_id", "cwd", "load_reason", "file_path", "file_size")


def rotate_if_needed():
    try:
        if os.path.getsize(LOG_PATH) < MAX_BYTES:
            return
        os.replace(LOG_PATH, LOG_PATH + ".1")
    except OSError:
        pass


def record(data):
    row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    for key in FIELDS:
        if key in data:
            row[key] = data[key]
    # file_content は意図して落とす（本文はログの目的に要らず、量だけ増える）
    rotate_if_needed()
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def read_rows():
    rows = []
    for path in (LOG_PATH + ".1", LOG_PATH):
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rows.append(json.loads(line))
                    except ValueError:
                        continue
        except OSError:
            continue
    return rows


def summary():
    rows = read_rows()
    if not rows:
        print(f"記録がありません: {LOG_PATH}")
        return 0

    # compact の 3 重発火があるので (session, reason, path) で潰してから数える。
    seen = set()
    by_file = {}
    reasons = {}
    for r in rows:
        path = r.get("file_path") or "(不明)"
        reason = r.get("load_reason") or "(不明)"
        key = (r.get("session_id"), reason, path)
        reasons[reason] = reasons.get(reason, 0) + 1
        if key in seen:
            continue
        seen.add(key)
        by_file.setdefault(path, {})
        by_file[path][reason] = by_file[path].get(reason, 0) + 1

    sessions = len({r.get("session_id") for r in rows})
    print(f"{len(rows)} 行 / {sessions} セッション / {len(by_file)} ファイル  ({LOG_PATH})")
    print("\nload_reason の内訳（重複込みの生の発火数）:")
    for reason, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
        print(f"  {n:6d}  {reason}")

    print("\nファイル別（同一セッション・同一 reason は 1 回に潰した数）:")
    home = os.path.expanduser("~")
    for path, counts in sorted(by_file.items(), key=lambda kv: -sum(kv[1].values())):
        shown = path.replace(home, "~", 1)
        detail = " ".join(f"{r}={n}" for r, n in sorted(counts.items()))
        print(f"  {sum(counts.values()):4d}  {shown}\n        {detail}")
    return 0


def main():
    if "--summary" in sys.argv[1:]:
        return summary()

    try:
        data = json.loads(sys.stdin.read())
    except Exception:
        return 0
    if not isinstance(data, dict):
        return 0

    try:
        record(data)
    except OSError as e:
        print(f"instructions-loaded-log: 記録できませんでした（{e.__class__.__name__}）", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
