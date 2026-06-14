# CLAUDE.md

このファイルはワークスペース内で作業する際の Claude Code (claude.ai/code) へのガイダンスを提供する。環境固有・業務固有の情報は同階層の `CLAUDE.local.md` を参照。

## ワークスペース概要

`~/workspace` は開発リポジトリ・ノート・タスク作業領域を含むルートワークスペースディレクトリ。

## ディレクトリ構成

- `repos/` — 開発リポジトリ。詳細は `repos/CLAUDE.md` を参照。
- `notes/` — ノート。詳細は `notes/CLAUDE.md` を参照。
- `notes/obsidian/Life/input/` — Life ボルトに格納したいノートや作業レポートの保存先。特に指定が無い場合はこのフォルダに保存する。
- `worktree/` — Git worktree の作成先。

各領域固有のルール（命名規則・運用方針・作業対象範囲等）は配下の CLAUDE.md を参照。

## Obsidian vault 機械生成カタログ（AI 索引）

下の `@import` で `notes/obsidian/Life/pages/` の機械生成ノード索引を standing context に載せる。harvest-pipeline 等の **workflow subagent が突き合わせ・洞察近傍の一次索引**に使い、Grep fan-out を避ける（背景: vault の [[安く再生成できる索引は腐敗しない]] / [[動的索引はクエリを実行できない参照者に機能しない]]）。

- **ここ（workspace-root CLAUDE.md）に置く理由**: subagent は cwd から上方向の階層＋global CLAUDE.md は継承するが、nested な `Life/CLAUDE.md` は継承しない（実測で確認）。matcher は subagent 側で走るので、subagent が継承する workspace-root に置く必要がある。
- **形式**: 各行 `title · layer · #tags · →[outlinks]`（layer＝気づき/洞察/タスク/tool/無印、outlinks＝実 wikilink の解決先、タグ共有＝弱いエッジ）。
- **生成元**: `~/.claude/scripts/vault_catalog.py`（実 wikilink・frontmatter link・tags のみ抽出。MOC/ は Dataview 集約で静的エッジを持たないので走査しない）。
- **再生成**: SessionStart hook（`~/.claude/hooks/regen-vault-catalog.sh`）が workspace 配下セッションの開始時に更新。CLAUDE.md は session 開始時に 1 回読まれて固定されるため mid-session 再生成は反映されない（その回は前回生成分が載る）。人は編集しない（再生成で上書き・`.ai-index/` はドットディレクトリで Obsidian は無視）。
- ~1000 ノードまでは常時ロード（prompt cache の Project context レイヤに載る）で運用。それを超えたら CLAUDE.md 常時ロードを離れ動的索引（args 注入・`--format json`）へ切替予定。

@notes/obsidian/Life/.ai-index/vault-catalog.md

### 作業ディレクトリ

ベースは `notes/obsidian/Life/workbench`。このベースフォルダ以下にタスク用のフォルダを作って作業スペースとする。

## フォルダ命名規則

- 内容が一目で分かる**日本語名**を付ける。
  - 例: `購入履歴ページ404調査/`, `BigQueryコスト試算/`
- 英語スラッグ（`investigate-xxx/`, `try-xxx/` 等）や、英語スラッグに日本語を継ぎ足しただけの命名（`product-detail-items-404調査/` 等）をデフォルトにしない。

チケット ID を起点にする等、領域固有の命名追加ルールは各 `CLAUDE.md` を参照（例: `notes/obsidian/Life/workbench/CLAUDE.md`）。
