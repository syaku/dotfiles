#!/usr/bin/env python3
"""PreToolUse ガード: Bash でファイルシステムのルート (/) から再帰的に走査するコマンドを止める。

対象は `find / ...`、`rg pat /`、`grep -r pat /`、`du /` のように / を走査の起点に渡すもの、
それと `cd / && find .` のように先に / へ移ってから走査するもの。

止める理由:
- Claude Code の Bash では find が内蔵の bfs に置き換わり、/ からの走査は CPU 500% で数分続く。
  Bash ツールは 120 秒で時間切れになってもコマンドを止めずにバックグラウンドへ回すので、
  agent がやり直すたびに走査が重なる。
- このマシンでは / からの走査中に data.kalloc.1024 が数分で十数 GB 増え、翌朝カーネルパニック
  (zone map exhausted) で再起動した。2026-09-17 と 2026-09-25 の 2 回とも、PR レビューの
  agent が jar や node_modules を探す `find /` の直後だった。

exit 2 で止め、stderr に探す場所の候補を返して agent に自分で切り替えさせる。
判定は文字列の分解で行うので、変数展開や eval を経由した / は見逃す。塞ぎたいのは
agent が普通に書く形で、悪意のある回避ではない。
"""

import json
import os
import re
import sys

# / を起点に渡すと全体を走査するコマンド
WALKERS = {"find", "bfs", "fd", "fdfind", "rg", "ugrep", "ag", "du", "tree"}
# 再帰指定があるときだけ走査になるコマンド
RECURSIVE_ONLY = {"grep", "egrep", "fgrep", "ls"}
ROOT_ARGS = {"/", "/*", "/.", "/./"}
# コマンドの前に付くだけのもの。これを飛ばして本体のコマンド名を見る
PREFIXES = {"sudo", "time", "nice", "nohup", "command", "exec", "env", "xargs", "timeout"}

MESSAGE = """ファイルシステムのルート (/) から走査するコマンドは、このマシンでは使えません。
/ からの走査は数分かかり、このマシンではカーネルのメモリリークを誘発して再起動させています。

探しているものに合わせて、場所を絞って探してください。
- JVM の jar: ~/.gradle/caches/modules-2/files-2.1/<group>/<artifact>/ と ~/.m2/repository
- JS のパッケージ: 本体リポジトリの node_modules と、各 package 配下の node_modules。
  worktree には node_modules が無いことが多い。本体リポジトリの場所は
  `git rev-parse --path-format=absolute --git-common-dir` の親ディレクトリ。
- リポジトリのコード: ~/workspace/repos 以下
- それでも無ければ、公開されているソースを WebFetch で読む。
"""


HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1[^\n]*\n.*?^\s*\2\s*$", re.S | re.M)


def strip_literals(cmd):
    # ヒアドキュメントの本文とクォートの中身は、コマンドではなく文字列なので判定から外す。
    # commit メッセージや PR 本文に `find /` と書いただけで止めないため。
    # ただしクォートの中身がちょうど / などのときは引数として残す (find "/" -name x)
    cmd = HEREDOC.sub("", cmd)
    out, i = [], 0
    while i < len(cmd):
        c = cmd[i]
        if c in "'\"":
            j = cmd.find(c, i + 1)
            if j < 0:
                break
            inner = cmd[i + 1 : j]
            out.append(inner if inner in ROOT_ARGS else "Q")
            i = j + 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def split_segments(cmd):
    # ; && || | 改行 $( ` ( ) で単純コマンドに分ける
    return [s for s in re.split(r"\|\||&&|[;|\n`()]|\$\(", strip_literals(cmd)) if s.strip()]


def words(segment):
    return [w.strip("'\"") for w in segment.split()]


def command_name(ws):
    i = 0
    while i < len(ws):
        w = ws[i]
        if "=" in w and not w.startswith("-") and not w.startswith("/"):
            i += 1  # 環境変数の代入
        elif os.path.basename(w) in PREFIXES or (w.startswith("-") and i > 0):
            i += 1
        else:
            return os.path.basename(w), ws[i + 1 :]
    return None, []


def is_recursive(name, args):
    for a in args:
        if a in ("--recursive", "--dereference-recursive"):
            return True
        if re.fullmatch(r"-[A-Za-z]+", a) and ("r" in a or "R" in a):
            return True
    return False


def is_walker(name, args):
    if name in WALKERS:
        return True
    return name in RECURSIVE_ONLY and is_recursive(name, args)


def blocked(cmd):
    in_root = False
    for seg in split_segments(cmd):
        name, args = command_name(words(seg))
        if name is None:
            continue
        if name in ("cd", "pushd"):
            in_root = bool(args) and args[0] in ROOT_ARGS
            continue
        if not is_walker(name, args):
            continue
        if any(a in ROOT_ARGS for a in args):
            return True
        # cd / のあとで、絶対パスの起点を渡さずに走査する (find . / rg pat / du -sh *)
        if in_root and not any(a.startswith("/") and a not in ROOT_ARGS for a in args):
            return True
    return False


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return 0
    cmd = (data.get("tool_input") or {}).get("command") or ""
    if cmd and blocked(cmd):
        sys.stderr.write(MESSAGE)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
