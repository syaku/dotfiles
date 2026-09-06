#!/usr/bin/env python3
"""plugin-version-drift.py のテスト。

実行: python3 ~/.claude/hooks/plugin-version-drift.test.py

HOME を一時ディレクトリに差し替えて hook を別プロセスで起動するので、実環境の
~/.claude/plugins や cache には触れない。ネットワークにも出ない（origin はローカルの
bare リポジトリを使う）。
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "plugin-version-drift.py")
MKT = "syaku-claude-plugins"
REL = os.path.join(".claude-plugin", "marketplace.json")


def git(cwd, *args):
    return subprocess.run(
        ["git", "-C", cwd, *args], capture_output=True, text=True, check=False
    )


def marketplace_json(versions):
    return json.dumps(
        {"name": MKT, "plugins": [{"name": n, "version": v} for n, v in versions.items()]},
        ensure_ascii=False,
    )


def make_home(installed, tree_versions, origin_versions=None, marketplace=MKT, git_init=True):
    """テスト用の HOME を組む。origin_versions を渡すとローカル origin を用意する。"""
    home = tempfile.mkdtemp(prefix="drift-test-home-")
    plugins = os.path.join(home, ".claude", "plugins")
    clone = os.path.join(plugins, "marketplaces", marketplace)
    os.makedirs(os.path.join(clone, ".claude-plugin"), exist_ok=True)

    if installed is not None:
        os.makedirs(plugins, exist_ok=True)
        entries = {
            f"{name}@{marketplace}": [{"scope": "user", "version": v}]
            for name, v in installed.items()
        }
        with open(os.path.join(plugins, "installed_plugins.json"), "w", encoding="utf-8") as f:
            json.dump({"version": 2, "plugins": entries}, f)

    def write_tree(versions):
        with open(os.path.join(clone, REL), "w", encoding="utf-8") as f:
            f.write(versions if isinstance(versions, str) else marketplace_json(versions))

    if not git_init:
        write_tree(tree_versions)
        return home, clone

    git(clone, "init", "-b", "main", "-q")
    git(clone, "config", "user.email", "t@example.invalid")
    git(clone, "config", "user.name", "test")

    if origin_versions is not None:
        # origin にだけ載っている version を作る。作業ツリーは別の値にしておくので、
        # 報告が origin 由来か作業ツリー由来かをテストが見分けられる。
        write_tree(origin_versions)
        git(clone, "add", "-A")
        git(clone, "commit", "-q", "-m", "origin")
        bare = tempfile.mkdtemp(prefix="drift-test-origin-")
        subprocess.run(["git", "init", "--bare", "-q", bare], check=False)
        git(clone, "remote", "add", "origin", bare)
        git(clone, "push", "-q", "origin", "main")
        git(clone, "fetch", "-q", "origin")
    else:
        write_tree(tree_versions)
        git(clone, "add", "-A")
        git(clone, "commit", "-q", "-m", "init")
        # 到達できない origin。fetch は失敗し、作業ツリーへ落ちるはず。
        git(clone, "remote", "add", "origin", os.path.join(home, "does-not-exist.git"))

    write_tree(tree_versions)
    return home, clone


def run(home):
    env = dict(os.environ, HOME=home, USERPROFILE=home)
    p = subprocess.run(
        [sys.executable, HOOK],
        input=json.dumps({"hook_event_name": "SessionStart", "start_reason": "startup"}),
        capture_output=True,
        text=True,
        env=env,
    )
    return p.returncode, p.stdout, p.stderr


CASES = []


def case(desc):
    def deco(fn):
        CASES.append((desc, fn))
        return fn

    return deco


def check(cond, msg):
    return None if cond else msg


@case("1. version が一致していれば何も出さない")
def c1():
    home, _ = make_home({"develop-suite2": "1.10.1"}, {"develop-suite2": "1.10.1"})
    code, out, _ = run(home)
    return check(code == 0 and out.strip() == "", f"exit={code} stdout={out!r}")


@case("2. cache が古ければ報告する")
def c2():
    home, _ = make_home({"develop-suite2": "1.5.0"}, {"develop-suite2": "1.10.0"})
    code, out, _ = run(home)
    return check(
        code == 0 and "develop-suite2" in out and "1.5.0" in out and "1.10.0" in out,
        f"exit={code} stdout={out!r}",
    )


@case("3. 複数のずれをすべて報告する")
def c3():
    home, _ = make_home(
        {"develop-suite": "4.1.0", "develop-suite2": "1.5.0", "drain-harvest": "2.2.0"},
        {"develop-suite": "4.2.0", "develop-suite2": "1.10.0", "drain-harvest": "2.2.0"},
    )
    code, out, _ = run(home)
    return check(
        "4.2.0" in out and "1.10.0" in out and "drain-harvest" not in out,
        f"stdout={out!r}",
    )


@case("4. marketplace にあっても未 install なら報告しない")
def c4():
    home, _ = make_home({"develop-suite2": "1.10.0"}, {"develop-suite2": "1.10.0", "新規": "0.1.0"})
    code, out, _ = run(home)
    return check(out.strip() == "", f"stdout={out!r}")


@case("5. 対象外の marketplace は見ない")
def c5():
    home, _ = make_home(
        {"arscontexta": "0.8.0"}, {"arscontexta": "9.9.9"}, marketplace="agenticnotetaking"
    )
    code, out, _ = run(home)
    return check(code == 0 and out.strip() == "", f"exit={code} stdout={out!r}")


@case("6. origin が新しければ origin の version と比べる")
def c6():
    home, _ = make_home(
        {"develop-suite2": "1.5.0"},
        {"develop-suite2": "1.5.0"},  # 作業ツリーは cache と同じ = ここを見たら報告は出ない
        origin_versions={"develop-suite2": "1.10.0"},
    )
    code, out, _ = run(home)
    return check("1.10.0" in out, f"origin を読めていない: stdout={out!r}")


@case("7. fetch できなくても作業ツリーで比較する")
def c7():
    home, _ = make_home({"develop-suite2": "1.5.0"}, {"develop-suite2": "1.10.0"})
    code, out, err = run(home)
    return check(code == 0 and "1.10.0" in out, f"exit={code} stdout={out!r} stderr={err!r}")


@case("8. marketplace.json が壊れていれば黙って通す")
def c8():
    home, _ = make_home({"develop-suite2": "1.5.0"}, "{ not json")
    code, out, _ = run(home)
    return check(code == 0 and out.strip() == "", f"exit={code} stdout={out!r}")


@case("9. installed_plugins.json が無ければ黙って通す")
def c9():
    home, _ = make_home(None, {"develop-suite2": "1.10.0"})
    code, out, _ = run(home)
    return check(code == 0 and out.strip() == "", f"exit={code} stdout={out!r}")


@case("10. clone が git リポジトリでなければ見ない")
def c10():
    home, _ = make_home({"develop-suite2": "1.5.0"}, {"develop-suite2": "1.10.0"}, git_init=False)
    code, out, _ = run(home)
    return check(code == 0 and out.strip() == "", f"exit={code} stdout={out!r}")


@case("11. 入力の JSON が壊れていても落ちない")
def c11():
    home, _ = make_home({"develop-suite2": "1.10.0"}, {"develop-suite2": "1.10.0"})
    env = dict(os.environ, HOME=home, USERPROFILE=home)
    p = subprocess.run(
        [sys.executable, HOOK], input="{ not json", capture_output=True, text=True, env=env
    )
    return check(p.returncode == 0, f"exit={p.returncode} stderr={p.stderr!r}")


@case("12. 報告は復旧手順を含む")
def c12():
    home, _ = make_home({"develop-suite2": "1.5.0"}, {"develop-suite2": "1.10.0"})
    _, out, _ = run(home)
    return check("claude plugin update" in out, f"stdout={out!r}")


def main():
    if not os.path.exists(HOOK):
        print(f"hook が無い: {HOOK}")
        return 1
    if shutil.which("git") is None:
        print("git が無いのでテストできない")
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
