#!/usr/bin/env python3
"""vault_catalog.py — Obsidian vault の notes/ から機械生成カタログ（ノード索引＋リンクグラフ）を出力する。

harvest-pipeline の drain 突き合わせ agent・洞察検出 agent に注入する「安く再生成できる静的索引」を作る。
LLM agent は動的 Dataview クエリを実行できない参照者なので、Grep fan-out の代わりに事前計算した索引を渡す
（背景: vault の [[安く再生成できる索引は腐敗しない]] / [[動的索引はクエリを実行できない参照者に機能しない]]）。

抽出するのは実 wikilink / frontmatter link のみ。MOC/ は Dataview 集約でエッジを静的に持たないので走査しない。
タグは N^2 エッジに展開せず tag_index（tag -> ノード群）で弱いエッジとして供給する。

依存なし（stdlib のみ）。frontmatter は必要キーだけを軽量パースする（PyYAML 不要）。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

# 全文から wikilink を拾う（frontmatter の "[[..]]" も本文の [[..]] も同一パスで）
WIKILINK = re.compile(r"\[\[([^\[\]|#]+)(?:[#|][^\[\]]*)?\]\]")
# 層を決めるタグ（CLAUDE.md「学習ループ」節。1 ノートは複数層を兼ねない前提だが優先順位で確定する）
LAYER_BY_TAG = ["洞察", "気づき", "タスク"]
# AI Context callout 本文の先頭を gist に使う
AI_CONTEXT_RE = re.compile(r">\s*\[!NOTE\]\s*AI Context\s*\n((?:>.*\n?)*)", re.IGNORECASE)


def split_frontmatter(text: str) -> tuple[str, str]:
    """先頭の --- ... --- を frontmatter として切り出す。無ければ ('', 本文全体)。"""
    if not text.startswith("---\n"):
        return "", text
    end = text.find("\n---", 4)
    if end == -1:
        return "", text
    fm = text[4:end]
    body = text[end + 4:]
    return fm, body


def parse_frontmatter(fm: str) -> dict:
    """必要キーだけの軽量パーサ。scalar / inline []・[a,b] / ブロックリスト（- item）に対応。

    YAML 全対応は狙わない（ネスト・複数行スカラ等は対象外）。tags/progress/type/status/usage を拾えれば足りる。
    """
    result: dict = {}
    lines = fm.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if not m:
            i += 1
            continue
        key, val = m.group(1), m.group(2).strip()
        if val == "" or val is None:
            # ブロックリストの可能性: 後続の "  - item" を集める
            items = []
            j = i + 1
            while j < len(lines) and re.match(r"^\s+-\s+", lines[j]):
                items.append(re.sub(r"^\s+-\s+", "", lines[j]).strip())
                j += 1
            if items:
                result[key] = [_unquote(x) for x in items]
                i = j
                continue
            result[key] = ""
        elif val == "[]":
            result[key] = []
        elif val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            result[key] = [_unquote(x.strip()) for x in inner.split(",")] if inner else []
        else:
            result[key] = _unquote(val)
        i += 1
    return result


def _unquote(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1]
    return s


def normalize_link(raw: str) -> str:
    """[[Target|alias]] や [[Target#heading]] から Target（ノートタイトル）を取り出す。"""
    return raw.strip()


def extract_gist(body: str) -> str:
    """AI Context callout 本文の先頭 1-2 文を gist として返す（--with-gist 時のみ使う）。"""
    m = AI_CONTEXT_RE.search(body)
    if not m:
        return ""
    block = m.group(1)
    # 各行頭の "> " を剥がして連結
    text = " ".join(re.sub(r"^>\s?", "", ln).strip() for ln in block.splitlines())
    text = text.strip()
    if not text:
        return ""
    # 句点で 2 文程度に切る
    sentences = re.split(r"(?<=。)", text)
    gist = "".join(sentences[:2]).strip()
    return gist[:200]


def tags_of(fm: dict) -> list[str]:
    t = fm.get("tags", [])
    if isinstance(t, str):
        t = [t] if t else []
    return [str(x).lstrip("#").strip() for x in t if str(x).strip()]


def layer_of(tags: list[str], fm: dict) -> str:
    for lt in LAYER_BY_TAG:
        if lt in tags:
            return lt
    if fm.get("type") == "tool":
        return "tool"
    return "無印"


def build_catalog(vault: Path, scope_dir: str, with_gist: bool) -> dict:
    root = vault / scope_dir
    if not root.is_dir():
        sys.exit(f"scope ディレクトリが無い: {root}")

    nodes: list[dict] = []
    raw_links: dict[str, list[str]] = {}  # title -> [link target titles]
    title_set: set[str] = set()

    for path in sorted(root.rglob("*.md")):
        if path.name == "README.md":
            continue
        title = path.stem
        text = path.read_text(encoding="utf-8", errors="replace")
        fm_text, body = split_frontmatter(text)
        fm = parse_frontmatter(fm_text)
        tags = tags_of(fm)
        node = {
            "title": title,
            "path": str(path.relative_to(vault)),
            "tags": tags,
            "layer": layer_of(tags, fm),
            "progress": fm.get("progress", "") or "",
            "type": fm.get("type", "") or "",
            "usage": fm.get("usage", "") or "",
        }
        if with_gist:
            node["gist"] = extract_gist(body)
        nodes.append(node)
        title_set.add(title)
        # 全文から wikilink（frontmatter の source/category/successor 含む）を拾う
        links = [normalize_link(m) for m in WIKILINK.findall(text)]
        raw_links[title] = links

    # エッジは既存ノードに解決できたものだけ（[[日付]] 等の vault 外参照は落ちる）。自己ループ除外。
    edges: list[list[str]] = []
    seen_edge: set[tuple[str, str]] = set()
    for src, links in raw_links.items():
        for dst in links:
            if dst in title_set and dst != src and (src, dst) not in seen_edge:
                seen_edge.add((src, dst))
                edges.append([src, dst])

    # tag_index: タグ -> そのタグを持つノードのタイトル群（タグ共有＝弱いエッジ）
    tag_index: dict[str, list[str]] = {}
    for n in nodes:
        for t in n["tags"]:
            tag_index.setdefault(t, []).append(n["title"])
    for t in tag_index:
        tag_index[t].sort()

    return {
        "generated_at": datetime.now().strftime("%Y-%m-%dT%H:%M"),
        "vault": str(vault),
        "scope": scope_dir,
        "with_gist": with_gist,
        "counts": {"nodes": len(nodes), "edges": len(edges), "tags": len(tag_index)},
        "nodes": nodes,
        "edges": edges,
        "tag_index": tag_index,
    }


def render_md(cat: dict) -> str:
    """プロンプト注入用のリーン折込 markdown。links・tags を各ノード行に畳み込み、

    タイトルが Notes/Links/Tag groups の 3 箇所で重複する冗長を排す（常時ロードされる
    standing context に載せるため最小化する）。各行は:
        - <title> · <layer> · #tags [· progress=/type=/usage=] · →[outlinks]
    layer は 気づき/洞察/タスク/tool/無印。outlinks は既存ノードに解決できた wikilink。
    タグ共有はこの一覧から agent が自前で束ねる（弱いエッジ）。
    """
    out = []
    c = cat["counts"]
    out.append(f"# Vault Catalog ({cat['scope']}/)")
    out.append(f"generated: {cat['generated_at']} | nodes: {c['nodes']} | edges: {c['edges']} | tags: {c['tags']}")
    out.append(
        "突き合わせ（既出か・関連は何か）の一次索引。`## Notes` は各行 `title · layer · #tags · →[outlinks]`"
        "（outlinks は実 wikilink の解決先）。`## Tag groups` はタグ別のノード群（タグ共有＝弱いエッジ。同タグは関連候補）。"
        "ここで当たりを付け、確証/fold の最終確認だけ Read する。"
    )
    out.append("")
    out.append("## Notes")
    adj: dict[str, list[str]] = {}
    for src, dst in cat["edges"]:
        adj.setdefault(src, []).append(dst)
    for n in cat["nodes"]:
        parts = [n["title"], n["layer"]]
        tags = " ".join(f"#{t}" for t in n["tags"])
        if tags:
            parts.append(tags)
        extra = []
        if n["progress"]:
            extra.append(f"progress={n['progress']}")
        if n["type"]:
            extra.append(f"type={n['type']}")
        if n["usage"]:
            extra.append(f"usage={n['usage']}")
        if extra:
            parts.append(" ".join(extra))
        if n.get("gist"):
            parts.append(n["gist"])
        line = "- " + " · ".join(parts)
        outlinks = adj.get(n["title"])
        if outlinks:
            line += f" · →[{', '.join(outlinks)}]"
        out.append(line)
    # タグ別ノード群（tag→titles の直接 lookup。recall を支える。メンバー 1 件の
    # シングルトンタグは grouping 価値が無い＝弱いエッジを作らないので省く）。
    groups = {t: m for t, m in cat["tag_index"].items() if len(m) >= 2}
    if groups:
        out.append("")
        out.append("## Tag groups (同タグ＝弱いエッジ。メンバー2件以上のみ)")
        for t in sorted(groups):
            members = groups[t]
            out.append(f"- #{t} ({len(members)}): {', '.join(members)}")
    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description="Obsidian vault の機械生成カタログ（ノード索引＋リンクグラフ）")
    ap.add_argument("--vault", required=True, help="vault の絶対パス")
    ap.add_argument("--scope", default="notes", help="走査対象サブディレクトリ（既定: notes）")
    ap.add_argument("--out", default=None, help="出力先（既定: <vault>/.ai-index/vault-catalog.<ext>）")
    ap.add_argument("--format", choices=["json", "md"], default="json", help="出力形式（既定: json）")
    ap.add_argument("--with-gist", action="store_true", help="AI Context callout の先頭を gist に含める（既定 OFF＝最小索引）")
    ap.add_argument("--stdout", action="store_true", help="ファイルに書かず標準出力へ")
    args = ap.parse_args()

    vault = Path(args.vault).expanduser().resolve()
    if not vault.is_dir():
        sys.exit(f"vault が無い: {vault}")

    cat = build_catalog(vault, args.scope, args.with_gist)
    payload = render_md(cat) if args.format == "md" else json.dumps(cat, ensure_ascii=False, indent=1)

    if args.stdout:
        sys.stdout.write(payload if payload.endswith("\n") else payload + "\n")
        return

    ext = "md" if args.format == "md" else "json"
    out = Path(args.out).expanduser() if args.out else vault / ".ai-index" / f"vault-catalog.{ext}"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(payload if payload.endswith("\n") else payload + "\n", encoding="utf-8")
    c = cat["counts"]
    print(f"wrote {out} (nodes={c['nodes']} edges={c['edges']} tags={c['tags']})")


if __name__ == "__main__":
    main()
