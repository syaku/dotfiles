# AGENTS.md

このファイルは、ワークスペース内で作業する Claude Code (claude.ai/code) に向けた指針である。環境固有・業務固有の情報は同階層の `CLAUDE.local.md` を参照。

## ワークスペース概要

`~/workspace` はワークスペースのルートディレクトリで、開発リポジトリ、ノート、タスクの作業領域を含む。

## ディレクトリ構成

- `repos/` は開発リポジトリ。詳細は `repos/AGENTS.md` を参照。
- `notes/` はノート。詳細は `notes/AGENTS.md` を参照。
- `notes/obsidian/Life/inbox/` は、Life ボルトに格納したいノートや作業レポートの保存先。特に指定がない場合はこのフォルダに保存する。
- `worktree/` は Git worktree の作成先。

各領域固有のルール（命名規則・運用方針・作業対象範囲等）は配下の AGENTS.md を参照。

### 作業ディレクトリ

作業ディレクトリのベースは `notes/obsidian/Life/workbench`。このフォルダの下にタスク用のフォルダを作り、作業スペースにする。

## フォルダ命名規則

- 内容が一目で分かる**日本語名**を付ける。
  - 例: `購入履歴ページ404調査/`, `BigQueryコスト試算/`
- 英語スラッグ（`investigate-xxx/`, `try-xxx/` 等）や、英語スラッグに日本語を継ぎ足しただけの命名（`product-detail-items-404調査/` 等）をデフォルトにしない。

チケット ID を起点にするなど、領域固有の追加の命名ルールは各 `AGENTS.md` を参照（例: `notes/obsidian/Life/AGENTS.md` の「作業スペース（workbench/）」）。
