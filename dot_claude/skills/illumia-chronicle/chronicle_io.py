#!/usr/bin/env python3
"""illumia-chronicle の決定論層。個別ノート (skill/illumia-chronicle/イルミア年代記_YYYY-MM-DD.md)
の状態判定・抽出・検証付き作成・updatedAt 打ち直しをコードで行い、LLM には生成（トーン・lore 判断）
だけを残す。

設計意図: 上書き禁止・暦ルール・書式・字数は全て機械検証可能なのに散文プロトコルで守らせていた。
破壊事故（既存エントリ上書き）を構造的に不可能化する。生成自体は main セッションが行う
（トーンの核は few-shot と文脈の豊かさで、subagent 分離はお手本を奪うため）。

modes:
  inspect --note <path>
      個別ノートの存在を JSON で返す: exists / missing。
      exists なら main は停止するだけ（上書き禁止の判定ごとコード化）。
  extract [--journals-dir <dir>] [--skill-dir <dir>]
      過去 journal の節および個別ノート群から記入済みエントリを形式揺れ込みで抽出
      （モード A の観測部分）。両方指定可能で結果を merge する。
  write --note <path> --date YYYY-MM-DD --entry-file <path> [--skill-dir <dir>]
      エントリを機械検証してから個別ノートを新規作成する。違反は書かずに error を返す。
      --skill-dir 指定時は直近エントリとの年距離 (<100) を warning で出す。
  stamp --file <path>
      frontmatter の updatedAt を現在時刻 (ISO-T 実値) に打ち直す。
"""

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

# 過去 journal の節判定用 (extract 後方互換)
HEAD_RE = re.compile(r"^(\t*)(- )?## (\[\[)?イルミア年代記(\]\])?\s*$")
NEXT_SECTION_RE = re.compile(r"^(\t*)(- )?## ")
YEAR_RE = re.compile(r"暦光歴(\d+)年")
EVENT_RE = re.compile(r"《(.+?)》")
ENTRY_HEADER_RE = re.compile(r"^> \[!quote\] 暦光歴(\d+)年(\d+)月(\d+)日 — 《(.+?)》\s*$")

# 個別ノートのファイル名 prefix
NOTE_FILENAME_PREFIX = "イルミア年代記_"


def find_section(lines):
    """過去 journal の年代記節を検出 (extract 後方互換用)。"""
    head = None
    style = None
    for i, line in enumerate(lines):
        m = HEAD_RE.match(line)
        if m:
            head = i
            style = "outline" if m.group(2) else "flat"
            break
    if head is None:
        return None
    end = len(lines)
    for j in range(head + 1, len(lines)):
        if NEXT_SECTION_RE.match(lines[j]):
            end = j
            break
    return head, end, style


def section_state(body_text):
    """filled > placeholder > empty の優先で判定 (extract が過去 journal の節を切り分けるため)。"""
    if YEAR_RE.search(body_text) and EVENT_RE.search(body_text):
        return "filled"
    if "<?" in body_text:
        return "placeholder"
    return "empty"


def cmd_inspect(args):
    """個別ノートの存在確認。"""
    path = Path(args.note)
    exists = path.exists()
    return {"note": str(path), "exists": exists, "state": "exists" if exists else "missing"}


def parse_filled_body(body_lines):
    """記入済み本文から (year, month, day, event, body) を形式揺れ込みで抽出する。
    対応形式: べた書き1行 / アウトライン年別行 / callout / 個別ノート (frontmatter 後の callout)。"""
    text = "\n".join(body_lines)
    ym = YEAR_RE.search(text)
    ev = EVENT_RE.search(text)
    if not (ym and ev):
        return None
    year = int(ym.group(1))
    date_m = re.search(r"暦光歴\d+年(\d+)月(\d+)日", text)
    month, day = (int(date_m.group(1)), int(date_m.group(2))) if date_m else (None, None)
    event = ev.group(1)
    after = text[ev.end():]
    after = re.sub(r"^[:：]\s*", "", after)
    body = re.sub(r"^[>\t\- ]+", "", after, flags=re.MULTILINE)
    body = " ".join(s.strip() for s in body.splitlines() if s.strip())
    if "[!quote]" in text:
        fmt = "callout"
    elif "\n" in text and ev.start() > text.index("\n"):
        fmt = "outline-split"
    else:
        fmt = "inline"
    return {"year": year, "month": month, "day": day, "event": event, "body": body, "body_len": len(body), "format": fmt}


def extract_from_journals(journals_dir):
    """過去 journal の節からエントリを抽出。"""
    root = Path(journals_dir)
    entries = []
    skipped = []
    for p in sorted(root.glob("*.md")):
        lines = p.read_text(encoding="utf-8").splitlines()
        sec = find_section(lines)
        if sec is None:
            continue
        head, end, style = sec
        body_lines = lines[head + 1:end]
        if section_state("\n".join(body_lines)) != "filled":
            skipped.append(p.stem)
            continue
        parsed = parse_filled_body(body_lines)
        if parsed:
            parsed["date"] = p.stem
            parsed["style"] = style
            parsed["source"] = "journal"
            entries.append(parsed)
    return entries, skipped


def extract_from_skill_dir(skill_dir):
    """個別ノート群からエントリを抽出。ファイル名は `イルミア年代記_YYYY-MM-DD.md`。"""
    root = Path(skill_dir)
    entries = []
    skipped = []
    for p in sorted(root.glob(f"{NOTE_FILENAME_PREFIX}*.md")):
        date_str = p.stem[len(NOTE_FILENAME_PREFIX):]
        try:
            datetime.date.fromisoformat(date_str)
        except ValueError:
            skipped.append(p.stem)
            continue
        text = p.read_text(encoding="utf-8")
        # frontmatter 直後の本文を切り出す
        body_text = re.sub(r"\A---\n.*?\n---\n", "", text, count=1, flags=re.DOTALL)
        body_lines = body_text.splitlines()
        parsed = parse_filled_body(body_lines)
        if parsed:
            parsed["date"] = date_str
            parsed["source"] = "skill-dir"
            entries.append(parsed)
        else:
            skipped.append(p.stem)
    return entries, skipped


def cmd_extract(args):
    entries = []
    skipped = []
    if args.journals_dir:
        e, s = extract_from_journals(args.journals_dir)
        entries.extend(e)
        skipped.extend(s)
    if args.skill_dir:
        e, s = extract_from_skill_dir(args.skill_dir)
        entries.extend(e)
        skipped.extend(s)
    years = [e["year"] for e in entries]
    return {
        "entries": entries,
        "total": len(entries),
        "skipped_unfilled": skipped,
        "years": sorted(set(years)),
        "body_len_range": [min((e["body_len"] for e in entries), default=0), max((e["body_len"] for e in entries), default=0)],
    }


def validate_entry(entry_lines, target_date):
    """文体の機械検証 (entry-file = callout 本体のみ)。errors は書き込み拒否、warnings は main の判断材料。"""
    errors = []
    warnings = []
    if not entry_lines:
        return ["エントリが空"], []
    header = entry_lines[0]
    m = ENTRY_HEADER_RE.match(header)
    if not m:
        errors.append("ヘッダ行が `> [!quote] 暦光歴YYY年MM月DD日 — 《事象名》` 形式でない")
        return errors, warnings
    year, month, day, event = int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4)
    if "：" in header or ":" in header.replace("[!quote]", ""):
        errors.append("ヘッダ行に `：` を含めない (事象名で行を締め、本文は次行から)")
    if not (600 <= year <= 999):
        errors.append(f"年 {year} が架空年レンジ 600〜900 番台を外れている")
    if (month, day) != (target_date.month, target_date.day):
        errors.append(f"月日 {month}月{day}日 が対象日の実月日 {target_date.month}月{target_date.day}日 と一致しない")
    body_lines = entry_lines[1:]
    bad = [ln for ln in body_lines if not ln.startswith("> ")]
    if bad:
        errors.append("本文行が `> ` で始まっていない (callout が途切れる)")
    body = "".join(ln[2:] for ln in body_lines if ln.startswith("> "))
    if "<%" in "\n".join(entry_lines):
        errors.append("Templater 構文が混入している")
    n = len(body)
    if n < 60 or n > 140:
        errors.append(f"本文 {n} 字 (許容 60〜140 字を逸脱。目安は 80〜110 字)")
    elif not (80 <= n <= 110):
        warnings.append(f"本文 {n} 字 (目安 80〜110 字からのずれ。実エントリは 68〜95 字)")
    return errors, warnings


def cmd_write(args):
    path = Path(args.note)
    target_date = datetime.date.fromisoformat(args.date)
    entry_lines = Path(args.entry_file).read_text(encoding="utf-8").strip().splitlines()

    errors, warnings = validate_entry(entry_lines, target_date)

    # 上書き禁止 (既存ノートは error)
    if path.exists():
        errors.append(f"個別ノート {path.name} が既に存在 (上書き禁止。停止して報告する)")

    # 出力先ディレクトリの存在確認 (mkdir せず error)
    if not path.parent.exists():
        errors.append(f"出力先ディレクトリ {path.parent} が存在しない (mkdir せず error)")

    if errors:
        return {"written": False, "errors": errors, "warnings": warnings}

    # 直近エントリとの年距離 (連作回避は lore note (b) の方針。逸脱は warning 止まり)
    if args.skill_dir:
        ext = cmd_extract(argparse.Namespace(journals_dir=None, skill_dir=args.skill_dir))
        prev = [e for e in ext["entries"] if e["date"] < args.date]
        if prev:
            last = max(prev, key=lambda e: e["date"])
            new_year = int(ENTRY_HEADER_RE.match(entry_lines[0]).group(1))
            if abs(new_year - last["year"]) < 100:
                warnings.append(f"直近エントリ ({last['date']}, 暦光歴{last['year']}年) との年距離が {abs(new_year - last['year'])} 年 (方針は目安 100 年以上)")

    now = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M")
    body = "\n".join([
        "---",
        f"createdAt: {now}",
        f"updatedAt: {now}",
        "tags:",
        "  - イルミア年代記",
        'parent: "[[イルミア年代記]]"',
        "---",
        "",
    ] + entry_lines) + "\n"
    path.write_text(body, encoding="utf-8")
    return {"written": True, "errors": [], "warnings": warnings, "note": str(path), "createdAt": now}


def cmd_stamp(args):
    path = Path(args.file)
    text = path.read_text(encoding="utf-8")
    now = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M")
    new, n = re.subn(r"^updatedAt: .*$", f"updatedAt: {now}", text, count=1, flags=re.MULTILINE)
    if not n:
        return {"stamped": False, "error": "frontmatter に updatedAt が無い"}
    path.write_text(new, encoding="utf-8")
    return {"stamped": True, "updatedAt": now}


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="mode", required=True)
    p = sub.add_parser("inspect")
    p.add_argument("--note", required=True)
    p = sub.add_parser("extract")
    p.add_argument("--journals-dir")
    p.add_argument("--skill-dir")
    p = sub.add_parser("write")
    p.add_argument("--note", required=True)
    p.add_argument("--date", required=True)
    p.add_argument("--entry-file", required=True)
    p.add_argument("--skill-dir")
    p = sub.add_parser("stamp")
    p.add_argument("--file", required=True)
    args = ap.parse_args()
    if args.mode == "extract" and not (args.journals_dir or args.skill_dir):
        print(json.dumps({"errors": ["--journals-dir または --skill-dir のいずれかが必須"]}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
    result = {"inspect": cmd_inspect, "extract": cmd_extract, "write": cmd_write, "stamp": cmd_stamp}[args.mode](args)
    print(json.dumps(result, ensure_ascii=False, indent=1))
    if result.get("errors"):
        sys.exit(1)


if __name__ == "__main__":
    main()
