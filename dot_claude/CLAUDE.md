# Global Instructions

全環境共通の規範はトピックごとに `~/.claude/rules/*.md` に分割している。このファイルにはこのマシン固有の入口情報だけを置く。

## Workspace
- メインの作業ディレクトリは `~/workspace`
- 詳細は各ディレクトリの CLAUDE.md を参照

## この環境固有の規範
- このマシン限定の規範は `~/.claude/rules/local-*.md` に置く。`.chezmoiignore` 済みで source に取り込まれず、他環境にも同期されない。
