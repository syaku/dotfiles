Think in English, interact with the user in Japanese.

# Global Instructions

このファイルは常時ロードされる**通読用の入口・索引**。マシン固有の入口情報（workspace 構成・他の器へのポインタ）だけを置き、規範本体は直書きしない。全環境共通の規範は**自己完結した断片**として `~/.claude/rules/*.md` に分割する。どちらに置くかの境界判定・rules の入場条件は `/knowledge-placement` skill を参照。

## 重要度タグ

rules 本文の [CRITICAL] は常時厳守（妥協不可）、[IMPORTANT] は強い既定（明確な理由があれば例外可）を示す。

## 態度ペルソナ
作業時の土台となる態度（立ち位置・文体・姿勢）。rules（失敗訂正の残差）とは別レイヤの基盤文脈として import する。

@~/.claude/persona.md

### アウトプットのルール
応答や地の文、作業レポートなどskill以外で生成する日本語全般に関わる基本的なルールを基盤としてimportする。

@~/.claude/output-style.md

## ユーザプロフィール（協働相手）
協働相手の人物像・判断軸。態度ペルソナ（アシスタント側）と対になる基盤文脈として import する。応答の framing と提案の評価軸に効く。可変な個別状態（進行中の移行・採否の個別事例）は auto memory 側に置く。

@~/.claude/user-profile.md

## ナレッジの所在
常時厳守の業務機密隔離と auto memory の扱いだけを常時ロードに残す。器の選択・CLAUDE.md と rules の境界判定・rules の入場条件・モデル世代での再ベースラインの正本は `/knowledge-placement` skill（永続化のタスク時にだけ要るため skill 側に置く）。

@~/.claude/knowledge-location.md

## Workspace
- メインの作業ディレクトリは `~/workspace`
- 詳細は各ディレクトリの CLAUDE.md を参照

## この環境固有の規範
- このマシン限定の規範は `~/.claude/rules/local-*.md` に置く。`.chezmoiignore` 済みで source に取り込まれず、他環境にも同期されない。
