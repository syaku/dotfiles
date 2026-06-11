#!/usr/bin/env python3
"""illumia-chronicle の決定論層。journal の年代記節の検出・状態判定・抽出・
検証付き書き込みをコードで行い、LLM には生成（トーン・lore 判断）だけを残す。

設計意図: 上書き禁止・節境界・暦ルール・書式・字数は全て機械検証可能なのに
散文プロトコルで守らせていた。破壊事故（既存エントリ上書き・他節巻き込み）を
構造的に不可能化する。生成自体は main セッションが行う（トーンの核は few-shot
と文脈の豊かさで、subagent 分離はお手本を奪うため）。

modes:
  inspect --journal <path>
      年代記節の状態を JSON で返す: missing / empty / placeholder / filled。
      filled なら main は停止するだけ（上書き禁止の判定ごとコード化）。
  extract --journals-dir <dir>
      全 journal を走査し記入済みエントリを形式揺れ込みで抽出（モード A の観測部分）。
  write --journal <path> --date YYYY-MM-DD --entry-file <path> [--journals-dir <dir>]
      エントリを機械検証してから節へ書き込む。違反は書かずに error を返す。
      --journals-dir 指定時は直近エントリとの年距離 (<100) を warning で出す。
  stamp --file <path>
      frontmatter の updatedAt を現在時刻 (ISO-T 実値) に打ち直す。
"""

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

HEAD_RE = re.compile(r"^(\t*)(- )?## (\[\[)?イルミア年代記(\]\])?\s*$")
NEXT_SECTION_RE = re.compile(r"^(\t*)(- )?## ")
YEAR_RE = re.compile(r"暦光歴(\d+)年")
EVENT_RE = re.compile(r"《(.+?)》")
ENTRY_HEADER_RE = re.compile(r"^> \[!quote\] 暦光歴(\d+)年(\d+)月(\d+)日 — 《(.+?)》\s*$")


def find_section(lines):
    """年代記節の (heading_idx, end_idx, style) を返す。無ければ None。
    end_idx は節の次の行 (次の H2 行 or EOF)。"""
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
    """filled > placeholder > empty の優先で判定。
    プレースホルダの「暦光歴YYY年」は \\d+ に合致しないため filled にならない。"""
    if YEAR_RE.search(body_text) and EVENT_RE.search(body_text):
        return "filled"
    if "<?" in body_text:
        return "placeholder"
    return "empty"


def cmd_inspect(args):
    path = Path(args.journal)
    if not path.exists():
        return {"journal": str(path), "exists": False, "state": "no_journal"}
    lines = path.read_text(encoding="utf-8").splitlines()
    sec = find_section(lines)
    if sec is None:
        return {"journal": str(path), "exists": True, "state": "missing", "section": None}
    head, end, style = sec
    body = "\n".join(lines[head + 1 : end])
    return {
        "journal": str(path),
        "exists": True,
        "state": section_state(body),
        "section": {"heading_line": head + 1, "end_line": end, "style": style},
        "body": body,
    }


def parse_filled_body(body_lines):
    """記入済み本文から (year, month, day, event, body) を形式揺れ込みで抽出する。
    対応形式: べた書き1行 / アウトライン年別行 (2025-03-28 型) / callout。"""
    text = "\n".join(body_lines)
    ym = YEAR_RE.search(text)
    ev = EVENT_RE.search(text)
    if not (ym and ev):
        return None
    year = int(ym.group(1))
    date_m = re.search(r"暦光歴\d+年(\d+)月(\d+)日", text)
    month, day = (int(date_m.group(1)), int(date_m.group(2))) if date_m else (None, None)
    event = ev.group(1)
    after = text[ev.end() :]
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


def cmd_extract(args):
    root = Path(args.journals_dir)
    entries = []
    skipped = []
    for p in sorted(root.glob("*.md")):
        lines = p.read_text(encoding="utf-8").splitlines()
        sec = find_section(lines)
        if sec is None:
            continue
        head, end, style = sec
        body_lines = lines[head + 1 : end]
        if section_state("\n".join(body_lines)) != "filled":
            skipped.append(p.stem)
            continue
        parsed = parse_filled_body(body_lines)
        if parsed:
            parsed["date"] = p.stem
            parsed["style"] = style
            entries.append(parsed)
    years = [e["year"] for e in entries]
    return {
        "entries": entries,
        "total": len(entries),
        "skipped_unfilled": skipped,
        "years": sorted(set(years)),
        "body_len_range": [min((e["body_len"] for e in entries), default=0), max((e["body_len"] for e in entries), default=0)],
    }


def validate_entry(entry_lines, target_date):
    """文体の機械検証。errors は書き込み拒否、warnings は main の判断材料。"""
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
    path = Path(args.journal)
    target_date = datetime.date.fromisoformat(args.date)
    entry_lines = Path(args.entry_file).read_text(encoding="utf-8").strip().splitlines()

    errors, warnings = validate_entry(entry_lines, target_date)

    lines = path.read_text(encoding="utf-8").splitlines()
    sec = find_section(lines)
    if sec is None:
        errors.append("対象 journal に年代記節が無い")
        return {"written": False, "errors": errors, "warnings": warnings}
    head, end, style = sec
    body_lines = lines[head + 1 : end]
    state = section_state("\n".join(body_lines))
    if state == "filled":
        errors.append("年代記節が記入済み (上書き禁止。停止して報告する)")
    if errors:
        return {"written": False, "errors": errors, "warnings": warnings}

    # 直近エントリとの年距離 (連作回避は lore note (b) の方針。逸脱は warning 止まり)
    if args.journals_dir:
        prev = [e for e in cmd_extract(argparse.Namespace(journals_dir=args.journals_dir))["entries"] if e["date"] < args.date]
        if prev:
            last = max(prev, key=lambda e: e["date"])
            new_year = int(ENTRY_HEADER_RE.match(entry_lines[0]).group(1))
            if abs(new_year - last["year"]) < 100:
                warnings.append(f"直近エントリ ({last['date']}, 暦光歴{last['year']}年) との年距離が {abs(new_year - last['year'])} 年 (方針は目安 100 年以上)")

    if style == "outline":
        entry_lines = ["\t" + ln for ln in entry_lines]
        new_body = entry_lines
    else:
        new_body = [""] + entry_lines + [""]

    if state == "placeholder":
        # `<? ... ?>` ブロックのみ置換し、節内の他の行は保持する
        start = next(i for i, ln in enumerate(body_lines) if "<?" in ln)
        stop = next((i for i, ln in enumerate(body_lines[start:], start) if "?>" in ln), start)
        kept_before = body_lines[:start]
        kept_after = body_lines[stop + 1 :]
        merged = kept_before + (entry_lines if style == "outline" else entry_lines) + kept_after
        if style == "flat" and (not kept_before or kept_before[-1].strip()):
            merged = kept_before + ([""] if kept_before else [""]) + entry_lines + kept_after
        new_lines = lines[: head + 1] + merged + lines[end:]
    else:  # empty
        new_lines = lines[: head + 1] + new_body + lines[end:]

    path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    return {"written": True, "errors": [], "warnings": warnings, "style": style, "replaced": state}


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
    p.add_argument("--journal", required=True)
    p = sub.add_parser("extract")
    p.add_argument("--journals-dir", required=True)
    p = sub.add_parser("write")
    p.add_argument("--journal", required=True)
    p.add_argument("--date", required=True)
    p.add_argument("--entry-file", required=True)
    p.add_argument("--journals-dir")
    p = sub.add_parser("stamp")
    p.add_argument("--file", required=True)
    args = ap.parse_args()
    result = {"inspect": cmd_inspect, "extract": cmd_extract, "write": cmd_write, "stamp": cmd_stamp}[args.mode](args)
    print(json.dumps(result, ensure_ascii=False, indent=1))
    if result.get("errors"):
        sys.exit(1)


if __name__ == "__main__":
    main()
