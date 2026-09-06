#!/usr/bin/env python3
"""SessionStart フック: 自作 plugin の cache と marketplace の version ずれを報告する。

背景: skill を直して marketplace に merge しても、`claude plugin update` を回すまで
cache は古い version のまま使われる。2026-09-06 に develop-suite2 が cache 1.5.0 /
main 1.10.0 のまま走行し、直したはずの skill を一度も観測しないまま次の改修を積んで
いた事象が観測された。人が気づく機構が無かったのが原因なので、起動時に突き合わせる。

止めない。SessionStart は exit 2 が honor されず、plain-text stdout だけが context
として Claude に渡る（公式リファレンスの "Exit code 2 behavior per event"）。よって
これは検出層であり、報告は stdout に出す。ずれが無ければ何も出さない（毎セッション
のトークンを食わないため）。

比較の基準は remote の既定ブランチ。marketplace の clone は `claude plugin update`
を回したときにしか進まないので、clone の作業ツリーと比べても「push した直後のずれ」
は見つからない。そのため既定では fetch してから origin と比べる。fetch は FETCH_TTL
秒に 1 回までに絞り、timeout を掛け、失敗したら黙って clone の作業ツリーに落とす。

fail-open: 読めない・git が無い・ネットワークが無い場合は何も出さずに通す。ただし
判定を諦めた理由は stderr に 1 行出す（SessionStart の stderr は Claude には渡らず、
黙って無効化されたわけではないことを人が追えるようにするためだけのもの）。
"""

import json
import os
import subprocess
import sys
import time

sys.dont_write_bytecode = True  # ~/.claude/hooks/ に __pycache__ を作らない

# 突き合わせる marketplace。自作のものだけを対象にする（他人の plugin が最新でない
# のは通常の状態で、報告してもノイズにしかならない）。
TARGET_MARKETPLACES = ("syaku-claude-plugins",)

FETCH_TTL = 6 * 60 * 60  # このヒント秒数より新しい fetch があれば再 fetch しない
FETCH_TIMEOUT = 8  # 起動を待たせないための上限（秒）

HOME = os.path.expanduser("~")
PLUGIN_ROOT = os.path.join(HOME, ".claude", "plugins")
STATE_PATH = os.path.join(HOME, ".claude", "cache", "plugin-version-drift.json")


def warn(msg):
    print(f"plugin-version-drift: {msg}", file=sys.stderr)


def load_state():
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_state(state):
    try:
        os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
        with open(STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f)
    except OSError:
        pass  # 記録できなくても判定自体は成立する（次回また fetch するだけ）


def installed_versions(marketplace):
    """installed_plugins.json から <plugin>: <version> を取る。"""
    path = os.path.join(PLUGIN_ROOT, "installed_plugins.json")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        warn(f"{path} を読めないので検査を省略しました（{e.__class__.__name__}）")
        return None

    out = {}
    for key, entries in (data.get("plugins") or {}).items():
        if "@" not in key:
            continue
        name, mkt = key.rsplit("@", 1)
        if mkt != marketplace or not isinstance(entries, list) or not entries:
            continue
        entry = next((e for e in entries if e.get("scope") == "user"), entries[0])
        version = entry.get("version")
        if version:
            out[name] = str(version)
    return out


def git(clone, *args, timeout=None):
    return subprocess.run(
        ["git", "-C", clone, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def remote_ref_candidates(clone):
    """既定ブランチの ref を優先順に返す。origin/HEAD が無い clone もあるため。"""
    refs = []
    try:
        r = git(clone, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD")
        if r.returncode == 0 and r.stdout.strip():
            refs.append(r.stdout.strip())
    except OSError:
        pass
    refs += ["refs/remotes/origin/main", "refs/remotes/origin/master"]
    return refs


def maybe_fetch(clone, marketplace, state):
    """FETCH_TTL 内に fetch 済みなら何もしない。戻り値は fetch が成功したか。"""
    now = time.time()
    last = state.get("last_fetch", {}).get(marketplace, 0)
    try:
        last = float(last)
    except (TypeError, ValueError):
        last = 0
    if now - last < FETCH_TTL:
        return True  # 直近に取得済み。origin は十分新しいとみなす。

    try:
        r = git(clone, "fetch", "--quiet", "origin", timeout=FETCH_TIMEOUT)
    except (subprocess.TimeoutExpired, OSError) as e:
        warn(f"{marketplace}: fetch できないので作業ツリーと比べます（{e.__class__.__name__}）")
        return False
    if r.returncode != 0:
        warn(f"{marketplace}: fetch に失敗したので作業ツリーと比べます")
        return False

    state.setdefault("last_fetch", {})[marketplace] = now
    return True


def published_versions(clone, marketplace, state):
    """marketplace.json の <plugin>: <version> と、それをどこから読んだかを返す。"""
    rel = ".claude-plugin/marketplace.json"
    raw = None
    origin = "作業ツリー"

    if maybe_fetch(clone, marketplace, state):
        for ref in remote_ref_candidates(clone):
            try:
                r = git(clone, "show", f"{ref}:{rel}", timeout=FETCH_TIMEOUT)
            except (subprocess.TimeoutExpired, OSError):
                break
            if r.returncode == 0:
                raw = r.stdout
                origin = ref.replace("refs/remotes/", "")
                break

    if raw is None:
        try:
            with open(os.path.join(clone, rel), encoding="utf-8") as f:
                raw = f.read()
        except OSError as e:
            warn(f"{marketplace}: {rel} を読めないので検査を省略しました（{e.__class__.__name__}）")
            return None, origin

    try:
        data = json.loads(raw)
    except ValueError:
        warn(f"{marketplace}: {rel} が JSON として読めないので検査を省略しました")
        return None, origin

    out = {}
    for p in data.get("plugins") or []:
        name, version = p.get("name"), p.get("version")
        if name and version:
            out[str(name)] = str(version)
    return out, origin


def drift(installed, published):
    """cache と marketplace で version が食い違う plugin を返す。

    published にしか無いものは未 install なので対象外（意図して入れていない）。
    installed にしか無いものは marketplace から消えた可能性があるが、ここでは
    version のずれだけを見る。
    """
    return [
        (name, installed[name], published[name])
        for name in sorted(installed)
        if name in published and installed[name] != published[name]
    ]


def main():
    try:
        sys.stdin.read()  # SessionStart の payload は使わないが、読み捨てて詰まりを避ける
    except Exception:
        pass

    state = load_state()
    rows = []
    source = None

    for marketplace in TARGET_MARKETPLACES:
        clone = os.path.join(PLUGIN_ROOT, "marketplaces", marketplace)
        if not os.path.isdir(os.path.join(clone, ".git")):
            continue  # この機には入っていない marketplace
        installed = installed_versions(marketplace)
        if installed is None:
            continue
        published, source = published_versions(clone, marketplace, state)
        if published is None:
            continue
        rows += [(marketplace, *row) for row in drift(installed, published)]

    save_state(state)

    if not rows:
        return 0

    lines = [
        "plugin の cache が marketplace の version と食い違っています"
        f"（比較元: {source}）。cache 側の古い skill が使われます。"
    ]
    for marketplace, name, have, want in rows:
        lines.append(f"  {name}@{marketplace}: cache {have} / marketplace {want}")
    lines.append("  `claude plugin update` を実行し、Claude Code を再起動すると揃います。")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
