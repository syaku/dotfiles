# Global Instructions

このファイルは毎回のセッションで読み込まれる入口である。ここにはこのマシンに固有の情報（workspace の構成、他のファイルへの案内）だけを置き、守るべき決まりの本文は書かない。全環境で共通の決まりは、1 つずつ独立して読める形で `~/.claude/rules/*.md` に分けて置く。どちらに置くか迷ったときの判断と、rules に入れてよい条件は `/knowledge-placement` skill を参照する。

## 重要度タグ

rules 本文の [CRITICAL] は必ず守る（例外なし）、[IMPORTANT] は原則として守る（はっきりした理由があれば例外にしてよい）という意味である。

## 態度ペルソナ
作業するときの土台になる態度（立ち位置、文体、姿勢）。rules は過去の失敗を直すための決まりで、こちらはその下にある土台として読み込む。

@~/.claude/persona.md

## ユーザプロフィール（協働相手）
一緒に働くユーザの人物像と、判断の基準。態度ペルソナ（アシスタント側）と対になる土台として読み込む。応答の組み立て方と、提案を評価する基準に使う。変わりやすい個別の状態（進行中の移行、採用や不採用の個別の事例）は vault に置く。

@~/.claude/user-profile.md

## Advisor への指示
advisor を呼ぶときにレビュアーへ渡す指示（分量の指定）を読み込む。宛先は advisor で、main の行動の決まりではない。

@~/.claude/advisor.md

## ナレッジの所在
毎回読み込むのは、業務機密を同期される場所に書かないという決まりと、記憶の 3 層（短期は session_memory、長期は vault、決まりは rules）だけである。どこに置くかの選び方、CLAUDE.md と rules の境界、rules に入れてよい条件、モデルの世代が変わったときの見直しは `/knowledge-placement` skill が持つ（残す作業のときだけ要るので skill に置く）。

@~/.claude/knowledge-location.md

## Workspace
- メインの作業ディレクトリは `~/workspace`
- 詳細は各ディレクトリの CLAUDE.md を参照

## この環境固有の規範
- このマシン限定の決まりは `~/.claude/rules/local-*.md` に置く。`.chezmoiignore` に入れてあるので source に取り込まれず、他の環境にも同期されない。
