# Global Instructions

このファイルは常時ロードされる**通読用の入口・索引**。マシン固有の入口情報（workspace 構成・他の器へのポインタ）だけを置き、規範本体は置かない。全環境共通の規範は**自己完結した断片**として `~/.claude/rules/*.md` に分割する。どちらに置くかの境界判定・rules の入場条件は `~/.claude/rules/knowledge-location.md` を参照。

## Workspace
- メインの作業ディレクトリは `~/workspace`
- 詳細は各ディレクトリの CLAUDE.md を参照

## この環境固有の規範
- このマシン限定の規範は `~/.claude/rules/local-*.md` に置く。`.chezmoiignore` 済みで source に取り込まれず、他環境にも同期されない。
