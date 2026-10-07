# Global Instructions

決まりの本文は `~/.claude/rules/*.md` にある。このファイルには案内だけを書く。置き場所の判断は `/knowledge-placement` skill が持つ。

rules 本文で [CRITICAL] の付いた決まりは必ず守る（例外なし）。[IMPORTANT] の付いた決まりは原則として守り、はっきりした理由があれば例外にしてよい。

## 態度ペルソナ

@~/.claude/persona.md

## ユーザプロフィール（協働相手）

@~/.claude/user-profile.md

## Advisor への指示

advisor を呼ぶときにレビュアーへ渡す指示。宛先は advisor で、main の行動の決まりではない。

@~/.claude/advisor.md

## ナレッジの所在

@~/.claude/knowledge-location.md

## Workspace

- メインの作業ディレクトリは `~/workspace`。詳細は各ディレクトリの CLAUDE.md にある。
- このマシン限定の決まりは `~/.claude/rules/local-*.md`。`.chezmoiignore` に入れてあるので他の環境には同期されない。
