#!/usr/bin/env python3
"""vault_indexer.py — Obsidian vault の notes/ をセクション単位で OpenSearch ingest 用 doc 配列に変換する。

Phase 1 スコープ: セクション分割 + doc 構造体生成までを実装し、`--dry-run` で JSON 配列を stdout に出す。
埋め込み HTTP 連携 (`body_vector` は空配列 stub)、OpenSearch bulk ingest、冪等性掃除 (delete by query) は Phase 2+ で別途実装する。

設計の正本は ~/workspace/notes/obsidian/Life/workbench/vault-catalogのElasticsearch化検討/plan.md (B. ETL 節)。
- パーサ層は vault_catalog.py から sys.path 経由で import 再利用（parse_frontmatter / split_frontmatter / tags_of / layer_of / WIKILINK）。
  二重管理を避ける意図（plan A9 / OQ7）。
- セクション分割は基本 H2、H2 本文が 1500 文字を超えたら H3 で適応的に再分割する。
- `## 更新履歴` / `## 関連` は index 対象外（wikilink の倉庫で本文検索には噪音）。
- frontmatter のみで本文ゼロ（H2 を 1 つも持たない）のノートはノート全体を 1 doc として breadcrumb `[title]` で index する
  （ツールノード = `type: tool` を取りこぼさないため）。

依存なし (stdlib のみ)。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# vault_catalog.py のパーサ層を再利用する。同ディレクトリに居る前提で sys.path に自身のディレクトリを足す。
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from vault_catalog import (  # noqa: E402  パッケージ化せず同居 import（plan A9）
    WIKILINK,
    layer_of,
    parse_frontmatter,
    split_frontmatter,
    tags_of,
)

# セクション分割閾値 (plan B 節)。H2 本文がこれを超えたら H3 でさらに分割する。
H2_SPLIT_THRESHOLD = 1500
# index 対象外のセクションタイトル (plan B 節)。H2 / H3 の両方で除外する。
# frontmatter は別経路で扱うのでここには含めない。
EXCLUDED_SECTION_TITLES = {"更新履歴", "関連"}

# H2 / H3 見出し (行頭、行末改行直前まで)
H2_RE = re.compile(r"^##[ \t]+(.+?)[ \t]*$", re.MULTILINE)
H3_RE = re.compile(r"^###[ \t]+(.+?)[ \t]*$", re.MULTILINE)

# 見出し検出前にマスクするノイズ領域 (指摘 #3 対応)。
# - フェンスドコードブロック (``` または ~~~)
# - HTML コメント (<!-- ... -->)
# 引用ブロック (`> ## ...`) は行頭が `> ` のため、見出し正規表現 (`^##`) には元々マッチしない
# (`^##` は行頭の `#` を要求する)。ただし「行頭」は MULTILINE モードでは `\n` 直後も含むので、
# 引用ブロックは正規表現側で自然に除外される。実際に問題になるのはコードブロックと HTML コメント。
_FENCED_CODE_RE = re.compile(r"(?ms)^(```|~~~).*?^\1[ \t]*$")
_HTML_COMMENT_RE = re.compile(r"(?s)<!--.*?-->")

# frontmatter timestamp の慣習キー優先順位 (指摘 #4 対応)。
# 実 vault (~/workspace/notes/obsidian/Life/notes) は createdAt / updatedAt 一択だが、
# 将来の慣習変化や他 vault 互換のために複数キーを順に試す。
_CREATED_KEYS = ("createdAt", "created_at", "created", "date")
_UPDATED_KEYS = ("updatedAt", "updated_at", "updated", "modified", "lastmod")


def doc_id(note_title: str, h2_title: str, occurrence_idx: int, sub_idx: int) -> str:
    """`<note_title>#<h2_title>#<occurrence_idx>#<sub_idx>` の SHA1 (plan B 節 / D2)。

    指摘 #1 #6 対応:
    - H2 単体パスでも常に occurrence_idx / sub_idx を含めることで、本文増加で
      H2 単体 → H3 適応分割パスへ遷移しても id 構造が一定 (sub_idx=0 固定が継続)。
    - 同一ノート内で同じ H2 タイトルが複数回出ても occurrence_idx で区別され衝突しない。
    """
    raw = f"{note_title}#{h2_title}#{occurrence_idx}#{sub_idx}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def fm_get_str(fm: dict, key: str) -> str:
    """frontmatter から scalar を str で取り出す。list/None/欠落は空文字。"""
    v = fm.get(key)
    if v is None:
        return ""
    if isinstance(v, list):
        return ""
    return str(v).strip()


def fm_get_str_first(fm: dict, keys: tuple[str, ...]) -> str:
    """frontmatter から最初に値を持つキーを優先順位付きで取り出す (指摘 #4 対応)。

    list/None/欠落/空文字は次のキーへフォールバック。すべて該当無しなら空文字。
    """
    for k in keys:
        v = fm_get_str(fm, k)
        if v:
            return v
    return ""


def mask_noise_regions(body: str) -> str:
    """H2/H3 見出し検出前にコードブロックと HTML コメントを同じ長さの空白文字列に置換する (指摘 #3 対応)。

    マッチ位置で本文を slice するため、領域の長さを保つ必要がある (改行はそのまま残す)。
    引用ブロックは `^##` 正規表現が `>` を許さないため別途マスク不要。
    """
    def _blank_preserving_newlines(match: re.Match) -> str:
        s = match.group(0)
        # 改行は残し、それ以外を空白 1 文字に置換することで文字長と行構造を保つ
        return "".join("\n" if ch == "\n" else " " for ch in s)

    masked = _FENCED_CODE_RE.sub(_blank_preserving_newlines, body)
    masked = _HTML_COMMENT_RE.sub(_blank_preserving_newlines, masked)
    return masked


def split_h2_sections(body: str) -> list[tuple[str, str]]:
    """本文を H2 で割る。返り値は [(h2_title, h2_body), ...]。

    H2 より前 (frontmatter 直後〜最初の H2 まで) の本文は捨てない: H2 が 0 件なら呼び出し側でノート全体を 1 doc として扱う。
    H2 が 1 件以上ある場合、H2 より前の preamble は最初の H2 セクション本文には含めず捨てる
    (実 vault では preamble は `> [!NOTE] AI Context` callout や空行が主で、index 価値が低いため)。

    指摘 #3 対応: コードブロック / HTML コメント内の `## ` を見出しとして誤検出しないよう、
    検出用に noise 領域をマスクした文字列を作りそれを正規表現に当てる。本文 slice は元の `body` から
    行うため、マスク文字列と `body` は同じ長さを保つ。
    """
    masked = mask_noise_regions(body)
    matches = list(H2_RE.finditer(masked))
    if not matches:
        return []
    sections: list[tuple[str, str]] = []
    for i, m in enumerate(matches):
        title = m.group(1).strip()
        start = m.end()  # 見出し行の直後から (位置は masked == body で一致)
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        section_body = body[start:end]
        # 先頭の改行を 1 つ詰める (見出し直後の改行を素直に剥がす)
        if section_body.startswith("\n"):
            section_body = section_body[1:]
        sections.append((title, section_body))
    return sections


def split_h3_subsections(h2_body: str) -> list[tuple[str, str]]:
    """H2 本文を H3 で割る。返り値は [(h3_title, h3_body), ...]。

    H2 直下〜最初の H3 までの preamble があれば、それも (空タイトル, preamble) として返り値の先頭に入れる。
    こうすると呼び出し側で「H3 適応分割するが preamble は捨てない」挙動になる。

    指摘 #3 対応: コードブロック / HTML コメント内の `### ` を見出しとして誤検出しないよう、
    検出用に noise 領域をマスクする。
    """
    masked = mask_noise_regions(h2_body)
    matches = list(H3_RE.finditer(masked))
    if not matches:
        return [("", h2_body)]
    subsections: list[tuple[str, str]] = []
    # H3 より前の preamble (空でなければ採用)。後段で strip するので末尾整形は不要。
    preamble = h2_body[: matches[0].start()].strip()
    if preamble:
        subsections.append(("", preamble))
    for i, m in enumerate(matches):
        title = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(h2_body)
        sub_body = h2_body[start:end]
        if sub_body.startswith("\n"):
            sub_body = sub_body[1:]
        subsections.append((title, sub_body))
    return subsections


def strip_callout_marker(text: str) -> str:
    """`> ` で始まる callout 行頭マーカーを剥がす (plan B 節)。コードブロックや表はそのまま残す。"""
    out_lines = []
    for ln in text.splitlines():
        if ln.startswith("> "):
            out_lines.append(ln[2:])
        elif ln == ">":
            out_lines.append("")
        else:
            out_lines.append(ln)
    return "\n".join(out_lines)


def collect_outlinks(full_text: str, title_self: str) -> list[str]:
    """ノート全文から wikilink を拾い、親 doc の outlinks として返す。子 section にもそのまま展開して載せる
    (plan B 節 / D2: outlinks は parent doc の wikilink を子 section にも展開)。

    自己ループ除外。重複は順序保存で 1 つに詰める。
    """
    seen: set[str] = set()
    out: list[str] = []
    for m in WIKILINK.findall(full_text):
        link = m.strip()
        if not link or link == title_self or link in seen:
            continue
        seen.add(link)
        out.append(link)
    return out


@dataclass(frozen=True)
class NoteMeta:
    # frozen=True はループ内での誤代入を型レベルで弾くため (同じインスタンスを複数 doc に回す前提)。
    note_title: str
    tags: list[str]
    layer: str
    progress: str
    type_: str
    usage: str
    outlinks: list[str]
    path: str
    created_at: str
    updated_at: str


def build_docs(vault: Path, scope_dir: str) -> list[dict]:
    """vault/<scope_dir> 配下の Markdown を再帰的に走査し、doc 構造体配列を返す。"""
    root = vault / scope_dir
    if not root.is_dir():
        sys.exit(f"scope ディレクトリが無い: {root}")

    docs: list[dict] = []
    for path in sorted(root.rglob("*.md")):
        if path.name == "README.md":
            continue
        note_title = path.stem
        text = path.read_text(encoding="utf-8", errors="replace")
        fm_text, body = split_frontmatter(text)
        fm = parse_frontmatter(fm_text)
        tags = tags_of(fm)
        layer = layer_of(tags, fm)
        progress = fm_get_str(fm, "progress")
        type_ = fm_get_str(fm, "type")
        usage = fm_get_str(fm, "usage")
        # 指摘 #4 対応: 慣習キーの優先順位リストから最初に値を持つキーを採用する。
        created_at = fm_get_str_first(fm, _CREATED_KEYS)
        updated_at = fm_get_str_first(fm, _UPDATED_KEYS)
        rel_path = str(path.relative_to(vault))
        outlinks = collect_outlinks(text, note_title)

        meta = NoteMeta(
            note_title=note_title,
            tags=tags,
            layer=layer,
            progress=progress,
            type_=type_,
            usage=usage,
            outlinks=outlinks,
            path=rel_path,
            created_at=created_at,
            updated_at=updated_at,
        )

        h2_sections = split_h2_sections(body)
        # 指摘 #2 対応: 除外セクションタイトルは H2 で取り除く (H3 側はループ内で同じ集合を適用)。
        h2_sections_kept = [(t, b) for (t, b) in h2_sections if t not in EXCLUDED_SECTION_TITLES]

        if not h2_sections_kept:
            # frontmatter のみで本文ゼロ、または除外後に H2 が残らないノート: ノート全体を 1 doc にする
            # breadcrumb は [title]、section_title は空、section_index は 0
            # 指摘 #1 #6 対応: occurrence_idx=0, sub_idx=0 固定で安定 id を作る (note 単体パスの正準形)。
            doc_body = strip_callout_marker(body).strip()
            docs.append(_build_doc(
                meta,
                section_title="",
                h2_title_for_id="",
                occurrence_idx=0,
                sub_idx=0,
                breadcrumb=[note_title],
                section_index=0,
                body_text=doc_body,
            ))
            continue

        # 指摘 #6 対応: 同名 H2 を区別するため、ノート内の (除外前を含む) H2 出現順を occurrence_idx として保持する。
        # 除外セクション (更新履歴 / 関連) も「出現順を消費」するように、除外前の h2_sections を基準にカウントする。
        # これにより、除外セクションを後から追加・削除しても残る H2 の occurrence_idx は変わらず安定する。
        h2_occurrence: dict[str, int] = {}
        h2_with_idx: list[tuple[str, str, int]] = []
        for t, b in h2_sections:
            idx = h2_occurrence.get(t, 0)
            h2_with_idx.append((t, b, idx))
            h2_occurrence[t] = idx + 1
        # 除外を適用 (occurrence_idx は採番済みなので除外しても番号は飛ぶだけで衝突は起こさない)
        h2_kept_with_idx = [(t, b, occ) for (t, b, occ) in h2_with_idx if t not in EXCLUDED_SECTION_TITLES]

        # H2 セクション単位で doc 化。長すぎる H2 は H3 でさらに分割する。
        section_index = 0
        for h2_title, h2_body, occurrence_idx in h2_kept_with_idx:
            stripped_h2_body = strip_callout_marker(h2_body).strip()
            if len(stripped_h2_body) <= H2_SPLIT_THRESHOLD:
                # H2 単位で 1 doc。指摘 #1 対応: H2 単体パスでも sub_idx=0 で id を採番し、
                # 本文が閾値を超えて H3 分割パスに遷移しても sub_idx=0 の id 構造を維持する。
                docs.append(_build_doc(
                    meta,
                    section_title=h2_title,
                    h2_title_for_id=h2_title,
                    occurrence_idx=occurrence_idx,
                    sub_idx=0,
                    breadcrumb=[note_title, h2_title],
                    section_index=section_index,
                    body_text=stripped_h2_body,
                ))
                section_index += 1
            else:
                # 適応的 H3 分割。doc id は親 H2 ベース + occurrence_idx + sub_idx (冪等再投入のため)。
                # 指摘 #2 対応: H3 タイトルが除外対象 (関連 / 更新履歴) なら飛ばす。
                subsections = split_h3_subsections(h2_body)
                for sub_idx, (h3_title, sub_body) in enumerate(subsections):
                    if h3_title in EXCLUDED_SECTION_TITLES:
                        continue
                    stripped_sub = strip_callout_marker(sub_body).strip()
                    if not stripped_sub:
                        continue
                    breadcrumb = [note_title, h2_title]
                    section_title = h2_title
                    if h3_title:
                        breadcrumb.append(h3_title)
                        section_title = h3_title
                    docs.append(_build_doc(
                        meta,
                        section_title=section_title,
                        h2_title_for_id=h2_title,
                        occurrence_idx=occurrence_idx,
                        sub_idx=sub_idx,
                        breadcrumb=breadcrumb,
                        section_index=section_index,
                        body_text=stripped_sub,
                    ))
                    section_index += 1
    return docs


def _build_doc(
    meta: NoteMeta,
    *,
    section_title: str,
    h2_title_for_id: str,
    occurrence_idx: int,
    sub_idx: int,
    breadcrumb: list[str],
    section_index: int,
    body_text: str,
) -> dict:
    return {
        "id": doc_id(meta.note_title, h2_title_for_id, occurrence_idx, sub_idx),
        "note_title": meta.note_title,
        "section_title": section_title,
        "breadcrumb": " > ".join(breadcrumb),
        "tags": meta.tags,
        "layer": meta.layer,
        "progress": meta.progress,
        "type": meta.type_,
        "usage": meta.usage,
        "outlinks": meta.outlinks,
        "path": meta.path,
        "section_index": section_index,
        "body": body_text,
        "body_vector": [],  # stub (埋め込み生成は別経路で後追加)
        "created_at": meta.created_at,
        "updated_at": meta.updated_at,
    }


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Obsidian vault notes/ をセクション単位で OpenSearch 用 doc 配列に変換する (Phase 1 / dry-run)",
    )
    ap.add_argument("--vault", required=True, help="vault の絶対パス")
    ap.add_argument("--scope", default="notes", help="走査対象サブディレクトリ (既定: notes)")
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="JSON 配列を stdout に出す (Phase 1 はこれが唯一の出力モード)",
    )
    args = ap.parse_args()

    vault = Path(args.vault).expanduser().resolve()
    if not vault.is_dir():
        sys.exit(f"vault が無い: {vault}")

    docs = build_docs(vault, args.scope)

    if args.dry_run:
        json.dump(docs, sys.stdout, ensure_ascii=False, indent=1)
        sys.stdout.write("\n")
        return

    # Phase 1 では dry-run のみが対応。OpenSearch ingest 経路は Phase 2+ で実装する。
    sys.exit(
        "Phase 1 は --dry-run 専用です。OpenSearch ingest / 埋め込み HTTP 連携 / 冪等性掃除は Phase 2+ で実装します。",
    )


if __name__ == "__main__":
    main()
