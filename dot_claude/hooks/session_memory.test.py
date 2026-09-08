#!/usr/bin/env python3
"""session_memory.py のテスト。

実行: python3 ~/.claude/hooks/session_memory.test.py

HOME と保存先を一時ディレクトリに差し替え、`claude` は偽物（環境変数で応答を指定）に
置き換えて別プロセスで起動する。実環境の ~/.claude や API には触れない。
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "session_memory.py")

FAKE_CLAUDE = r'''#!/usr/bin/env python3
import os, sys
prompt = sys.argv[-1]
sys.stdin.read()
if "切り詰めて" in prompt:
    print(os.environ.get("FAKE_SHRINK", "縮約"))
else:
    print(os.environ.get("FAKE_SUMMARY", "要約"))
'''


def make_home():
    home = tempfile.mkdtemp(prefix="session-memory-test-")
    fake = os.path.join(home, "fake-claude.py")
    with open(fake, "w", encoding="utf-8") as f:
        f.write(FAKE_CLAUDE)
    os.chmod(fake, 0o755)
    return home, fake


def env_for(home, fake, **extra):
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": home,
        "CLAUDE_SESSION_MEMORY_DIR": os.path.join(home, ".claude", "session-memory"),
        "CLAUDE_SESSION_MEMORY_CLAUDE": fake,
        "CLAUDE_SESSION_MEMORY_LIMIT": "3",
        "CLAUDE_SESSION_MEMORY_CHARS": "20",
    }
    env.update({k: str(v) for k, v in extra.items()})
    return env


def run(args, env, stdin=None):
    return subprocess.run([sys.executable, HOOK, *args], input=stdin, capture_output=True, text=True, env=env, check=False)


def write_transcript(home, sid, human_turns, cwd="/Users/x/workspace", title="題名", project="-Users-x-workspace", extra_lines=()):
    pdir = os.path.join(home, ".claude", "projects", project)
    os.makedirs(pdir, exist_ok=True)
    path = os.path.join(pdir, f"{sid}.jsonl")
    rows = []
    for i in range(human_turns):
        rows.append({"type": "user", "sessionId": sid, "cwd": cwd, "timestamp": f"2026-09-0{1 + i % 9}T01:00:00.000Z",
                     "origin": {"kind": "human"}, "message": {"role": "user", "content": f"<system-reminder>秘密</system-reminder>質問 {i}"}})
        rows.append({"type": "assistant", "sessionId": sid, "cwd": cwd,
                     "message": {"role": "assistant", "content": [{"type": "text", "text": f"回答 {i}"}, {"type": "tool_use", "name": "Bash", "input": {}}]}})
    # tool_result だけの user 行と sidechain は human turn に数えない
    rows.append({"type": "user", "sessionId": sid, "message": {"role": "user", "content": [{"type": "tool_result", "content": "x"}]}})
    rows.append({"type": "user", "sessionId": sid, "isSidechain": True, "origin": {"kind": "human"}, "message": {"role": "user", "content": "サブ"}})
    rows.append({"type": "ai-title", "aiTitle": title, "sessionId": sid})
    rows.extend(extra_lines)
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return path


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def wait_for(pred, timeout=8.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pred():
            return True
        time.sleep(0.1)
    return pred()


def test_extract_and_summarize():
    home, fake = make_home()
    try:
        env = env_for(home, fake, FAKE_SUMMARY="質問三件への回答\n三件の質問に答えた")
        path = write_transcript(home, "s1", 3)
        r = run(["summarize", path], env)
        assert r.returncode == 0, r.stderr
        rows = read_jsonl(os.path.join(env["CLAUDE_SESSION_MEMORY_DIR"], "recent.jsonl"))
        assert len(rows) == 1, rows
        e = rows[0]
        assert e["session_id"] == "s1" and e["human_turns"] == 3, e
        # タイトルは要約器の 1 行目。transcript の ai-title（"題名"）は使わない
        assert e["title"] == "質問三件への回答" and e["cwd"] == "/Users/x/workspace", e
        assert e["started"].startswith("2026-09-01"), e
        assert e["summary"] == "三件の質問に答えた", e
    finally:
        shutil.rmtree(home)


def test_title_parsing():
    home, fake = make_home()
    try:
        recent = os.path.join(env_for(home, fake)["CLAUDE_SESSION_MEMORY_DIR"], "recent.jsonl")
        cases = [
            # (要約器の出力, 期待 title, 期待 summary)
            ("要約だけ", None, "要約だけ"),  # 改行なし = 形式無視 → タイトル無しで全文を本文に
            ("タイトル: 「見出し」\n本文です", "見出し", "本文です"),  # ラベル・鉤括弧は剥がす
            ("あ" * 30 + "\n本文", "あ" * 30, "本文"),  # 上限の倍までは切らずに使う
            ("あ" * 41 + "\n本文", None, "あ" * 41 + " 本文"),  # 倍を超えたら形式無視扱い
            ("見出し\n\n1 段落目\n2 段落目", "見出し", "1 段落目 2 段落目"),  # 本文の改行は normalize
            ("ユーザは改修を依頼した。\n続きの本文", None, "ユーザは改修を依頼した。 続きの本文"),  # 1 行目が文なら本文を欠かさない
            ("1 行目: 見出し\n2 行目以降: 本文です", "見出し", "本文です"),  # prompt のラベル複写を剥がす
            ("**見出し**\n本文です", "見出し", "本文です"),  # markdown 装飾を剥がす
        ]
        for i, (out, title, summary) in enumerate(cases):
            env = env_for(home, fake, FAKE_SUMMARY=out, CLAUDE_SESSION_MEMORY_CHARS="100")
            r = run(["summarize", write_transcript(home, f"t{i}", 3)], env)
            assert r.returncode == 0, r.stderr
            e = next(x for x in read_jsonl(recent) if x["session_id"] == f"t{i}")
            assert e["title"] == title and e["summary"] == summary, (out, e)
    finally:
        shutil.rmtree(home)


def test_skip_short_session():
    home, fake = make_home()
    try:
        env = env_for(home, fake)
        path = write_transcript(home, "s2", 2)
        r = run(["summarize", path], env)
        assert r.returncode == 0, r.stderr
        assert not os.path.exists(os.path.join(env["CLAUDE_SESSION_MEMORY_DIR"], "recent.jsonl"))
    finally:
        shutil.rmtree(home)


def test_char_cap_enforced():
    home, fake = make_home()
    try:
        env = env_for(home, fake, FAKE_SUMMARY="あ" * 40, FAKE_SHRINK="い" * 30)
        path = write_transcript(home, "s3", 3)
        r = run(["summarize", path], env)
        assert r.returncode == 0, r.stderr
        e = read_jsonl(os.path.join(env["CLAUDE_SESSION_MEMORY_DIR"], "recent.jsonl"))[0]
        assert len(e["summary"]) == 20 and e["summary"].endswith("…") and e["summary"].startswith("い"), e["summary"]
        env2 = env_for(home, fake, FAKE_SUMMARY="う" * 40, FAKE_SHRINK="え" * 15)
        path2 = write_transcript(home, "s3b", 3)
        run(["summarize", path2], env2)
        rows = {x["session_id"]: x for x in read_jsonl(os.path.join(env["CLAUDE_SESSION_MEMORY_DIR"], "recent.jsonl"))}
        assert rows["s3b"]["summary"] == "え" * 15, rows["s3b"]
    finally:
        shutil.rmtree(home)


def test_ring_buffer_and_replace():
    home, fake = make_home()
    try:
        env = env_for(home, fake, FAKE_SUMMARY="題名\n要約")
        for i, sid in enumerate(["a", "b", "c"]):
            path = write_transcript(home, sid, 3 + i)
            run(["summarize", path], env)
        recent = os.path.join(env["CLAUDE_SESSION_MEMORY_DIR"], "recent.jsonl")
        archive = os.path.join(env["CLAUDE_SESSION_MEMORY_DIR"], "archive.jsonl")
        assert [x["session_id"] for x in read_jsonl(recent)] == ["a", "b", "c"]
        # 同じ session が伸びて再要約されたら置き換え（増えない）
        path = write_transcript(home, "b", 6)
        run(["summarize", path], env)
        rows = read_jsonl(recent)
        assert [x["session_id"] for x in rows] == ["a", "b", "c"], rows
        assert next(x for x in rows if x["session_id"] == "b")["human_turns"] == 6
        # 4 件目で最古が archive へ
        run(["summarize", write_transcript(home, "d", 3)], env)
        assert [x["session_id"] for x in read_jsonl(recent)] == ["b", "c", "d"]
        assert [x["session_id"] for x in read_jsonl(archive)] == ["a"]
        out = run(["render"], env).stdout
        assert "過去セッションの記録" in out and "現在の指示が常に優先する" in out, out
        assert out.count("\n- ") == 3 and "[/Users/x/workspace] 題名:" in out, out
    finally:
        shutil.rmtree(home)


def test_start_and_end_hooks():
    home, fake = make_home()
    try:
        env = env_for(home, fake, FAKE_SUMMARY="終了時の要約")
        # child では何もしない
        r = run(["start"], dict(env, CLAUDE_SESSION_MEMORY_CHILD="1"))
        assert r.returncode == 0 and r.stdout == "", r
        r = run(["end"], dict(env, CLAUDE_SESSION_MEMORY_CHILD="1"), stdin=json.dumps({"transcript_path": "/nonexistent"}))
        assert r.returncode == 0 and r.stdout == ""
        # 記録が無ければ start は無出力（毎セッションのトークンを食わない）
        r = run(["start"], env)
        assert r.returncode == 0 and r.stdout == "", r
        # end は detach して即抜け、しばらく後に recent.jsonl が生える
        path = write_transcript(home, "e1", 3)
        t0 = time.time()
        r = run(["end"], env, stdin=json.dumps({"transcript_path": path, "session_id": "e1", "hook_event_name": "SessionEnd"}))
        assert r.returncode == 0 and time.time() - t0 < 3, r
        recent = os.path.join(env["CLAUDE_SESSION_MEMORY_DIR"], "recent.jsonl")
        assert wait_for(lambda: os.path.exists(recent)), open(os.path.join(env["CLAUDE_SESSION_MEMORY_DIR"], "log.txt")).read()
        assert read_jsonl(recent)[0]["summary"] == "終了時の要約"
        r = run(["start"], env)
        assert "終了時の要約" in r.stdout, r.stdout
    finally:
        shutil.rmtree(home)


def test_catch_up():
    home, fake = make_home()
    try:
        env = env_for(home, fake, FAKE_SUMMARY="拾った")
        old = time.time() - 3600
        p_ok = write_transcript(home, "c1", 3)
        os.utime(p_ok, (old, old))
        p_fresh = write_transcript(home, "c2", 3)  # 更新直後 = まだ生きている扱い
        p_live = write_transcript(home, "c3", 3)
        os.utime(p_live, (old, old))
        p_short = write_transcript(home, "c4", 1)
        os.utime(p_short, (old, old))
        sdir = os.path.join(home, ".claude", "sessions")
        os.makedirs(sdir)
        with open(os.path.join(sdir, "1.json"), "w") as f:
            json.dump({"pid": os.getpid(), "sessionId": "c3"}, f)
        r = run(["catch-up"], env)
        assert r.returncode == 0, r.stderr
        recent = os.path.join(env["CLAUDE_SESSION_MEMORY_DIR"], "recent.jsonl")
        archive = os.path.join(env["CLAUDE_SESSION_MEMORY_DIR"], "archive.jsonl")
        assert [x["session_id"] for x in read_jsonl(recent)] == ["c1"], read_jsonl(recent)
        assert [x["session_id"] for x in read_jsonl(archive) if x.get("skipped")] == ["c4"]
        # 2 回目は何もしない（mtime を記録済み）
        r = run(["catch-up"], env)
        assert len(read_jsonl(recent)) == 1 and len(read_jsonl(archive)) == 1
        # 伸びたら再要約して置き換え
        p2 = write_transcript(home, "c1", 5)
        os.utime(p2, (old + 60, old + 60))
        run(["catch-up"], env)
        rows = read_jsonl(recent)
        assert len(rows) == 1 and rows[0]["human_turns"] == 5, rows
    finally:
        shutil.rmtree(home)


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"ok   {t.__name__}")
        except Exception as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e!r}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
