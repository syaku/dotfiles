# CLAUDE.md

このファイルはワークスペース内で作業する際の Claude Code (claude.ai/code) へのガイダンスを提供する。環境固有・業務固有の情報は同階層の `CLAUDE.local.md` を参照。

## ワークスペース概要

`~/workspace` は開発リポジトリ・ノート・タスク作業領域を含むルートワークスペースディレクトリ。

## ディレクトリ構成

- `repos/` — 開発リポジトリ。詳細は `repos/CLAUDE.md` を参照。
- `notes/` — ノート。詳細は `notes/CLAUDE.md` を参照。
- `notes/obsidian/Life/inbox/` — Life ボルトに格納したいノートや作業レポートの保存先。特に指定が無い場合はこのフォルダに保存する。
- `worktree/` — Git worktree の作成先。

各領域固有のルール（命名規則・運用方針・作業対象範囲等）は配下の CLAUDE.md を参照。

## Obsidian vault 機械生成カタログ（AI 索引）

`notes/obsidian/Life/.ai-index/vault-catalog.md`（および `.json`）に機械生成ノード索引を保持する。harvest-pipeline 等の **workflow subagent が突き合わせ・洞察近傍の一次索引**として参照する想定（背景: vault の [[安く再生成できる索引は腐敗しない]] / [[動的索引はクエリを実行できない参照者に機能しない]]）。

- **形式**: 各行 `title · layer · #tags · →[outlinks]`（layer＝気づき/洞察/タスク/tool/無印、outlinks＝実 wikilink の解決先、タグ共有＝弱いエッジ）。
- **生成元**: `~/.claude/scripts/vault_catalog.py`（実 wikilink・frontmatter link・tags のみ抽出。MOC/ は Dataview 集約で静的エッジを持たないので走査しない）。`--format md` で本ファイル、`--format json --stdout` で動的索引向けに出力可能。
- **再生成**: SessionStart hook（`~/.claude/hooks/regen-vault-catalog.sh`）が workspace 配下セッションの開始時に更新。人は編集しない（再生成で上書き・`.ai-index/` はドットディレクトリで Obsidian は無視）。
- **参照方法**: トークンコストが嵩んだため CLAUDE.md からの `@import` 常時ロードを解除した。subagent からの参照は workflow 側で `--format json` を介した動的索引に組み込む想定（現状未実装。組み込むまでは subagent からカタログには届かない）。

### 作業ディレクトリ

ベースは `notes/obsidian/Life/workbench`。このベースフォルダ以下にタスク用のフォルダを作って作業スペースとする。

## フォルダ命名規則

- 内容が一目で分かる**日本語名**を付ける。
  - 例: `購入履歴ページ404調査/`, `BigQueryコスト試算/`
- 英語スラッグ（`investigate-xxx/`, `try-xxx/` 等）や、英語スラッグに日本語を継ぎ足しただけの命名（`product-detail-items-404調査/` 等）をデフォルトにしない。

チケット ID を起点にする等、領域固有の命名追加ルールは各 `CLAUDE.md` を参照（例: `notes/obsidian/Life/workbench/CLAUDE.md`）。
