---
name: drain
description: vault の input/ に溜まった capture（人の生ダンプ・会話文脈の無い AI 成果物）を pages/ ノードへ昇格させる inbox 排出スキル。蒸留パイプライン（昇格候補生成・既存突き合わせ・命名3層ゲート・洞察検出・done 検出）は distill-pipeline workflow（~/.claude/workflows/distill-pipeline.js, mode: drain）に決定論オーケストレーションとして委譲し、本体は input/ スナップショット・Workflow 起動・トリアージ承認ゲート・承認後の Write 適用・archive 退避に徹する。モデル出し分けは script が agent 単位で固定するため /model 手動切替は不要。「drain して」「input を処理して」「inbox を空にして」などで起動する。日次蒸留・遡り蒸留は別スキル /distill が担当。対象 vault は ~/workspace/notes/obsidian/Life（Obsidian、日本語運用）。
---

# drain: input/ → pages/ の昇格（inbox 排出）

`~/workspace/notes/obsidian/Life`（以下 vault）の `input/` に着地した capture を pages/ ノードへ昇格させるスキル。capture と AI の処理は非同期（capture は input/ に足すだけ・pages/ は AI 単一 writer）なので、**会話に作業痕跡が無いのは劣化ではなく正常運用**——`input/` の中身が正規の作業リスト。3 つの認知対象（気づき A／洞察 B／タスク T）の定義・タグ規約は vault の `Life/CLAUDE.md`「学習ループ」節が正本。

昇格の主要工程（候補生成・既存ノード突き合わせ・命名 3 層ゲート・洞察検出・done 候補検出・規約の機械検証）は **distill-pipeline workflow**（`~/.claude/workflows/distill-pipeline.js`, `mode: 'drain'`）に委譲する。モデルは script が agent 単位で固定する（昇格・整形=sonnet、洞察検出=opus、命名点検=sonnet）——main セッションのモデルは結果に影響しない。

drain は**運用ログへの記録もカーソル更新もしない**（次回の日次 /distill がカーソル経由で drain 産ノートを拾い直し、命名・層判定を opus で見直す二段構えの後段が担当）。

## 厳守プロトコル

- **pages/ への Write/Edit は、トリアージ一覧の承認後に本体だけが行う**（workflow は read-only の分析と候補生成のみ）。
- **workflow 戻りの `candidates` を本体で要約・取捨・マージ・再命名しない**（生の N 件＝提示の N 件。命名はゲート済み）。
- **処理前スナップショットを不変に保つ。** 読込直後に `ls ~/workspace/notes/obsidian/Life/input/*.md | sort` の出力を控え、処理途中で取り直さない（archive 退避前の消失検知の基準）。
- **外部インポート（`imports/kindle/`・`imports/wallabag/`）は読み取りのみ。**
- input が空・所感なしの断片だけなら「A 止まりですらない」と正直に報告し、洞察をでっち上げない。原本の archive 退避だけ行う。

## フロー

### 1. スナップショットと読込

- `ls ~/workspace/notes/obsidian/Life/input/*.md | sort` を控える（README.md は処理対象外）。**空なら「drain 対象なし」と報告して即終了**。
- 各 input ファイルを Read する（内容は workflow への args になり、done 候補の証拠照合の母体にもなる）。
- 曖昧な点があり同席ユーザがいれば確認する（無い文脈を想像で復元しない）。Obsidian Sync 競合対策として、同席ユーザがいれば他端末の Obsidian を閉じるよう一言促す（副次的防御。主防御は step 5 の照合・停止）。
- 現在時刻（ISO-T）と当日日付を `date` で取得する（workflow script は Date を使えないため args で渡す）。

### 2. distill-pipeline workflow の起動

`Workflow` tool を以下で起動する:

- `scriptPath`: `~/.claude/workflows/distill-pipeline.js`
- `args`（JSON オブジェクトとして渡す。文字列化しない）:
  - `mode`: `"drain"`
  - `vault`: vault の絶対パス
  - `now`: ISO-T 現在時刻 / `today`: `YYYY-MM-DD`
  - `input_files`: `[{path, content}]`（step 1 で Read した全件。README 除く）

### 3. 戻り解釈

workflow は `{candidates, link_rewrites, done_candidates, totals, flags}` を返す（schema は script 冒頭を参照）。

- `totals` は script 計算。`candidates.length` との一致を一瞥確認する（不一致は script 改変事故なので報告して停止）。
- `flags.extraction_failed` に入った input ファイルは「未処理」と明示し、archive 退避の対象から外す。`flags.insight_failed` / `flags.done_failed` の軸は「未実施」と明示する。
- 各 candidate の `gate`（命名ゲートのログ）と `validation_errors` はトリアージ提示に添える。

### 4. トリアージ承認ゲート

candidate 全件を**本文で per-item 列挙**する: `{種別／タイトル（再命名があれば 元→最終）／昇格元 input／fold 先 or 新規／逆リンク先／ゲート・検証の残課題}`。**列挙に Markdown の番号付きリストを使わない**——各行は `- **ID n**: ...` のように candidate の `id` を地の文で書く（番号付きリストはレンダラがリストごとに 1 から振り直し、採否の ID 指定とずれる。失敗接地: 2026-06-12 初回実走で連番ずれが起きユーザ指摘で発覚）。`done_candidates`（完了根拠の逐語引用と `quote_verified`）も列挙する。採否入力は 4 件以下なら AskUserQuestion の multiSelect でもよいが、5 件以上は番号指定で答えさせる（列挙は常に本文・選択肢からの除外で候補を落とさない）。

### 5. 承認後の適用と archive 退避

承認されたものだけ適用する:

- 新規ノート: `content` を `pages/<タイトル>.md` に Write。fold は `backlink_edits` を畳み先へ追記。
- 逆リンク: `backlink_edits` を各既存ノートへ追記し、`updatedAt` 打ち直し・`## 更新履歴` に当日 `[[日付]]` を冪等追記。
- リンク張り替え: `link_rewrites`（昇格で input 名が変わる/分割される場合の被リンク元）の各ファイルで、元 input 名への wikilink を昇格先（複数分割なら主たる行き先）へ張り替える。
- done 化: 承認された done 候補の `progress: done` ＋ `updatedAt` 更新＋`## 更新履歴` に「完了」。`status:` は触らない。
- **archive 退避**: mv の前に `ls ~/workspace/notes/obsidian/Life/input/*.md | sort` を再実行し、step 1 のスナップショットと集合差分を取る。**欠落があれば mv せず、欠落ファイル名を報告してユーザ判断を仰ぐ**（Sync 消失の上に mv で状態を複雑化させない）。差分なしなら処理済み原本を `archive/input/` へ mv（`mkdir -p` の上で）。昇格先が同名 1:1 の場合は mv 自体が昇格を兼ねてよい（その場合 archive 退避は不要＝原本が pages/ で生きる）。

### 6. 完了報告

作成・fold・逆リンク・リンク張り替え・done 化・archive 退避（input/ 残量）・保留（理由付き）を箇条書きで報告する。運用ログ追記・カーソル更新は**しない**（日次 /distill の担当）。

## workflow との interface

正本は `~/.claude/workflows/distill-pipeline.js`（chezmoi source: `dot_claude/workflows/distill-pipeline.js`）。判断系規約（捏造補完禁止・A／事実の区別・迷ったら分けて作る・タスク層分離・命名規約）は script に encode 済み——詳細と「撃ち直した残差の記録」は `/distill` スキルの同名節を正本とする（drain/distill は同一 pipeline を共有するため二重記述しない）。

## やってはいけないこと

- 「会話に作業痕跡が無い」を理由に素材無し扱いに格下げする（input/ の中身が正規の作業リスト。失敗接地: 過去に mtime 推定へ格下げして気づき生成を過保護にスキップした）
- workflow を介さず本体から直接 Agent で候補生成・命名・点検を fan-out する
- workflow 戻りの `candidates` を要約・取捨・マージ・再命名してから提示する（生の N 件＝提示の N 件）
- 承認前に pages/ へ Write する
- スナップショット照合をせずに archive へ mv する（欠落があれば止めて報告）
- input/ の原本を処理後も放置する（archive/input/ へ退避し inbox を空に保つ。残量＝未処理キューの可視化）
- 昇格で input 名が変わるのに `link_rewrites` の張り替えを省く（同名昇格を既定前提にしない。`alwaysUpdateLinks` は mv→新規作成では効かない）
- 運用ログ・カーソルを drain で動かす（日次 /distill の担当）
- `imports/kindle/` `imports/wallabag/` の編集・リネーム
