# CLAUDE.md

このファイルはワークスペース内で作業する際の Claude Code (claude.ai/code) へのガイダンスを提供します。環境固有・業務固有の情報は同階層の `CLAUDE.local.md` を参照。

## ワークスペース概要

`~/workspace` は開発リポジトリ・ノート・タスク作業領域を含むルートワークスペースディレクトリです。

## ディレクトリ構成

- `repos/` — 開発リポジトリ。詳細は `repos/CLAUDE.md` を参照。
- `tasks/` — タスクごとの作業領域。詳細は `tasks/CLAUDE.md` を参照。
- `scratch/` — 使い捨ての実験・検証コード。詳細は `scratch/CLAUDE.md` を参照。
- `notes/` — ノート。詳細は `notes/CLAUDE.md` を参照。

各領域固有のルール（命名規則・運用方針・作業対象範囲等）は配下の CLAUDE.md を参照。

## フォルダ命名規則（`tasks/`・`scratch/` 共通）

- 内容が一目で分かる**日本語名**を付ける
  - 例: `購入履歴ページ404調査/`, `BigQueryコスト試算/`
- 英語スラッグ（`investigate-xxx/`, `try-xxx/` 等）や、英語スラッグに日本語を継ぎ足しただけの命名（`ticket-book-tickets-404調査/` 等）をデフォルトにしない

チケット ID を起点にする等、領域固有の命名追加ルールは各 `CLAUDE.md` を参照（例: `tasks/CLAUDE.md`）。
