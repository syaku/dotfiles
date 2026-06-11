#!/usr/bin/env python3
"""trend-digest の一覧取得層。4 ソース (Qiita / Zenn / HN / Lobsters) を独立に取得し、
正規化＋再掲除外済みの候補プール JSON を出力する。LLM を介さない決定論処理。

設計意図: 旧 SKILL では main セッションが生 Atom/JSON を目視パースしており
「件数・URL が落ちる」失敗の温床だった。取得・パース・URL 重複除外・per-source
成否判定は全てここで完結させ、LLM には判断 (関心/流行マッチ) だけを渡す。

usage:
  fetch_trends.py [--hn-keywords kw1,kw2,...] [--lobsters-tags ai,ml,...]
                  [--seen-file path] [--out path]
  --hn-keywords は 5 語を超えた分を黙って切る (旧規範「最大 5 語」の表現不能化)
  --seen-file   は除外 URL を 1 行 1 URL で (直近ダイジェスト掲載分の再掲防止)
  --out 省略時は stdout へ。終了コードは全ソース失敗時のみ 1
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

TIMEOUT = 15
UA = "trend-digest/2.0 (personal digest; contact: local)"
ATOM = "{http://www.w3.org/2005/Atom}"

# 候補プールの件数キャップ。判断層 (pick agent) に渡すプールが肥大すると
# プロンプトも main context も浪費する (失敗接地: 2026-06-12 初回実走で
# Lobsters タグ 7 面 ×25 件によりプール 260 件・121KB に膨張)
CAP_QIITA = 15
CAP_LOBSTERS_HOT = 15
CAP_LOBSTERS_TAG = 8


def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        return res.read().decode("utf-8", errors="replace")


def clean_url(url):
    """トラッキングパラメータ (utm_*) を剥がす。Qiita フィードの URL は
    ?utm_campaign=... 付きで、過去ダイジェスト掲載のクリーン URL と照合
    できず再掲除外が漏れる (失敗接地: 2026-06-12 実走)。出力 URL 自体も
    クリーンにしてノートに残す"""
    if not url:
        return url
    parts = urllib.parse.urlsplit(url)
    if not parts.query:
        return url
    kept = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
            if not k.startswith("utm_")]
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, parts.path,
         urllib.parse.urlencode(kept), parts.fragment))


def canon(url):
    """重複判定用の正規化。出力には元 URL を使う。"""
    if not url:
        return ""
    u = url.strip().rstrip("/")
    u = u.replace("https://", "").replace("http://", "")
    if u.startswith("www."):
        u = u[4:]
    return u.split("#")[0]


def domain(url):
    try:
        return urllib.parse.urlparse(url).netloc.replace("www.", "")
    except ValueError:
        return ""


def item(source, section, title, url, *, discussion_url=None,
         tags=None, points=None, comments=None, author=None):
    url = clean_url(url)
    return {
        "source": source,
        "section": section,  # domestic | foreign
        "title": title.strip(),
        "url": url,  # 記事実体 (出典リンク兼・深掘り WebFetch 対象)
        "discussion_url": discussion_url,
        "domain": domain(url) if url else "",
        "tags": tags or [],
        "points": points,
        "comments": comments,
        "author": author,
    }


def fetch_qiita():
    root = ET.fromstring(http_get("https://qiita.com/popular-items/feed"))
    out = []
    for e in root.findall(f"{ATOM}entry"):
        title = e.findtext(f"{ATOM}title") or ""
        href = None
        for link in e.findall(f"{ATOM}link"):
            if link.get("rel") in (None, "alternate"):
                href = link.get("href")
                break
        if not href:
            continue
        tags = [c.get("term") for c in e.findall(f"{ATOM}category") if c.get("term")]
        author = e.findtext(f"{ATOM}author/{ATOM}name")
        out.append(item("qiita", "domestic", title, href, tags=tags, author=author))
    return out[:CAP_QIITA]


def fetch_zenn():
    data = json.loads(http_get("https://zenn.dev/api/articles?order=daily&count=15"))
    out = []
    for a in data.get("articles", []):
        url = "https://zenn.dev" + a.get("path", "")
        # 一覧 API に topics が含まれないことがある (既知)。無ければ空のまま渡し
        # トピック推定は判断層 (pick agent) に委ねる
        tags = [t.get("name") or t.get("id_name", "") for t in a.get("topics", []) if t]
        user = (a.get("user") or {}).get("username")
        out.append(item("zenn", "domestic", a.get("title", ""), url,
                        tags=[t for t in tags if t], points=a.get("liked_count"),
                        author=user))
    return out


def fetch_hn(keywords):
    out = []
    queries = ["https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=20"]
    # keyword 検索は日付フィルタが無いと全期間の殿堂入り記事 (数年前の Show HN 等)
    # が relevance 上位を独占する (失敗接地: 2026-06-12 実走で 2022 年の
    # Obsidian 1.0 リリース等が混入)。直近 7 日に限定する
    cutoff = int(time.time()) - 7 * 86400
    for kw in keywords:
        q = urllib.parse.quote(kw)
        filters = urllib.parse.quote(f"points>30,created_at_i>{cutoff}")
        queries.append(
            "https://hn.algolia.com/api/v1/search"
            f"?query={q}&tags=story&numericFilters={filters}&hitsPerPage=5"
        )
    errors = []
    for qurl in queries:
        try:
            data = json.loads(http_get(qurl))
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError, OSError) as e:
            errors.append(f"{qurl}: {e}")
            continue
        for h in data.get("hits", []):
            hn_url = f"https://news.ycombinator.com/item?id={h.get('objectID')}"
            url = h.get("url") or hn_url  # Ask HN 等は item ページが実体
            out.append(item("hn", "foreign", h.get("title", ""), url,
                            discussion_url=hn_url, points=h.get("points"),
                            comments=h.get("num_comments")))
    if not out and errors:
        raise RuntimeError("; ".join(errors[:3]))
    return out


def fetch_lobsters(tags):
    out = []
    urls = [("https://lobste.rs/hottest.json", CAP_LOBSTERS_HOT)]
    urls += [(f"https://lobste.rs/t/{t}.json", CAP_LOBSTERS_TAG) for t in tags]
    errors = []
    for u, cap in urls:
        try:
            data = json.loads(http_get(u))
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError, OSError) as e:
            errors.append(f"{u}: {e}")
            continue
        for s in data[:cap]:
            disc = s.get("short_id_url")
            url = s.get("url") or disc
            out.append(item("lobsters", "foreign", s.get("title", ""), url,
                            discussion_url=disc, tags=s.get("tags", []),
                            points=s.get("score"), comments=s.get("comment_count")))
    if not out and errors:
        raise RuntimeError("; ".join(errors[:3]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hn-keywords", default="")
    ap.add_argument("--lobsters-tags", default="")
    ap.add_argument("--seen-file")
    ap.add_argument("--out")
    args = ap.parse_args()

    keywords = [k.strip() for k in args.hn_keywords.split(",") if k.strip()][:5]
    lob_tags = [t.strip() for t in args.lobsters_tags.split(",") if t.strip()]

    seen = set()
    if args.seen_file:
        with open(args.seen_file, encoding="utf-8") as f:
            seen = {canon(line) for line in f if line.strip()}

    sources = {}
    pool = []
    fetchers = [
        ("qiita", lambda: fetch_qiita()),
        ("zenn", lambda: fetch_zenn()),
        ("hn", lambda: fetch_hn(keywords)),
        ("lobsters", lambda: fetch_lobsters(lob_tags)),
    ]
    for name, fn in fetchers:
        try:
            items = fn()
            sources[name] = {"ok": True, "error": None, "fetched": len(items)}
            pool.extend(items)
        except Exception as e:  # ソース独立の成否判定: 1 ソースの失敗で全体を落とさない
            sources[name] = {"ok": False, "error": f"{type(e).__name__}: {e}", "fetched": 0}

    # URL 正規化キーで重複除去。クロスソース重複 (HN/Lobsters 同記事) は points の
    # 高い方を残し also_on に痕跡を残す。再掲 (seen) はここで落とし excluded に計上
    excluded_seen = 0
    by_key = {}
    for it in pool:
        key = canon(it["url"])
        if not key:
            continue
        if key in seen or canon(it.get("discussion_url")) in seen:
            excluded_seen += 1
            continue
        prev = by_key.get(key)
        if prev is None:
            by_key[key] = it
        else:
            keep, drop = (it, prev) if (it["points"] or 0) > (prev["points"] or 0) else (prev, it)
            if drop["source"] != keep["source"]:
                keep.setdefault("also_on", []).append(
                    {"source": drop["source"], "points": drop["points"],
                     "discussion_url": drop["discussion_url"]})
            keep["tags"] = sorted(set(keep["tags"]) | set(drop["tags"]))
            by_key[key] = keep

    items = list(by_key.values())
    for i, it in enumerate(items):
        it["id"] = i

    result = {
        "sources": sources,
        "hn_keywords_used": keywords,
        "lobsters_tags_used": lob_tags,
        "excluded_as_seen": excluded_seen,
        "pool_size": len(items),
        "items": items,
    }
    text = json.dumps(result, ensure_ascii=False, indent=1)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        ok = [n for n, s in sources.items() if s["ok"]]
        ng = [n for n, s in sources.items() if not s["ok"]]
        print(f"pool={len(items)} excluded_as_seen={excluded_seen} "
              f"ok={','.join(ok) or '-'} failed={','.join(ng) or '-'}")
    else:
        print(text)
    return 1 if not any(s["ok"] for s in sources.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
