#!/usr/bin/env python3
"""vault_indexer.py — Obsidian vault の notes/ をセクション単位で OpenSearch ingest 用 doc 配列に変換する。

- パーサ層は vault_catalog.py から sys.path 経由で import 再利用（parse_frontmatter / split_frontmatter / tags_of / layer_of / WIKILINK）。
  二重管理を避ける意図。
- セクション分割は基本 H2、H2 本文が 1500 文字を超えたら H3 で適応的に再分割する。
- `## 更新履歴` / `## 関連` は index 対象外（wikilink の倉庫で本文検索には噪音）。
- frontmatter のみで本文ゼロ（H2 を 1 つも持たない）のノートはノート全体を 1 doc として breadcrumb `[title]` で index する
  （ツールノード = `type: tool` を取りこぼさないため）。

依存なし (stdlib のみ。HTTP は urllib.request)。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
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

# frontmatter timestamp の慣習キー優先順位。
# 実 vault (~/workspace/notes/obsidian/Life/notes) は createdAt / updatedAt 一択だが、
# 将来の慣習変化や他 vault 互換のために複数キーを順に試す。
_CREATED_KEYS = ("createdAt", "created_at", "created", "date")
_UPDATED_KEYS = ("updatedAt", "updated_at", "updated", "modified", "lastmod")

# compose stack 内 docker network の hostname を前提。
DEFAULT_EMBED_URL = "http://embed:8080/embed"
DEFAULT_OPENSEARCH_URL = "http://opensearch:9200"
DEFAULT_INDEX = "vault-notes"
DEFAULT_STATE_INDEX = "vault-notes-state"
STATE_DOC_ID = "runstate"

# 埋め込みベクトル次元 (multilingual-e5-base 既定)。mapping と一致させる。
EMBED_DIM = 768

# _bulk 1 リクエストあたりの doc 数 (OpenSearch 推奨範囲)。
BULK_CHUNK_SIZE = 500

# HTTP timeout (秒)。embed は CPU 推論で長めに、OpenSearch は短めに。
HTTP_TIMEOUT_EMBED = 30
HTTP_TIMEOUT_OPENSEARCH = 60

# fetch_existing_ids_and_hashes が PIT path へ降格する OpenSearch 400 のキーワード。
_PIT_DOWNGRADE_KEYWORDS = (
    "illegal_argument_exception",
    "result window",
    "max_result_window",
)

# auto-create で float[] に落ちた既存 index を踏み続けないよう、_bulk 投入前に冪等 PUT する。
INDEX_MAPPING = {
    "settings": {
        "index": {
            "knn": True,
            "analysis": {
                "tokenizer": {
                    # 複合語を search mode で分解する。default (normal) では
                    # 「ホームラボ」が 1 トークンに固まり「ホーム ラボ」と検索結果が極端に非対称になる
                    # (実測: hit=0 vs hit=223)。search mode は元語と分割語を両方残すので表記揺れに耐える。
                    "kuromoji_search_tokenizer": {
                        "type": "kuromoji_tokenizer",
                        "mode": "search",
                    },
                },
                "analyzer": {
                    "kuromoji_analyzer": {
                        "type": "custom",
                        "tokenizer": "kuromoji_search_tokenizer",
                    },
                },
            },
        },
    },
    "mappings": {
        "properties": {
            "note_title": {"type": "text", "analyzer": "kuromoji_analyzer"},
            "section_title": {"type": "text", "analyzer": "kuromoji_analyzer"},
            "breadcrumb": {"type": "text", "analyzer": "kuromoji_analyzer"},
            "body": {"type": "text", "analyzer": "kuromoji_analyzer"},
            "body_vector": {
                "type": "knn_vector",
                "dimension": EMBED_DIM,
                "method": {
                    "name": "hnsw",
                    "engine": "faiss",
                    "space_type": "cosinesimil",
                },
            },
            "tags": {"type": "keyword"},
            "layer": {"type": "keyword"},
            "progress": {"type": "keyword"},
            "type": {"type": "keyword"},
            "usage": {"type": "keyword"},
            "outlinks": {"type": "keyword"},
            "path": {"type": "keyword"},
            "section_index": {"type": "integer"},
            "content_hash": {"type": "keyword"},
            # 空文字を渡しても mapper_parsing_exception で reject されない防御。
            # 呼び出し側 (build_docs) で空文字 → None 変換も入れるが、updated_at も対称的に守る
            # (将来同様事故を予防)。ignore_malformed は本 2 field 限定で、新 date field 追加時は明示的に opt-in。
            "created_at": {"type": "date", "ignore_malformed": True},
            "updated_at": {"type": "date", "ignore_malformed": True},
        },
    },
}

INDEX_MAPPING_BYTES = json.dumps(INDEX_MAPPING).encode("utf-8")


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
    """frontmatter から最初に値を持つキーを優先順位付きで取り出す。

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
    # frontmatter 不在時は None。空文字を渡すと OpenSearch date field が
    # mapper_parsing_exception で reject するため (上流 build_docs で `or None` 変換済み)、
    # 型注釈も str | None に揃える。
    created_at: str | None
    updated_at: str | None
    # content_hash 入力用に正規化したコピー。per-note 1 回計算で全 section doc に使い回し、
    # compute_content_hash の per-doc sorted() コールを削減。
    sorted_tags: list[str] = field(init=False, compare=False, repr=False)
    sorted_outlinks: list[str] = field(init=False, compare=False, repr=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "sorted_tags", sorted(self.tags))
        object.__setattr__(self, "sorted_outlinks", sorted(self.outlinks))


def walk_vault(vault: Path, scope_dir: str, *, mtime_after: float | None = None) -> list[Path]:
    """vault/<scope_dir> 配下を再帰走査し、Markdown 候補パスを返す。

    `mtime_after` が None なら全件、float (Unix epoch sec) なら mtime 比較で incremental walk。
    比較は `>=` で同秒 race を緩める。false positive は content_hash 差分で skip される。
    """
    root = vault / scope_dir
    if not root.is_dir():
        sys.exit(f"scope ディレクトリが無い: {root}")
    paths: list[Path] = []
    for path in sorted(root.rglob("*.md")):
        if path.name == "README.md":
            continue
        if mtime_after is not None:
            try:
                mtime = path.stat().st_mtime
            except OSError:
                # stat 失敗時は安全側に倒し、walk 対象から除外する (rsync 中で race した場合等)。
                continue
            if mtime < mtime_after:
                continue
        paths.append(path)
    return paths


def build_docs(vault: Path, scope_dir: str, *, paths: list[Path] | None = None) -> list[dict]:
    """vault/<scope_dir> 配下の Markdown を再帰的に走査し、doc 構造体配列を返す。

    `paths` が None なら walk_vault で全件取得 (既存挙動)。incremental ingest 等で事前に
    対象ファイルを絞り込んだ場合は `paths` を渡す。
    """
    if paths is None:
        paths = walk_vault(vault, scope_dir)

    docs: list[dict] = []
    for path in paths:
        note_title = path.stem
        text = path.read_text(encoding="utf-8", errors="replace")
        fm_text, body = split_frontmatter(text)
        fm = parse_frontmatter(fm_text)
        tags = tags_of(fm)
        layer = layer_of(tags, fm)
        progress = fm_get_str(fm, "progress")
        type_ = fm_get_str(fm, "type")
        usage = fm_get_str(fm, "usage")
        created_at = fm_get_str_first(fm, _CREATED_KEYS)
        updated_at = fm_get_str_first(fm, _UPDATED_KEYS)
        # 空文字を OpenSearch date field に渡すと mapper_parsing_exception で
        # _bulk レスポンス内で per-item reject される (vault notes/ 666 件中約 23% に createdAt frontmatter が無く永続的に
        # index 化漏れ + stderr `_bulk errors at chunk_start=...` ログは先頭 5 件しか dump しないので
        # silent loss を起こしていた)。fm_get_str_first 自体には触らず (汎用 helper 戻り型を維持)、
        # 呼び出し側で null 化して JSON シリアライズ時に `null` を流す。INDEX_MAPPING 側の
        # ignore_malformed と二重に守る (mapping は将来 None 以外の malformed 値が混入したとき用)。
        created_at = created_at or None
        updated_at = updated_at or None
        # Windows で backslash になると Linux 側 indexer の existing path (forward slash) と一致しなくなり、
        # 全 walked path が mtime_skipped_ids に紛れ込む。as_posix() で forward slash 強制。
        rel_path = path.relative_to(vault).as_posix()
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


def compute_content_hash(
    *,
    body: str,
    breadcrumb: str,
    tags: list[str],
    layer: str,
    outlinks: list[str],
) -> str:
    """doc 同一性判定の content_hash。

    範囲は body + breadcrumb + tags + layer + outlinks のみ。created_at / updated_at / path /
    section_index は検索影響が薄いので hash 対象外。frontmatter 全部を含めると updatedAt 変化だけで
    全件 re-embed が走るのでこれも除外。

    CAVEAT: hash 範囲を変更するときは全件 re-hash (= 全件 re-index) が必要になる。
    将来 snippet 範囲 / summary field を追加して検索面に乗せるなら、その field も hash 範囲に含めること。

    tags / outlinks は順序を持たない概念なので caller が sorted 済みを渡す契約 (NoteMeta.sorted_tags
    / sorted_outlinks)。frontmatter YAML 順序変更だけで hash 変化を起こさない。breadcrumb は
    順序を持つパンくずなのでそのまま。決定論的 serialize: json.dumps(payload, sort_keys=True,
    ensure_ascii=False) → SHA256 hex。

    SEMANTIC DRIFT NOTE (tags 順序の取り扱い): tags / outlinks の正規化は content_hash 計算側のみで実施し、
    `_build_doc` 戻り dict の `tags` field は `meta.tags` (YAML 順序) のスナップショットとして保持する。
    そのため tags の並び替えだけの編集 (内容は同集合) は content_hash 不変で docs_to_index から除外され、
    OpenSearch 上の `tags` field 順序は古いまま残る。tags は無順序 set として扱う前提なのでこの drift は
    検索面に影響しないが、tags の表示順序や first-tag-as-primary 等の semantic を後から導入する場合は
    別途 hash 範囲の見直しが必要になる。
    """
    payload = {
        "body": body,
        "breadcrumb": breadcrumb,
        "tags": tags,
        "layer": layer,
        "outlinks": outlinks,
    }
    serialized = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(serialized).hexdigest()


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
    breadcrumb_str = " > ".join(breadcrumb)
    return {
        "id": doc_id(meta.note_title, h2_title_for_id, occurrence_idx, sub_idx),
        "note_title": meta.note_title,
        "section_title": section_title,
        "breadcrumb": breadcrumb_str,
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
        "content_hash": compute_content_hash(
            body=body_text,
            breadcrumb=breadcrumb_str,
            tags=meta.sorted_tags,
            layer=meta.layer,
            outlinks=meta.sorted_outlinks,
        ),
        "created_at": meta.created_at,
        "updated_at": meta.updated_at,
    }


# ---------------------------------------------------------------------------
# B-2: /embed HTTP client
# ---------------------------------------------------------------------------


def fetch_embedding(text: str, *, embed_url: str) -> list[float]:
    # 1 doc 失敗で全体 abort: 部分 ingest で _count を不確定にしない。
    req_body = json.dumps({"text": text}).encode("utf-8")
    req = urllib.request.Request(
        embed_url,
        data=req_body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_EMBED) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    vector = payload.get("vector")
    if not isinstance(vector, list):
        raise RuntimeError(
            f"embed endpoint が vector 配列を返さなかった (url={embed_url}): {payload!r}",
        )
    if len(vector) != EMBED_DIM:
        raise RuntimeError(
            f"embed 次元が期待値と異なる: expected={EMBED_DIM} got={len(vector)} (url={embed_url})",
        )
    return [float(x) for x in vector]


def embed_all(docs: list[dict], *, embed_url: str) -> None:
    for i, doc in enumerate(docs):
        if doc.get("body_vector"):
            # caller の retry で再度 embed_all が回るケースで二重 HTTP を避ける
            continue
        body_text = doc.get("body", "")
        try:
            doc["body_vector"] = fetch_embedding(body_text, embed_url=embed_url)
        except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
            raise RuntimeError(
                f"embed 失敗 (doc index={i}, id={doc.get('id')!r}, note={doc.get('note_title')!r}): {exc}",
            ) from exc


# ---------------------------------------------------------------------------
# OpenSearch index 冪等 create + _bulk ingest + 集合差分 stale 削除
# ---------------------------------------------------------------------------


def _opensearch_request(
    method: str,
    url: str,
    *,
    body: bytes | None = None,
    content_type: str = "application/json",
    allowed_status: tuple[int, ...] = (200, 201),
) -> tuple[int, dict]:
    # HEAD 等で body 空のレスポンスは {} を返す (呼び出し側は dict 前提)。
    req = urllib.request.Request(url, data=body, method=method, headers={"Content-Type": content_type})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_OPENSEARCH) as resp:
            status = resp.status
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read()
        # HTTPError は file-like なので明示 close (urllib のレスポンス resource leak 回避)。
        exc.close()
        if status not in allowed_status:
            raise RuntimeError(
                f"OpenSearch {method} {url} failed: status={status} body={raw.decode('utf-8', errors='replace')!r}",
            ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"OpenSearch {method} {url} network failure: {exc}",
        ) from exc
    if not raw:
        return status, {}
    try:
        return status, json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        # silent fallback だが warning を残して気付けるようにする。
        sys.stderr.write(
            f"OpenSearch {method} {url} returned non-JSON: status={status} body={raw[:200]!r}\n",
        )
        return status, {}


def _index_exists(base: str, name: str) -> bool:
    status, _ = _opensearch_request("HEAD", f"{base}/{name}", allowed_status=(200, 404))
    return status != 404


def ensure_index(opensearch_url: str, index: str) -> None:
    # auto-create で float[] に落ちた既存 index を黙って踏み続けないよう、既存も厳密検証する。
    base = opensearch_url.rstrip("/")
    if not _index_exists(base, index):
        _opensearch_request("PUT", f"{base}/{index}", body=INDEX_MAPPING_BYTES)
        return

    get_status, mapping = _opensearch_request(
        "GET", f"{base}/{index}/_mapping", allowed_status=(200, 404),
    )
    if get_status == 404:
        # HEAD で existing 判定後に GET で 404 = 中間で外部 actor が DELETE した race。再実行で解決可能。
        raise RuntimeError(
            f"ensure_index: HEAD で existing 判定後、GET /{index}/_mapping で 404。"
            f"HEAD と GET の間に外部 actor が DELETE した可能性。再実行してください。",
        )
    try:
        bv = mapping[index]["mappings"]["properties"]["body_vector"]
    except (KeyError, TypeError) as exc:
        raise RuntimeError(
            f"既存 index `{index}` の mapping に body_vector が無い。`DELETE /{index}` で消してから再 ingest してください: {mapping!r}",
        ) from exc

    method_raw = bv.get("method")
    # OpenSearch contract 外で method が non-dict truthy (str/int 等) で返った場合の AttributeError を防ぐ。
    method = method_raw if isinstance(method_raw, dict) else {}
    actual = (
        bv.get("type"),
        bv.get("dimension"),
        method.get("engine"),
        method.get("space_type"),
    )
    expected = ("knn_vector", EMBED_DIM, "faiss", "cosinesimil")
    if actual != expected:
        raise RuntimeError(
            f"既存 index `{index}` の body_vector mapping が想定と乖離: "
            f"actual={actual} expected={expected}. "
            f"`DELETE /{index}` で消してから再 ingest してください。",
        )


def bulk_ingest(
    docs: list[dict],
    *,
    opensearch_url: str,
    index: str,
    chunk_size: int = BULK_CHUNK_SIZE,
) -> set[str]:
    """_bulk index で docs を投入し、成功した doc の id 集合を返す。

    `errors=true` は個別 doc 失敗 (mapping conflict 等) なので全体 abort しない。失敗 id は
    成功集合から外して返し、caller (run_ingest) 側で current_ids から除外する。
    HTTP error / network failure (urllib level) は _opensearch_request が raise するので
    本関数からも raise されて全体 abort。
    """
    base = opensearch_url.rstrip("/")
    bulk_url = f"{base}/_bulk"
    success_ids: set[str] = set()

    for chunk_start in range(0, len(docs), chunk_size):
        chunk = docs[chunk_start:chunk_start + chunk_size]
        chunk_ids = [doc["id"] for doc in chunk]
        lines: list[str] = []
        for doc in chunk:
            action = {"index": {"_index": index, "_id": doc["id"]}}
            lines.append(json.dumps(action, ensure_ascii=False))
            lines.append(json.dumps(doc, ensure_ascii=False))
        body = ("\n".join(lines) + "\n").encode("utf-8")
        _, resp = _opensearch_request(
            "POST",
            bulk_url,
            body=body,
            content_type="application/x-ndjson",
        )
        items = resp.get("items") or []
        # items が空 (古い OpenSearch contract 等) の場合は errors フラグの有無に関わらず
        # chunk_ids 全部を成功扱いにする (errors=true なら本来ここには来ないが防御的に)。
        if not items:
            success_ids.update(chunk_ids)
            continue
        # errors=true / false で同じ走査をする (failed と success の振り分けは op.error の有無で決まる)。
        err_items: list[dict] = []
        for idx, item in enumerate(items):
            if not item:
                # OpenSearch contract 上は items 各要素が dict のはずだが、防御的に skip。
                if idx < len(chunk_ids):
                    success_ids.add(chunk_ids[idx])
                continue
            op = next(iter(item.values()))
            op_id = op.get("_id") or (chunk_ids[idx] if idx < len(chunk_ids) else None)
            if op.get("error"):
                err_items.append({
                    "_id": op_id,
                    "status": op.get("status"),
                    "error": op.get("error"),
                })
            elif op_id is not None:
                success_ids.add(op_id)
        if err_items:
            sys.stderr.write(
                f"_bulk errors at chunk_start={chunk_start}: {len(err_items)} item(s):\n"
                + json.dumps(err_items[:5], ensure_ascii=False, indent=2)
                + "\n",
            )
    return success_ids


def _collect_existing_hits(hits: list[dict], result: dict[str, dict]) -> None:
    for h in hits:
        _id = h.get("_id")
        if not _id:
            continue
        src = h.get("_source") or {}
        result[_id] = {
            "content_hash": src.get("content_hash") or "",
            "path": src.get("path") or "",
        }


def _extract_hits(resp: dict) -> list[dict]:
    """_search レスポンスの hits リストを抜き出す。"""
    return (resp.get("hits") or {}).get("hits") or []


def fetch_existing_ids_and_hashes(opensearch_url: str, index: str) -> dict[str, dict]:
    """index 内の全 doc の {_id: {"content_hash", "path"}} を返す。

    path も返すのは、walked ファイル内のセクション削除を「walk しなかった id」と区別するため
    (walked ファイルの ghost section は stale 対象、walk しなかったファイルの id は current 残し)。
    第一選択: `_search size:10000` で 1 リクエスト全件取得。
    fallback: hit total が 10000 以上 or max_result_window 制限で 400 が返ったとき PIT + search_after。
    index 不在時は空 dict を返す (初回 run・state 不在と同じ扱い)。
    """
    base = opensearch_url.rstrip("/")
    if not _index_exists(base, index):
        return {}

    body = json.dumps({
        "size": 10000,
        "_source": ["content_hash", "path"],
    }).encode("utf-8")
    try:
        _, resp = _opensearch_request("POST", f"{base}/{index}/_search", body=body)
    except RuntimeError as exc:
        # index.max_result_window を下げた環境で 400 が返ったら PIT path に降格する。
        # OpenSearch のエラー本文は環境により大文字小文字が揺れる (例: "Result window is too large") ため、
        # 小文字に正規化してから比較する。
        msg_lower = str(exc).lower()
        if "status=400" in msg_lower and any(k in msg_lower for k in _PIT_DOWNGRADE_KEYWORDS):
            return _fetch_via_pit(base, index=index)
        raise

    hits = _extract_hits(resp)
    # size:10000 で 10000 件返ったら total が 10000 以上の必要十分条件 (それ以下なら全件)。
    # PIT path は先頭から再 fetch するため、流用最適化はせず contract をシンプルに保つ。
    if len(hits) >= 10000:
        return _fetch_via_pit(base, index=index)

    result: dict[str, dict] = {}
    _collect_existing_hits(hits, result)
    return result


def _fetch_via_pit(base: str, *, index: str) -> dict[str, dict]:
    """PIT + search_after で全 doc の {_id: {"content_hash", "path"}} を取得する。

    `_doc` を sort tiebreaker に使う (`_id` は fielddata デフォルト無効で使えない。`_doc` は PIT
    context で stable sort の標準)。
    `index` は PIT 作成 URL (`POST /<index>/_search/point_in_time`) でのみ使う。PIT 作成後は
    pit_id が target index の context を保持するため、`_search` と DELETE は `{base}/_search...` の
    形 (index 含まない) で叩く。
    """
    pit_url = f"{base}/{index}/_search/point_in_time?keep_alive=5m"
    _, pit_resp = _opensearch_request("POST", pit_url)
    pit_id = pit_resp.get("pit_id")
    if not pit_id:
        raise RuntimeError(f"PIT 作成に失敗: {pit_resp!r}")
    result: dict[str, dict] = {}
    search_after: list | None = None
    try:
        while True:
            body_dict: dict = {
                "size": 1000,
                "sort": [{"_doc": "asc"}],
                "pit": {"id": pit_id, "keep_alive": "5m"},
                "_source": ["content_hash", "path"],
            }
            if search_after is not None:
                body_dict["search_after"] = search_after
            body = json.dumps(body_dict).encode("utf-8")
            _, resp = _opensearch_request("POST", f"{base}/_search", body=body)
            hits = _extract_hits(resp)
            if not hits:
                break
            _collect_existing_hits(hits, result)
            last = hits[-1]
            sort_val = last.get("sort")
            new_pit = resp.get("pit_id")
            if new_pit:
                pit_id = new_pit
            if not sort_val:
                break
            search_after = sort_val
    finally:
        # PIT を片付ける (失敗しても無視: keep_alive で自然 expire する)。
        try:
            close_body = json.dumps({"pit_id": pit_id}).encode("utf-8")
            _opensearch_request(
                "DELETE", f"{base}/_search/point_in_time",
                body=close_body, allowed_status=(200, 404),
            )
        except RuntimeError:
            pass
    return result


def bulk_delete(ids: set[str] | list[str], *, opensearch_url: str, index: str, chunk_size: int = BULK_CHUNK_SIZE) -> int:
    """指定 id 集合を `_bulk delete` で個別削除する。削除成功件数を返す。

    失敗 op (5xx / version_conflict 等) は bulk_ingest と対称な形で stderr に最大 5 件出して
    silent failure を防ぐ。
    """
    base = opensearch_url.rstrip("/")
    bulk_url = f"{base}/_bulk"
    # sorted で chunk 順序を決定論化する。PYTHONHASHSEED 依存の set 順序だと chunk_start 単位の
    # error log と error sample が run ごとに異なり再現性が落ちる。
    id_list = sorted(ids)
    deleted = 0
    for chunk_start in range(0, len(id_list), chunk_size):
        chunk = id_list[chunk_start:chunk_start + chunk_size]
        lines: list[str] = []
        for _id in chunk:
            action = {"delete": {"_index": index, "_id": _id}}
            lines.append(json.dumps(action, ensure_ascii=False))
        body = ("\n".join(lines) + "\n").encode("utf-8")
        _, resp = _opensearch_request(
            "POST",
            bulk_url,
            body=body,
            content_type="application/x-ndjson",
        )
        items = resp.get("items") or []
        err_items: list[dict] = []
        for item in items:
            if not item:
                continue
            op = next(iter(item.values()))
            # status 200/201 (削除成功) or 404 (元から存在しない: idempotent 削除として成功扱い)
            status = op.get("status")
            if status in (200, 201, 404):
                deleted += 1
            else:
                err_items.append({
                    "_id": op.get("_id"),
                    "status": status,
                    "error": op.get("error"),
                })
        if err_items:
            sys.stderr.write(
                f"_bulk delete errors at chunk_start={chunk_start}: {len(err_items)} item(s):\n"
                + json.dumps(err_items[:5], ensure_ascii=False, indent=2)
                + "\n",
            )
    return deleted


def read_state(opensearch_url: str, state_index: str) -> str | None:
    """state index から `last_run_iso` を取り出す。

    state index 不在 or doc 不在 (初回 run) なら None を返す。
    """
    base = opensearch_url.rstrip("/")
    if not _index_exists(base, state_index):
        return None
    get_status, resp = _opensearch_request(
        "GET",
        f"{base}/{state_index}/_doc/{STATE_DOC_ID}",
        allowed_status=(200, 404),
    )
    if get_status == 404:
        return None
    source = resp.get("_source") or {}
    last_run = source.get("last_run_iso")
    if isinstance(last_run, str) and last_run:
        return last_run
    return None


def ensure_state_index(opensearch_url: str, state_index: str) -> None:
    """state index を冪等に作成する。

    mapping は dynamic に任せる (string 比較のみで使うため。range 検索の需要が出たら明示 mapping)。
    """
    base = opensearch_url.rstrip("/")
    if not _index_exists(base, state_index):
        _opensearch_request("PUT", f"{base}/{state_index}", body=b"{}")


def write_state(opensearch_url: str, state_index: str, last_run_iso: str, last_run_count: int) -> None:
    """state index に `last_run_iso` / `last_run_count` を upsert する。"""
    base = opensearch_url.rstrip("/")
    body = json.dumps({
        "last_run_iso": last_run_iso,
        "last_run_count": last_run_count,
    }).encode("utf-8")
    _opensearch_request(
        "PUT",
        f"{base}/{state_index}/_doc/{STATE_DOC_ID}",
        body=body,
    )


def _parse_iso_to_epoch(iso: str) -> float | None:
    """ISO 8601 文字列を Unix epoch (float sec) に変換。失敗時 None。"""
    try:
        # 末尾 Z は 3.11+ で fromisoformat が受け付けるが、念のため +00:00 へ正規化。
        normalized = iso.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except (ValueError, TypeError):
        return None


def _resolve_mtime_after(
    opensearch_url: str, state_index: str, *, full: bool,
) -> tuple[str | None, float | None]:
    """state index から last_run_iso を取り出し incremental walk の cutoff epoch に変換する。

    last_run_iso が non-empty なのに parse 不能で full walk に silently 降格する経路は
    operator が観測できるよう stderr に WARNING を出す。
    """
    if full:
        return None, None
    last_run_iso = read_state(opensearch_url, state_index)
    mtime_after = _parse_iso_to_epoch(last_run_iso) if last_run_iso else None
    if last_run_iso and mtime_after is None:
        sys.stderr.write(
            f"WARNING: state index の last_run_iso が parse 不能 ({last_run_iso!r})、"
            f"full walk に降格する\n",
        )
    return last_run_iso, mtime_after


def _compute_current_ids(
    docs: list[dict],
    candidate_paths: list[Path],
    existing: dict[str, dict],
    vault: Path,
    *,
    mtime_after: float | None,
) -> tuple[set[str], set[str]]:
    """walk しなかったファイルの doc を stale 削除から守りつつ ghost section は stale に倒す。

    incremental walk で対象外だった既存 id (walk しなかったファイルの doc) は current に残す。
    一方 walked ファイル内のセクション削除 (path が walked_paths に居る既存 id) は ghost なので
    current から外して stale に倒す (F2 fix)。path 空の legacy doc は保守側で current に残す。
    全件 walk (初回 or --full) では walk しなかった existing は vault から消えたファイル扱いで stale。
    walked_ids は summary log にも使うので併せて返す。Windows backslash で existing path
    (forward slash) と一致しなくなる事故を避けるため walked_paths は as_posix() で統一。
    """
    walked_ids = {d["id"] for d in docs}
    walked_paths = {p.relative_to(vault).as_posix() for p in candidate_paths}
    if mtime_after is None:
        return walked_ids, walked_ids
    mtime_skipped_ids = {
        _id for _id, meta in existing.items()
        if _id not in walked_ids
        and (not meta.get("path") or meta["path"] not in walked_paths)
    }
    return walked_ids | mtime_skipped_ids, walked_ids


def run_ingest(
    vault: Path,
    scope: str,
    *,
    embed_url: str,
    opensearch_url: str,
    index: str,
    state_index: str = DEFAULT_STATE_INDEX,
    full: bool = False,
) -> None:
    """incremental + content_hash + 集合差分 stale 削除の本体。

    Why not try/finally: Ctrl-C 途中で write_state を実行する経路を作らないため。途中状態の
    last_run_iso を残すと次回 run で skip が発生する。
    """
    run_start_iso = datetime.now(timezone.utc).isoformat()
    ensure_index(opensearch_url, index)
    ensure_state_index(opensearch_url, state_index)

    last_run_iso, mtime_after = _resolve_mtime_after(opensearch_url, state_index, full=full)
    candidate_paths = walk_vault(vault, scope, mtime_after=mtime_after)
    docs = build_docs(vault, scope, paths=candidate_paths)

    existing = fetch_existing_ids_and_hashes(opensearch_url, index)

    # content_hash 差分で再 index 対象を抽出。同 loop で旧 schema doc (content_hash 不在) も
    # migration 経路として観測可能にする (F10)。
    docs_to_index: list[dict] = []
    migration_count = 0
    for d in docs:
        existing_meta = existing.get(d["id"])
        if existing_meta is None or existing_meta.get("content_hash") != d["content_hash"]:
            docs_to_index.append(d)
            if existing_meta is not None and existing_meta.get("content_hash") == "":
                migration_count += 1
    if migration_count:
        sys.stderr.write(
            f"content_hash 不在の既存 doc {migration_count} 件 → migration として re-embed\n",
        )

    current_ids, walked_ids = _compute_current_ids(
        docs, candidate_paths, existing, vault, mtime_after=mtime_after,
    )

    embed_all(docs_to_index, embed_url=embed_url)
    indexed_ids = bulk_ingest(docs_to_index, opensearch_url=opensearch_url, index=index)
    failed_ids = {d["id"] for d in docs_to_index} - indexed_ids

    # failed_ids を current_ids に残すことで、stale_ids に巻き込まれず OpenSearch の旧 version が保護される
    # (search hole 緩和)。failed_ids を除外すると旧 version も新 version も消えて検索面に穴が空く。

    stale_ids = (existing.keys() | indexed_ids) - current_ids
    deleted_count = bulk_delete(stale_ids, opensearch_url=opensearch_url, index=index) if stale_ids else 0

    # write_state は無条件に実行する: 永続失敗 doc 1 件で state が永遠に進まない poison-pill deadlock を回避する。
    # 永続失敗以外の正常 doc については incremental が機能し続ける。failed_ids がある場合は stderr に WARNING を出し、
    # 旧 version 保護 + 次回 mtime 更新時に再 attempt + 永続失敗は --full で復旧、という運用前提を operator に通知する。
    write_state(opensearch_url, state_index, run_start_iso, len(current_ids))
    if failed_ids:
        sys.stderr.write(
            f"WARNING: failed_ids が {len(failed_ids)} 件あるが write_state は実行する "
            f"(旧 version は OpenSearch 上に保護、次回 mtime 更新時に再 attempt、"
            f"永続失敗は --full で復旧)\n",
        )

    sys.stderr.write(
        f"ingest 完了: walked={len(walked_ids)} reindexed={len(indexed_ids)} "
        f"skipped_unchanged={len(walked_ids) - len(docs_to_index)} "
        f"failed={len(failed_ids)} stale_deleted={deleted_count} "
        f"current_total={len(current_ids)} "
        f"index={index} state_index={state_index} "
        f"last_run_iso_in={last_run_iso!r} run_start_iso={run_start_iso} full={full}\n",
    )


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Obsidian vault notes/ をセクション単位で OpenSearch 用 doc 配列に変換する (Phase 2)",
    )
    ap.add_argument("--vault", required=True, help="vault の絶対パス")
    ap.add_argument("--scope", default="notes", help="走査対象サブディレクトリ (既定: notes)")
    ap.add_argument(
        "--embed-url",
        default=DEFAULT_EMBED_URL,
        help=f"embed endpoint URL (既定: {DEFAULT_EMBED_URL}, --embed-only / --ingest で使用)",
    )
    ap.add_argument(
        "--opensearch-url",
        default=DEFAULT_OPENSEARCH_URL,
        help=f"OpenSearch endpoint URL (既定: {DEFAULT_OPENSEARCH_URL}, --ingest で使用)",
    )
    ap.add_argument(
        "--index",
        default=DEFAULT_INDEX,
        help=f"OpenSearch index 名 (既定: {DEFAULT_INDEX})",
    )
    ap.add_argument(
        "--state-index",
        default=DEFAULT_STATE_INDEX,
        help=f"incremental ingest の state を保存する index 名 (既定: {DEFAULT_STATE_INDEX})",
    )
    ap.add_argument(
        "--full",
        action="store_true",
        help="incremental トリガを skip し全件 walk を強制する (cron での週次 full 等の運用余地)",
    )
    mode_group = ap.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--dry-run",
        action="store_true",
        help="埋め込み HTTP 呼び出しせず body_vector=[] のまま JSON 配列を stdout に出す (V1-regression 用)",
    )
    mode_group.add_argument(
        "--embed-only",
        action="store_true",
        help="embed HTTP 呼び出しを行い doc 配列を stdout に出す (V2 単体テスト用)",
    )
    mode_group.add_argument(
        "--ingest",
        action="store_true",
        help="incremental + content_hash + 集合差分 stale 削除の本番 ingest を実行する",
    )
    args = ap.parse_args()

    vault = Path(args.vault).expanduser().resolve()
    if not vault.is_dir():
        sys.exit(f"vault が無い: {vault}")

    if args.dry_run:
        # V1-regression: HTTP 呼び出しなし、全件 walk で body_vector=[] stub のまま JSON 出力。
        docs = build_docs(vault, args.scope)
        json.dump(docs, sys.stdout, ensure_ascii=False, indent=1)
        sys.stdout.write("\n")
        return

    if args.embed_only:
        # V2 単体テスト: 全件 walk + embed のみ (ingest なし)。
        docs = build_docs(vault, args.scope)
        embed_all(docs, embed_url=args.embed_url)
        json.dump(docs, sys.stdout, ensure_ascii=False, indent=1)
        sys.stdout.write("\n")
        return

    if args.ingest:
        run_ingest(
            vault,
            args.scope,
            embed_url=args.embed_url,
            opensearch_url=args.opensearch_url,
            index=args.index,
            state_index=args.state_index,
            full=args.full,
        )
        return

    sys.exit("モードを指定してください: --dry-run / --embed-only / --ingest のいずれか")


if __name__ == "__main__":
    main()
