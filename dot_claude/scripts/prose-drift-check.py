#!/usr/bin/env python3
"""規範や skill の本文を書き直したとき、機械的に守るべき要素が変わっていないかを照合する。

比較するもの:
  - backtick span（`...`）の多重集合
  - コードブロック（```...```）の逐語
  - <PLACEHOLDER> の集合（大文字と _ だけ、2 文字以上）
  - frontmatter の name
  - 引数で指定したキーワードの出現回数
あわせて文体の指標（本文の字数、「——」の数、規範側で定義した語の数）を前後で出す。

使い方:
  prose-drift-check.py <before> <after> [keyword ...]
終了コード: 0 = 一致、1 = 不一致
例:
  git show HEAD:path/SKILL.md > /tmp/before.md
  prose-drift-check.py /tmp/before.md path/SKILL.md 消化チェックリスト review-findings.md
"""
import collections
import re
import sys

JARGON = ['接地', '射程', '発火', '畳', '着地先', '地の文', '人ゲート', '承認ゲート', '格上げ', '昇格',
          '決定論', '自己申告', '名指', '逐語', '正本', '運ぶ', '立つ', '素通り', '効く', '効いて', '効かな',
          '化け', '器', '母集合', '縮退', '先行詞', '移送', '洗']


def parts(text):
    blocks = re.findall(r'```.*?```', text, flags=re.S)
    body = re.sub(r'```.*?```', '', text, flags=re.S)
    spans = collections.Counter(re.findall(r'`[^`\n]+`', body))
    placeholders = set(re.findall(r'<[A-Z_]{2,}>', text))
    name = re.search(r'^name:\s*(\S+)', text, flags=re.M)
    prose = re.sub(r'`[^`\n]+`', '', body)
    return blocks, spans, placeholders, (name.group(1) if name else None), prose


def metrics(prose):
    n = len(prose)
    return n, prose.count('——'), sum(prose.count(w) for w in JARGON)


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    before = open(argv[1], encoding='utf-8').read()
    after = open(argv[2], encoding='utf-8').read()
    keywords = argv[3:]
    b_blocks, b_spans, b_ph, b_name, b_prose = parts(before)
    a_blocks, a_spans, a_ph, a_name, a_prose = parts(after)
    ok = True
    if b_blocks != a_blocks:
        ok = False
        print('CODE BLOCKS DIFFER')
        for x in b_blocks:
            if x not in a_blocks:
                print('  missing:', x[:80].replace('\n', ' '))
        for x in a_blocks:
            if x not in b_blocks:
                print('  added:  ', x[:80].replace('\n', ' '))
    if b_spans != a_spans:
        ok = False
        print('BACKTICK SPANS DIFFER')
        for k in (b_spans - a_spans):
            print('  missing:', k, b_spans[k] - a_spans[k])
        for k in (a_spans - b_spans):
            print('  added:  ', k, a_spans[k] - b_spans[k])
    if b_ph != a_ph:
        ok = False
        print('PLACEHOLDERS DIFFER', b_ph ^ a_ph)
    if b_name != a_name:
        ok = False
        print('NAME DIFFERS', b_name, a_name)
    for k in keywords:
        if before.count(k) != after.count(k):
            ok = False
            print(f'KEYWORD COUNT DIFFERS {k}: {before.count(k)} -> {after.count(k)}')
    n1, d1, j1 = metrics(b_prose)
    n2, d2, j2 = metrics(a_prose)
    print(f'prose chars {n1} -> {n2}; dash {d1} -> {d2}; jargon {j1} -> {j2}')
    print('DRIFT OK' if ok else 'DRIFT FOUND')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
