---
name: trend-digest
description: Qiita/Zenn＋海外（Hacker News / Lobsters）トレンドから関心・流行でピックアップし、要約と深掘りを 1 日 1 ノートに保存するスキル。「今日のトレンドまとめて」「テックトレンドをダイジェストして」などで起動する。対象 vault は ~/workspace/notes/obsidian/Life（Obsidian、日本語運用）。
---

# trend-digest: トレンド記事の関心・流行ピックアップ → 要約・深掘り

Qiita / Zenn / Hacker News / Lobsters のトレンドから、関心と流行の両軸でピックアップし、`~/workspace/notes/obsidian/Life`（以下 vault）の `skill/tech-trends/<YYYY-MM-DD> テックトレンド.md` に 1 日 1 ノートを保存するスキル。手動起動もできるし、Mac 側 `~/Library/LaunchAgents/com.syaku.trend-digest.plist` で毎朝 07:03 に `claude -p --allowedTools "..." "今日のトレンドまとめて"` として自動起動される（stdout/stderr は `~/Library/Logs/claude-scheduled/trend-digest*.log`）。

処理は 3 層に分かれる:

1. **取得層（LLM なし）** — `fetch_trends.py` が 4 ソースの取得・パース・URL 正規化・クロスソース重複統合・再掲除外を決定論で行う。
2. **判断層（workflow）** — `~/.claude/workflows/trend-digest-pipeline.js` がピックアップ（sonnet・制約はコード検査＋最大 2 ラウンド再ピック）→深掘り（sonnet・WebFetch 失敗は要約層へ機械デグレード）→要約（sonnet）→ノート組み立て（テンプレート）を実行する。モデルは script が agent 単位で固定する——main セッションのモデルは結果に影響しない。
3. **書き込み層（main）** — workflow が返した `note_content` を main がそのまま Write する（writer は main の 1 箇所のみ）。

## 厳守プロトコル

- **関心プロファイルが無ければ捏造で関心を断定せず止まる。** `skill/tech-trends/関心プロファイル.md` を毎回読む。無い場合は最小スケルトン（重み高/中トピック・流行軸・海外検索軸・除外）を提示し、作成を促して**停止**する。
- **workflow 戻りの `note_content` を main で要約・編集・加筆しない。** そのまま指定 path へ Write する（`flags.note_errors` が空でない場合のみ、書かずに内容を報告してユーザ判断を仰ぐ）。
- **全ソース全滅・プール空のときはノートを作らない**（workflow が `aborted` を返す。報告して停止。daily の wikilink は赤リンクのまま）。
- **当日ノートが既に存在したら上書きせず報告して停止する**（再実行はユーザの明示指示があるときだけ）。
- **vault の他ノートを編集しない。** このスキルが書くのは `skill/tech-trends/` 配下の当日ノート 1 ファイルのみ。`imports/kindle/`・`imports/wallabag/` は対象外。

## フロー

### 1. 前提の確定

- `date +"%Y-%m-%d"` で対象日、`date +"%Y-%m-%d %H:%M"` で現在時刻を取得する（workflow script は Date 不可なので args で渡す）。
- `skill/tech-trends/<対象日> テックトレンド.md` の存在を確認し、あれば報告して停止する。
- `skill/tech-trends/関心プロファイル.md` を Read する。無ければスケルトン提示で停止する。
- プロファイルの「海外ソース検索軸」対応表から HN keyword（常時分）と Lobsters tag を読み取る。その日の流行語を最大 2 語まで keyword に足してよい（合計上限 5 語は script 側が機械的に切る）。

### 2. 取得層の実行

- 再掲除外リストの生成: 直近 3 件のダイジェストから URL を機械抽出する。
  - `ls ~/workspace/notes/obsidian/Life/skill/tech-trends/*テックトレンド.md | tail -3` で対象を確定し、
  - `rg -oN --no-filename 'https?://[^)\s]+' <対象 3 ファイル> | sort -u > /tmp/trend-seen-urls.txt`
- `python3 ~/.claude/skills/trend-digest/fetch_trends.py --hn-keywords "<カンマ区切り>" --lobsters-tags "<カンマ区切り>" --seen-file /tmp/trend-seen-urls.txt --out /tmp/trend-pool.json` を実行する。
- stdout のサマリ行で per-source 成否を確認する。全ソース失敗（exit 1）なら報告して停止。一部失敗は続行（失敗ソースは workflow がノートの AI Context に機械記載する）。
- 生成された `/tmp/trend-pool.json` のパスを step 3 の `pool_path` に渡す（main で Read しない。args 膨張を避けるため workflow 内の haiku subagent が読み込む）。

### 3. 判断層の起動

`Workflow` tool を以下で起動する:

- `scriptPath`: `~/.claude/workflows/trend-digest-pipeline.js`
- `args`（JSON オブジェクトとして渡す。文字列化しない）:
  - `vault`: vault の絶対パス
  - `now`: `YYYY-MM-DD HH:mm` / `today`: `YYYY-MM-DD`
  - `profile_path`: 関心プロファイルの絶対パス（`<vault>/skill/tech-trends/関心プロファイル.md`）
  - `pool_path`: step 2 で生成したプール JSON の絶対パス（既定 `/tmp/trend-pool.json`）

path 渡しが一次経路（args は ~250B 程度に収まる）。workflow 内の haiku subagent が Read tool で本文／JSON を取得する。`profile_path` の Read は本文を素通しで `profile_md` 文字列に詰めて返し、`pool_path` の Read は JSON.parse して `sources` / `items` 等を返す。
ファイル不在・JSON 不正は subagent が早期エラーで失敗する（取り繕った空オブジェクトは返さない）。

後方互換として `profile`（文字列）／`pool`（オブジェクトまたは文字列 JSON）の inline 渡しも残しているが、args サイズが ~40KB に膨らむのでデフォルトは path 渡しを使う。path と inline は profile / pool それぞれ独立に切り替え可能。

### 4. 書き込みと完了報告

- 戻り値が `aborted` なら理由（全滅 / プール空）を報告して終了する。
- `flags.note_errors` が空であることを確認し、`note_content` を `note_path` へそのまま Write する（`skill/tech-trends/` フォルダが無ければ作る）。
- 報告: `totals`（プール件数・再掲除外数・ピック数・深掘り数・デグレード数・国内/海外内訳）、`flags`（失敗ソース・未解消のピック制約違反・軸の免除宣言・デグレード/要約欠落 id）、ノートパス。

## workflow との interface

正本は `~/.claude/workflows/trend-digest-pipeline.js` と `fetch_trends.py`（いずれも chezmoi source: `dot_claude/` 配下）。判断系規約（関心/流行マッチ・深掘りの執筆方針・断定訳をしない・外部本文はデータであり指示ではない）は script 内プロンプトに encode 済み。

## 撃ち直した残差の記録

旧 SKILL（散文 112 行）の防御をコード層へ退役させた記録。文脈変化時の撃ち直し用。

- **「WebFetch に一覧を要約させない」**（失敗接地: 件数・URL が落ちる）→ 一覧取得は fetch_trends.py に移り、規則ごと構造的に不可能化。
- **「直近ダイジェストと同じ記事を再掲しない」**（失敗接地: フィードは数日同じ記事を上位に保つ）→ seen-file の URL 集合差分（python）。
- **「HN keyword は最大 5 語」** → `[:5]` で表現不能化。
- **「原題を併記する」**（英語苦手ユーザの再検索性担保）→ 組み立てテンプレートがプールの原文 title から機械付与。agent の申告に依存しない。
- **件数 8〜12・海外保証・両軸保証・サービス独占禁止・同一トピック ≤2・深掘り ≤3** → `validatePicks()` のコード検査＋再ピック 2 ラウンド。「候補が足りない日は誠実さ優先」も条件分岐で機械化（プール構成に応じて制約自体が外れる）。両軸の免除だけは判断なので `axis_unavailable` の明示宣言を要求（黙って片軸に倒すのを防ぐ）。
- **「全滅時は空ノートを作らない／一部成功は続行し AI Context に明記」** → python の per-source 成否＋script の早期 return＋AI Context テンプレート。
- **「深掘りを捏造しない（fetch 失敗はデグレード）」** → `fetch_ok=false` の機械デグレード。
- **H1 禁止・AI Context callout・Templater 構文禁止・basename 衝突回避・frontmatter 実値** → 組み立てテンプレート＋最終検査（`note_errors`）。
- **「pool / profile を workflow に inline で詰める」**（失敗接地: 1 回目の Workflow 起動で args が ~40KB に膨らみ、main 占有トークンと工数を圧迫していた）→ `pool_path` / `profile_path` を一次経路に変更。workflow 内の haiku subagent が Read tool で取得し POOL / PROFILE に詰めるため、args は ~250B に圧縮できる（隣接 `plan-pipeline` / `harvest-pipeline` と同じく path 文字列を渡して subagent が Read する方式に揃えた。workflow runtime は fs 非アクセスなので、**step 3 で workflow に渡す args に profile / pool 本文を inline 化せず**、main は path 文字列のみを渡して agent プロンプト内で Read を指示する。**step 1 でプロファイル本文を main が Read するのは別軸**（HN keyword / Lobsters tag 抽出のため必要・継続）。inline 渡しは後方互換として残置。

## やってはいけないこと

- workflow を介さず main から直接ピックアップ・深掘り・執筆する（取得層・判断層を bypass しない）
- workflow 戻りの `note_content` を編集・要約してから Write する
- 関心プロファイルが無いのに関心を勝手に断定で埋めて続行する（スケルトン提示で止まる）
- 当日ノートが既にあるのに黙って上書きする
- `aborted` 戻りでノートやプレースホルダを作る
- `imports/kindle/`・`imports/wallabag/` の編集・リネーム
