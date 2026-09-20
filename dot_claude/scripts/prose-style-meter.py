#!/usr/bin/env python3
"""assistant の地の文、または規範ファイルの文体を数える。

指標（本文のみ。コードブロックと backtick span は除く）:
  - chars       本文の字数
  - dash/1k     「——」の 1000 字あたりの数
  - chain/1k    「AのBのC」型（の を 2 回以上挟む語句）の 1000 字あたりの数（粗い近似）
  - jargon/1k   規範側で定義した語の 1000 字あたりの数

使い方:
  prose-style-meter.py session <transcript.jsonl | セッション ID の先頭> [--per-message] [--bins N]
      assistant の text ブロックだけを数える。既定は時間順に 4 区間へ等分して出す。
      セッション ID の先頭を渡すと ~/.claude/projects/ 以下から探す。
  prose-style-meter.py files <path ...>
      ファイルごとに数える。ディレクトリを渡すと配下の .md を全部数える。

2026-09-19 のセッション c22db3cc の調査で使った計測。序盤〜後半は jargon 0.4〜0.95/1k、
規範を話題にした終盤だけ 6.55/1k に跳ねていた。書き直しの効果を見るときの比較点にする。
"""
import glob
import json
import os
import re
import sys

JARGON = ['接地', '射程', '発火', '畳', '着地先', '地の文', '人ゲート', '承認ゲート', '格上げ', '昇格',
          '決定論', '自己申告', '名指', '逐語', '正本', '運ぶ', '素通り', '効く', '効いて', '効かな',
          '化け', '母集合', '縮退', '先行詞', '移送', '洗われ']
CHAIN = re.compile(r'[^\sの、。「」（）]{2,}の[^\sの、。「」（）]{2,}の[^\sの、。「」（）]{2,}')


def clean(text):
    text = re.sub(r'```.*?```', '', text, flags=re.S)
    text = re.sub(r'`[^`\n]+`', '', text)
    text = re.sub(r'\|.*?\|\n', '', text)
    return text


def count(text):
    t = clean(text)
    n = len(t)
    return {'chars': n, 'dash': t.count('——'), 'chain': len(CHAIN.findall(t)),
            'jargon': sum(t.count(w) for w in JARGON)}


def fmt(label, c):
    n = c['chars'] or 1
    return (f"{label}: chars={c['chars']} dash/1k={c['dash']/n*1000:.2f} "
            f"chain/1k={c['chain']/n*1000:.2f} jargon/1k={c['jargon']/n*1000:.2f}")


def add(total, c):
    for k in c:
        total[k] = total.get(k, 0) + c[k]


def find_transcript(arg):
    if os.path.isfile(arg):
        return arg
    root = os.path.expanduser('~/.claude/projects')
    hits = glob.glob(os.path.join(root, '*', arg + '*.jsonl'))
    if len(hits) != 1:
        sys.exit(f'transcript が 1 つに決まりません: {hits}')
    return hits[0]


def session(args):
    per_message = '--per-message' in args
    bins = 4
    if '--bins' in args:
        bins = int(args[args.index('--bins') + 1])
    path = find_transcript(args[0])
    rows = []
    for line in open(path, encoding='utf-8'):
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if r.get('type') != 'assistant':
            continue
        for b in r.get('message', {}).get('content', []):
            if b.get('type') == 'text' and len(b['text']) > 150:
                rows.append((r.get('timestamp', ''), count(b['text'])))
    if not rows:
        sys.exit('assistant の text ブロックがありません')
    if per_message:
        for ts, c in rows:
            print(fmt(ts[11:19], c))
        return
    size = max(1, len(rows) // bins)
    for i in range(0, len(rows), size):
        chunk = rows[i:i + size]
        total = {}
        for _, c in chunk:
            add(total, c)
        print(fmt(f'{chunk[0][0][11:16]}-{chunk[-1][0][11:16]} ({len(chunk)} msgs)', total))


def files(args):
    paths = []
    for a in args:
        if os.path.isdir(a):
            paths += sorted(glob.glob(os.path.join(a, '**', '*.md'), recursive=True))
        else:
            paths.append(a)
    total = {}
    for p in paths:
        c = count(open(p, encoding='utf-8').read())
        add(total, c)
        print(fmt(p, c))
    if len(paths) > 1:
        print(fmt('TOTAL', total))


def main(argv):
    if len(argv) < 3 or argv[1] not in ('session', 'files'):
        print(__doc__)
        return 2
    (session if argv[1] == 'session' else files)(argv[2:])
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
