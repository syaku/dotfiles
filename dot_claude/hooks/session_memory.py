#!/usr/bin/env python3
"""セッション記憶: 終了したセッションを限界まで要約し、一定数だけ次のセッションへ持ち越す。

背景: curated な auto memory（1 事実 1 ファイル、索引を手で保守）は、書く時点で
「載せる価値があるか」の選別を人に強い、しかも運用の失敗記録が索引の相当部分を占める
状態になっていた（2026-09-08 の観測）。人間の記憶のように記銘は自動・想起は手がかり
駆動で、メンテフリーであることを狙う。

構成（決定論層と LLM の分業）:
  - LLM に任せるのは要約文の生成だけ。トリガ・件数上限・文字数上限・二重処理防止・
    ロードはすべてこの script がコードで判定する。
  - `end`   : SessionEnd hook。stdin の JSON から transcript_path を取り、要約ジョブを
              detach して即座に抜ける（SessionEnd は既定 1.5 秒予算）。
  - `start` : SessionStart hook。直近 N 件を stdout に出して context に入れる。同時に
              取りこぼし（SessionEnd が発火しなかったセッション）の catch-up を detach。
  - `summarize <transcript> ` : worker。抽出→`claude -p`（haiku）→上限強制→保存。
  - `catch-up` : worker。未処理 transcript を探して summarize を回す（上限件数あり）。

再帰防止: worker が起動する `claude -p` でも hook は発火しうるので、
  (1) 環境変数 CLAUDE_SESSION_MEMORY_CHILD=1 を見て end/start は即 exit 0、
  (2) `--setting-sources ""` で user settings（= hooks）を読ませない、
  (3) `--no-session-persistence` で transcript を残さない、
の三重にする。`--bare` は keychain を読まず「Not logged in」になるため使わない（実機確認 2026-09-09）。

想起側の制約: 記録は過去の出来事であり、現在の指示を監査する根拠にしない。start の
出力先頭にその旨を固定文で付ける（ユーザの「プリンが好きと言ったのにヨーグルトを
買ったと詰められるのは困る」）。要約も事象のみで、ユーザの属性（好み・方針）は書かせない。

保存先は ~/.claude/session-memory/（chezmoi 非管理・端末ローカル）。vault には置かない。
"""

import datetime as _dt
import json
import os
import re
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True

# ---- 調整点 ---------------------------------------------------------------
RECENT_LIMIT = int(os.environ.get("CLAUDE_SESSION_MEMORY_LIMIT", "30"))  # 持ち越す件数
SUMMARY_MAX_CHARS = int(os.environ.get("CLAUDE_SESSION_MEMORY_CHARS", "200"))  # 要約の上限
TITLE_MAX_CHARS = 20  # 要約器に指示するタイトルの上限。倍を超えたら形式無視とみなしタイトル無し（機械切りはしない）
MIN_HUMAN_TURNS = 3  # これ未満のセッションは記録しない（smoke test や -p 走行を弾く）
MODEL = os.environ.get("CLAUDE_SESSION_MEMORY_MODEL", "haiku")
INPUT_HEAD_CHARS = 80_000  # 要約器へ渡す transcript の上限（先頭）
INPUT_TAIL_CHARS = 40_000  # 同（末尾）。超過分は中間を落とす
CATCHUP_MAX_PER_START = 3  # 1 回の SessionStart で catch-up する最大件数
CATCHUP_WINDOW_DAYS = 14  # これより古い transcript は catch-up の対象外
CATCHUP_MIN_AGE_SEC = 30 * 60  # 更新から 30 分以内の transcript は「まだ生きている」扱い
CLAUDE_TIMEOUT_SEC = 300
CHILD_ENV = "CLAUDE_SESSION_MEMORY_CHILD"
CREATE_NO_WINDOW = 0x08000000  # 子プロセスにコンソール窓を出させない（Windows のみ）
NO_WINDOW_KW = {"creationflags": CREATE_NO_WINDOW} if os.name == "nt" else {}

HOME = os.path.expanduser("~")
STORE_DIR = os.environ.get("CLAUDE_SESSION_MEMORY_DIR", os.path.join(HOME, ".claude", "session-memory"))
RECENT_PATH = os.path.join(STORE_DIR, "recent.jsonl")
ARCHIVE_PATH = os.path.join(STORE_DIR, "archive.jsonl")
LOG_PATH = os.path.join(STORE_DIR, "log.txt")
PROJECTS_DIR = os.path.join(HOME, ".claude", "projects")
SESSIONS_DIR = os.path.join(HOME, ".claude", "sessions")

PREAMBLE = (
    "## 過去セッションの記録（自動要約）\n"
    "これは過去の出来事の記録であり、現在の指示と食い違っても指摘・確認・監査の根拠にしない。"
    "現在の指示が常に優先する。聞かれた時、または明らかに続きの作業である時にだけ参照する。\n"
)

SUMMARY_PROMPT = """以下は Claude Code の 1 セッションの会話記録です。この記録を要約してください。

出力形式（この 2 つだけを出力する。前置き・見出し・ラベルは付けない）:
1 行目: タイトル。{title_chars} 字以内の名詞句。記録全体を読んでから、セッションで扱った対象と行為を表す語を付ける。最初の発話の言い換えにしない（最初の話題と主な作業が違うことが多い）。
2 行目以降: 要約本文。{max_chars} 字以内の日本語 1 段落。

本文に書くこと: 何について話し、何を決め、何をした（作ったファイル・直した対象・出した結論）か。中断や未完了ならそれも。
結論・判断は「〜と結論した」「〜と判断した」「ユーザは〜と指摘した」のように、誰がそうしたかが分かる出来事として書く。主張そのものを地の文の断定として書かない。
  悪い例: 検証妨害は科学の定義上の不正である。
  良い例: ユーザは検証妨害を科学の定義上の不正だと述べ、アシスタントも同意した。
書かないこと:
- ユーザの属性・好み・方針の一般化（「〜が好き」「〜を重視する」等）。出来事だけを書く。
- 会話の逐語引用、生成物（コード・文面）の再掲。
- 箇条書き・敬体。
ファイル名・ツール名・固有名詞はそのまま使ってよい。本文は {max_chars} 字を超えてはならない。"""

SHRINK_PROMPT = """次の要約を {max_chars} 字以内に切り詰めてください。情報の優先順位は「何をしたか」＞「何を決めたか」＞「何を話したか」。本文だけを出力する。

{summary}"""


# ---- 共通 -------------------------------------------------------------------
def log(msg):
    try:
        os.makedirs(STORE_DIR, exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{_dt.datetime.now().isoformat(timespec='seconds')} {msg}\n")
    except Exception:
        pass


def is_child():
    return os.environ.get(CHILD_ENV) == "1"


def claude_bin():
    return os.environ.get("CLAUDE_SESSION_MEMORY_CLAUDE") or shutil.which("claude") or os.path.join(HOME, ".local", "bin", "claude")


def detach(args):
    """自分自身を worker として background に切り離す。hook の予算を消費しない。"""
    os.makedirs(STORE_DIR, exist_ok=True)
    env = dict(os.environ)
    env[CHILD_ENV] = "1"
    kw = {"start_new_session": True}
    if os.name == "nt":
        # DETACHED_PROCESS だと worker 自身がコンソールを持たず、孫の claude（console app）が
        # 可視のコンソール窓を新規に確保してしまう。CREATE_NO_WINDOW なら不可視のコンソールが
        # 割り当てられ、孫もそれを継承するので窓が出ない（実機観測 2026-09-13）。
        kw = {"creationflags": CREATE_NO_WINDOW | 0x00000200}  # CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
    with open(LOG_PATH, "a", encoding="utf-8") as out:
        subprocess.Popen(
            [sys.executable, os.path.abspath(__file__), *args],
            stdin=subprocess.DEVNULL,
            stdout=out,
            stderr=out,
            env=env,
            cwd=STORE_DIR,
            **kw,
        )


# ---- transcript の抽出 -------------------------------------------------------
_STRIP_TAGS = ("system-reminder", "local-command-stdout", "local-command-caveat", "command-name", "command-message", "command-args", "task-notification")
_STRIP_RE = re.compile("|".join(rf"<{t}>.*?</{t}>" for t in _STRIP_TAGS), re.S)


def _clean_text(s):
    s = _STRIP_RE.sub("", s)
    return s.strip()


def extract(transcript_path):
    """transcript から要約器に渡す情報を取り出す。

    返り値: dict(session_id, started(ISO, ローカル), cwd, human_turns, text)
    human_turns は origin.kind == "human" の user 発話数（tool_result や meta は数えない）。
    transcript の ai-title は読まない（最初の発話から作られ、セッション全体の内容と食い違うことが多い）。
    """
    lines = []
    human_turns = 0
    started = None
    cwd = None
    session_id = None
    with open(transcript_path, encoding="utf-8") as f:
        for raw in f:
            try:
                d = json.loads(raw)
            except Exception:
                continue
            t = d.get("type")
            if t not in ("user", "assistant"):
                continue
            if d.get("isSidechain") or d.get("isMeta"):
                continue
            session_id = session_id or d.get("sessionId")
            cwd = cwd or d.get("cwd")
            m = d.get("message") or {}
            content = m.get("content")
            parts = []
            if isinstance(content, str):
                parts.append(_clean_text(content))
            else:
                for b in content or []:
                    bt = b.get("type")
                    if bt == "text":
                        parts.append(_clean_text(b.get("text", "")))
                    elif bt == "tool_use":
                        parts.append(f"[tool: {b.get('name', '')}]")
            text = "\n".join(p for p in parts if p)
            if not text:
                continue
            if t == "user":
                if (d.get("origin") or {}).get("kind") != "human":
                    continue
                human_turns += 1
                if started is None:
                    started = d.get("timestamp")
                lines.append(f"USER: {text}")
            else:
                lines.append(f"ASSISTANT: {text}")
    body = "\n\n".join(lines)
    if len(body) > INPUT_HEAD_CHARS + INPUT_TAIL_CHARS:
        body = body[:INPUT_HEAD_CHARS] + "\n\n[...中略...]\n\n" + body[-INPUT_TAIL_CHARS:]
    return {
        "session_id": session_id,
        "started": _to_local(started),
        "cwd": cwd,
        "human_turns": human_turns,
        "text": body,
    }


def _to_local(iso):
    if not iso:
        return None
    try:
        t = _dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return t.astimezone().isoformat(timespec="minutes")
    except Exception:
        return iso


# ---- 要約 -------------------------------------------------------------------
def run_claude(prompt, stdin_text=None):
    env = dict(os.environ)
    env[CHILD_ENV] = "1"
    cmd = [
        claude_bin(), "-p",
        "--setting-sources", "",
        "--no-session-persistence",
        "--disable-slash-commands",
        "--tools", "",
        "--model", MODEL,
        "--output-format", "text",
        prompt,
    ]
    os.makedirs(STORE_DIR, exist_ok=True)
    # encoding を明示しないと Windows では cp932 になり、transcript の em dash 等で
    # stdin 書き込みが UnicodeEncodeError で死ぬ（claude は入力待ちのまま timeout まで残る）。
    r = subprocess.run(
        cmd,
        input=stdin_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        cwd=STORE_DIR,
        timeout=CLAUDE_TIMEOUT_SEC,
        **NO_WINDOW_KW,
    )
    if r.returncode != 0:
        raise RuntimeError(f"claude exit {r.returncode}: {r.stderr.strip()[:300]}")
    return r.stdout.strip()


def _normalize(s):
    return " ".join(s.split())


# prompt 内のラベル（「1 行目:」等）を要約器が複写した場合に剥がす
_TITLE_LABEL_RE = re.compile(r"^\s*(?:[1１]\s*行目|[2２]\s*行目以降|タイトル|title)\s*[:：]\s*", re.I)


def _split_title(raw):
    """要約器の出力を (title, body) に分ける。1 行目をタイトルとみなす。

    形式に従っていない（改行が無い・1 行目が長すぎる・1 行目が文＝句点で終わる）時は
    タイトル無しで全文を本文にする。transcript の ai-title（最初の発話から自動生成され
    本文と食い違う）には戻さない。
    """
    raw = raw.strip()
    first, _, rest = raw.partition("\n")
    first = _TITLE_LABEL_RE.sub("", first.strip()).strip("#*-「」『』\"' ")
    rest = _TITLE_LABEL_RE.sub("", rest.strip())
    if not first or not rest or len(first) > TITLE_MAX_CHARS * 2 or first.endswith(("。", "！", "？", "．")):
        return None, raw
    return first, rest  # 上限の倍までは切らずに使う（機械切りは語の途中で切れて別のノイズになる）


def summarize_text(text):
    """(title, summary) を生成し、文字数上限をコードで強制する。本文の超過は 1 回だけ縮約を依頼し、なお超えたら切る。"""
    raw = run_claude(SUMMARY_PROMPT.format(max_chars=SUMMARY_MAX_CHARS, title_chars=TITLE_MAX_CHARS), stdin_text=text)
    title, s = _split_title(raw)
    s = _normalize(s)
    if len(s) > SUMMARY_MAX_CHARS:
        s2 = _normalize(run_claude(SHRINK_PROMPT.format(max_chars=SUMMARY_MAX_CHARS, summary=s)))
        s = s2 if s2 else s
    if len(s) > SUMMARY_MAX_CHARS:
        s = s[: SUMMARY_MAX_CHARS - 1] + "…"
    return title, s


# ---- 保存（ring buffer） ------------------------------------------------------
def _read_jsonl(path):
    out = []
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as f:
        for raw in f:
            raw = raw.strip()
            if not raw:
                continue
            try:
                out.append(json.loads(raw))
            except Exception:
                continue
    return out


def _write_jsonl(path, rows):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def _append_jsonl(path, rows):
    with open(path, "a", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


class _Lock:
    """store の read-modify-write を直列化する（同時に 2 セッションが終わると行が落ちる）。fcntl が無い環境では no-op。"""

    def __enter__(self):
        os.makedirs(STORE_DIR, exist_ok=True)
        self.f = open(os.path.join(STORE_DIR, ".lock"), "a+")
        try:
            import fcntl

            fcntl.flock(self.f, fcntl.LOCK_EX)
        except Exception:
            pass
        return self

    def __exit__(self, *exc):
        try:
            import fcntl

            fcntl.flock(self.f, fcntl.LOCK_UN)
        except Exception:
            pass
        self.f.close()
        return False


def known_entries():
    """session_id -> entry。recent と archive の両方から（archive は上書き用に mtime だけ要る）。"""
    known = {}
    for e in _read_jsonl(ARCHIVE_PATH) + _read_jsonl(RECENT_PATH):
        if e.get("session_id"):
            known[e["session_id"]] = e
    return known


def store(entry):
    """同じ session_id の既存行は置き換え（resume/clear で伸びた分の更新）。末尾 N 件だけ recent に残す。"""
    with _Lock():
        recent = _read_jsonl(RECENT_PATH)
        idx = next((i for i, e in enumerate(recent) if e.get("session_id") == entry["session_id"]), None)
        if idx is None:
            recent.append(entry)
        else:
            recent[idx] = entry  # 位置は保つ（started が同じ時に順序が揺れないように）
        recent.sort(key=lambda e: e.get("started") or "")  # stable sort
        overflow = recent[:-RECENT_LIMIT] if len(recent) > RECENT_LIMIT else []
        recent = recent[-RECENT_LIMIT:]
        if overflow:
            _append_jsonl(ARCHIVE_PATH, overflow)
        _write_jsonl(RECENT_PATH, recent)


def summarize_transcript(transcript_path, reason="end"):
    info = extract(transcript_path)
    if info["human_turns"] < MIN_HUMAN_TURNS:
        log(f"skip {os.path.basename(transcript_path)}: human_turns={info['human_turns']}")
        return None
    if not info["session_id"]:
        log(f"skip {transcript_path}: no session_id")
        return None
    title, summary = summarize_text(info["text"])
    entry = {
        "session_id": info["session_id"],
        "started": info["started"],
        "cwd": info["cwd"],
        "title": title,  # 要約器が全文から付けたもの。transcript の ai-title は使わない
        "summary": summary,
        "human_turns": info["human_turns"],
        "transcript_mtime": int(os.path.getmtime(transcript_path)),
        "recorded_at": _dt.datetime.now().astimezone().isoformat(timespec="minutes"),
        "via": reason,
    }
    store(entry)
    log(f"stored {info['session_id']} turns={info['human_turns']} len={len(summary)} via={reason}")
    return entry


# ---- 想起（SessionStart） -----------------------------------------------------
def _short_cwd(p):
    if not p:
        return "?"
    if p == HOME or p.startswith(HOME + os.sep):
        return "~" + p[len(HOME):]
    return p


def render_recent():
    rows = _read_jsonl(RECENT_PATH)
    if not rows:
        return ""
    rows.sort(key=lambda e: e.get("started") or "")
    lines = [PREAMBLE]
    for e in rows[-RECENT_LIMIT:]:
        day = (e.get("started") or "")[:10] or "????-??-??"
        title = e.get("title") or ""
        head = f"{day} [{_short_cwd(e.get('cwd'))}]"
        if title:
            head += f" {title}:"
        lines.append(f"- {head} {e.get('summary', '')}")
    return "\n".join(lines) + "\n"


# ---- catch-up ----------------------------------------------------------------
def live_session_ids():
    ids = set()
    if not os.path.isdir(SESSIONS_DIR):
        return ids
    for name in os.listdir(SESSIONS_DIR):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(SESSIONS_DIR, name), encoding="utf-8") as f:
                d = json.load(f)
            pid = int(d.get("pid") or 0)
            if pid and _pid_alive(pid) and d.get("sessionId"):
                ids.add(d["sessionId"])
        except Exception:
            continue
    return ids


def _pid_alive(pid):
    """判定できない時は「生きている」に倒す（生きているセッションを catch-up で読むより安全）。"""
    if os.name == "nt":
        # Windows の os.kill(pid, 0) はプロセスを殺すので使わない
        try:
            import ctypes

            h = ctypes.windll.kernel32.OpenProcess(0x1000, False, int(pid))  # PROCESS_QUERY_LIMITED_INFORMATION
            if not h:
                return False
            ctypes.windll.kernel32.CloseHandle(h)
            return True
        except Exception:
            return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except Exception:
        return True


def catch_up(limit=CATCHUP_MAX_PER_START):
    """SessionEnd が発火しなかった（kill 等）transcript を拾う。1 回あたり limit 件まで。"""
    if not os.path.isdir(PROJECTS_DIR):
        return 0
    now = _dt.datetime.now().timestamp()
    known = known_entries()
    live = live_session_ids()
    candidates = []
    for proj in os.listdir(PROJECTS_DIR):
        pdir = os.path.join(PROJECTS_DIR, proj)
        if not os.path.isdir(pdir):
            continue
        for name in os.listdir(pdir):
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(pdir, name)
            sid = name[:-6]
            try:
                mtime = os.path.getmtime(path)
            except OSError:
                continue
            if now - mtime < CATCHUP_MIN_AGE_SEC or now - mtime > CATCHUP_WINDOW_DAYS * 86400:
                continue
            if sid in live:
                continue
            prev = known.get(sid)
            if prev and int(prev.get("transcript_mtime") or 0) >= int(mtime):
                continue
            candidates.append((mtime, path))
    candidates.sort(reverse=True)
    done = 0
    for _, path in candidates:
        if done >= limit:
            break
        try:
            if summarize_transcript(path, reason="catch-up"):
                done += 1
            else:
                _mark_skipped(path)
        except Exception as e:  # 1 件の失敗で残りを止めない
            log(f"catch-up failed {path}: {e}")
    return done


def _mark_skipped(path):
    """human_turns 不足で捨てた transcript を毎回読み直さないよう、要約なしの行で mtime を記録する。"""
    sid = os.path.basename(path)[:-6]
    try:
        mtime = int(os.path.getmtime(path))
    except OSError:
        return
    with _Lock():
        _append_jsonl(ARCHIVE_PATH, [{"session_id": sid, "transcript_mtime": mtime, "skipped": True}])


# ---- hook 入口 ---------------------------------------------------------------
def cmd_end():
    if is_child():
        return 0
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    path = payload.get("transcript_path")
    if not path or not os.path.exists(path):
        return 0
    detach(["summarize", path])
    return 0


def cmd_start():
    if is_child():
        return 0
    out = render_recent()
    if out:
        sys.stdout.write(out)
    try:
        detach(["catch-up"])
    except Exception as e:
        print(f"session_memory: catch-up detach failed: {e}", file=sys.stderr)
    return 0


def main(argv):
    if not argv:
        print("usage: session_memory.py end|start|summarize <transcript>|catch-up|render", file=sys.stderr)
        return 1
    cmd = argv[0]
    if cmd == "end":
        return cmd_end()
    if cmd == "start":
        return cmd_start()
    if cmd == "summarize":
        if len(argv) < 2:
            return 1
        try:
            summarize_transcript(argv[1], reason=argv[2] if len(argv) > 2 else "end")
        except Exception as e:
            log(f"summarize failed {argv[1]}: {e}")
            return 1
        return 0
    if cmd == "catch-up":
        n = catch_up()
        log(f"catch-up done: {n}")
        return 0
    if cmd == "render":
        sys.stdout.write(render_recent())
        return 0
    print(f"unknown command: {cmd}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
