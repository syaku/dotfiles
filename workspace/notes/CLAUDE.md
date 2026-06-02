# CLAUDE.md

このファイルは `notes/` ディレクトリで作業する際の Claude Code へのガイダンスを提供します。

## 概要

ノートを管理するディレクトリです。環境固有の構成（Vault 構成・Logseq アーカイブ等）は同階層の `CLAUDE.local.md` を参照。

## ディレクトリ構成

| ディレクトリ | 説明 |
|---|---|
| `obsidian/` | Obsidianによるノート管理。詳細は `obsidian/CLAUDE.md` を参照。 |

## 階層についての注意

`notes/` → `obsidian/` → 各 Vault という中間層は、子ディレクトリが1つしかなく案内のみで内容が薄く見えても **意図的な構造**。`notes/CLAUDE.md` や `notes/obsidian/CLAUDE.md` が薄いことを理由に統合・簡素化を提案しないこと。

- `notes/` 配下は元々 Logseq を併用していた名残で、ノートツール単位（`obsidian/`）で区切る前提。
- 環境によっては `obsidian/Work/` のような Work Vault が追加で入り、その時点で複数 Vault を束ねる中間層 `obsidian/` が機能する。

将来の拡張を見越した抽象化ではなく、現実の運用バリエーション（複数 Vault）を吸収する層である点で「過度な抽象化を避ける」とは区別する。
