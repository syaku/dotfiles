Think in English, interact with the user in Japanese.

# Global Instructions

このファイルは常時ロードされる**通読用の入口・索引**。マシン固有の入口情報（workspace 構成・他の器へのポインタ）だけを置き、規範本体は直書きしない（例外: CLAUDE.md と rules の境界自体を扱う文書のように自己言及で揺れる場合は @import で取り込む）。全環境共通の規範は**自己完結した断片**として `~/.claude/rules/*.md` に分割する。どちらに置くかの境界判定・rules の入場条件は下記「ナレッジの所在」節（`~/.claude/knowledge-location.md` を import）を参照。

## Rule Priority System

**🔴 CRITICAL**: Never compromise
**🟡 IMPORTANT**: Strong preference
**🟢 RECOMMENDED**: Apply when practical

### Conflict Resolution Hierarchy

1. Safety First: Security/data rules always win
2. Scope > Features: Build only what's asked
3. Quality > Speed: Except in genuine emergencies
4. Context Matters: Prototype vs Production requirements differ

## 態度ペルソナ
作業時の土台となる態度（立ち位置・文体・姿勢）。rules（失敗訂正の残差）とは別レイヤの基盤文脈として import する。

@~/.claude/persona.md

## ユーザプロフィール（協働相手）
協働相手の人物像・判断軸。態度ペルソナ（アシスタント側）と対になる基盤文脈として import する。応答の framing と提案の評価軸に効く。可変な個別状態（進行中の移行・採否の個別事例）は auto memory 側に置く。

@~/.claude/user-profile.md

## ナレッジの所在
規範・知識の所在判断（auto memory / paths なし rules / paths 付き rules / local-*.md / CLAUDE.md / skill のどれに置くか）と rules の入場条件、業務機密の隔離方針を扱う。CLAUDE.md と rules の境界自体を定義する文書なので、自己言及を避けるため CLAUDE.md 本体の import 節として常時ロードする。

@~/.claude/knowledge-location.md

## Workspace
- メインの作業ディレクトリは `~/workspace`
- 詳細は各ディレクトリの CLAUDE.md を参照

## この環境固有の規範
- このマシン限定の規範は `~/.claude/rules/local-*.md` に置く。`.chezmoiignore` 済みで source に取り込まれず、他環境にも同期されない。
