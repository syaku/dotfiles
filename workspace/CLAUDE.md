# CLAUDE.md

このファイルはワークスペース内で作業する際の Claude Code (claude.ai/code) へのガイダンスを提供します。環境固有・業務固有の情報は同階層の `CLAUDE.local.md` を参照。

## ワークスペース概要

`~/workspace` は開発リポジトリ・ノート・タスク作業領域を含むルートワークスペースディレクトリです。

## ディレクトリ構成

- `repos/` — 開発リポジトリ。詳細は `repos/CLAUDE.md` を参照。
- `notes/` — ノート。詳細は `notes/CLAUDE.md` を参照。
- `notes/obsidian/Life/input` — Lifeボルトに格納したいノートや作業レポートの保存先。特に指定が無い場合はこのフォルダに保存する。
- `worktree/` — Git worktreeの作成先。

各領域固有のルール（命名規則・運用方針・作業対象範囲等）は配下の CLAUDE.md を参照。

### 作業ディレクトリ

ベース: notes/obsidian/Life/workbench

ベースフォルダ以下にタスク用のフォルダを作って作業スペースとする。

## フォルダ命名規則

- 内容が一目で分かる**日本語名**を付ける
  - 例: `購入履歴ページ404調査/`, `BigQueryコスト試算/`
- 英語スラッグ（`investigate-xxx/`, `try-xxx/` 等）や、英語スラッグに日本語を継ぎ足しただけの命名（`ticket-book-tickets-404調査/` 等）をデフォルトにしない

チケット ID を起点にする等、領域固有の命名追加ルールは各 `CLAUDE.md` を参照（例: `notes/obsidian/Life/workbench/CLAUDE.md`）。
