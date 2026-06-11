---
name: distill
description: 作業の終わりに、そのセッションで触れたノート・会話素材から気づき(A)をノード化し、ノート間の繋がりから洞察(B)を書き出す日次蒸留スキル。蒸留パイプライン（素材整理・突き合わせ・命名3層ゲート・洞察検出・done 検出）は distill-pipeline workflow（~/.claude/workflows/distill-pipeline.js, mode: daily|backfill）に決定論オーケストレーションとして委譲し、本体は素材確定・Workflow 起動・トリアージ承認ゲート・承認後の Write 適用・運用ログ＋カーソル更新に徹する。モデル出し分けは script が agent 単位で固定するため /model 手動切替は不要。「作業を distill して」「今日の作業をまとめて」「洞察を抽出して」で日次蒸留、「今週分を distill」「先週を振り返って」で backfill（期間指定・洞察フォーカス）。input/ の排出は別スキル /drain が担当（このスキルは input/ を処理しない）。対象 vault は ~/workspace/notes/obsidian/Life（Obsidian、日本語運用）。
---

# distill: 作業 → 気づき → 洞察 の蒸留（日次・backfill）

作業の末に呼ばれ、その作業を知識に変換して `~/workspace/notes/obsidian/Life`（以下 vault）に固定するスキル。3 つの認知対象（気づき A／洞察 B／タスク T）の定義・層関係・タグ規約・`progress:` 仕様は vault の `Life/CLAUDE.md`「学習ループ」節が正本（ここで再定義しない）。

蒸留の主要工程（素材整理・既存ノード突き合わせ・候補生成・命名 3 層ゲート・洞察検出・done 候補検出）は **distill-pipeline workflow**（`~/.claude/workflows/distill-pipeline.js`）に委譲する。件数集計・モード封鎖・ノート規約検証・done 証拠の包含照合は workflow script が**コードで決定論的に実行**するため、LLM の自己申告に依存しない。命名規約・層判別などの判断系規約も script 内のプロンプト断片に single-source で encode 済み——本体から重複指示しない。

**モード**: `daily`（既定。当日の会話＋カーソル以降の drain 産 pages が素材）／`backfill`（過去期間の遡り。洞察(B) フォーカス・気づき(A) は作らない）。**input/ の排出は `/drain` スキルの担当**で、このスキルは input/ を処理しない。

**モデル**: workflow script が agent 単位で固定する（素材整理・洞察検出=opus、命名点検=sonnet）。main セッションのモデルは結果に影響しないので `/model` の手動切替は不要。

## 厳守プロトコル

- **pages/ への Write/Edit は、トリアージ一覧の承認後に本体だけが行う**（workflow は read-only の分析と候補生成のみ。pages/ 単一 writer は「承認後の main」1 箇所に固定される）。
- **workflow 戻りの `candidates` を本体で要約・取捨・マージしない。** script が確定した生の N 件をそのまま per-item 列挙する（生の N 件＝提示の N 件）。タイトルも本体で書き換えない（命名はゲート済み。人ゲートでの訂正は承認時にユーザが行う）。
- **捏造補完しない。** 素材ダイジェストは会話の逐語抜粋ベースで作り、会話に無い感覚を想像で埋めない。backfill で過去 journal を埋めない。
- **外部インポート（`imports/kindle/`・`imports/wallabag/`）は読み取りのみ**。リンク先に使うのは可、編集・リネームは禁止。
- 承認後の適用では、approved candidate の `content` / `backlink_edits` をそのまま書く（`updatedAt`・`## 更新履歴` は script が機械検証済み。既存ノートへの逆リンク追記は最小限・本文の自然な位置に）。

## フロー

### 1. 入口ガードと素材確定

- **input/ 残量チェック**: `ls ~/workspace/notes/obsidian/Life/input/*.md`（README 除く）に未処理ファイルがあれば「先に /drain を回すか」をユーザに確認する（drain する意図の distill 誤起動をここで捕まえる）。drain 先行ならこのスキルは中断してよい。
- **カーソル読取**: `pages/distill運用ログ.md` 本文先頭の plain text 行 `最終日次蒸留: YYYY-MM-DDTHH:mm` を読む。frontmatter `createdAt` がこれより新しい pages を `rg`/Grep で洗い、**カーソル以降 pages リスト**を作る（drain 産ノートの見直し対象。filesystem 時刻は使わない）。
- **会話素材ダイジェスト**: このセッションの会話から気づき・タスク・完了報告の素材を**逐語抜粋ベース**で書き出す（workflow agent は会話を見られないため、ここが唯一の受け渡し点）。拾う基準は広めでよい——分類・命名・層判定は workflow が行うので、本体は生の言い回しを保った抜粋に徹する。会話に作業痕跡が無ければダイジェストは空でよい（想像で復元しない）。
- **backfill 起動時**（「今週分」「先週」等の期間指定）: 対象期間 `{from, to}` を確定する。素材ダイジェスト・カーソルは使わない。
- 現在時刻（ISO-T）と当日日付を `date` で取得する（workflow script は Date を使えないため args で渡す）。

### 2. distill-pipeline workflow の起動

`Workflow` tool を以下で起動する:

- `scriptPath`: `~/.claude/workflows/distill-pipeline.js`
- `args`（JSON オブジェクトとして渡す。文字列化しない）:
  - `mode`: `"daily"` または `"backfill"`
  - `vault`: vault の絶対パス
  - `now`: ISO-T 現在時刻 / `today`: `YYYY-MM-DD`
  - daily: `materials`（会話素材ダイジェスト）・`cursor_pages`（カーソル以降 pages のパス配列）
  - backfill: `period`: `{from, to}`

パイプライン構成（script に encode 済み）: 素材整理（突き合わせ・候補生成）→ 命名ゲート（機械 regex → 別 context 点検 agent → 再命名 → 再点検、最大 2 ラウンド）→ 洞察検出（0 件正当）→ done 候補検出（証拠引用の包含照合）→ 規約の機械検証と集計。

### 3. 戻り解釈

workflow は `{candidates, revisions, link_rewrites, done_candidates, totals, flags}` を返す（schema は script 冒頭を参照）。

- `totals` は script 計算。`candidates.length` との一致を一瞥確認する（不一致は script 改変事故なので報告して停止）。
- `flags.insight_failed` / `flags.done_failed` が true の軸は「未実施」と明示する（実施済みを装わない）。
- 各 candidate の `gate`（命名ゲートのログ: initial→final・ラウンド数・指摘内容）と `validation_errors`（規約の機械検証残）はトリアージ提示に添える。`gate.unresolved` / `gate.undecidable` は無理に解消せず、その旨を添えて人の採否に委ねる。

### 4. トリアージ承認ゲート

candidate 全件を**本文で per-item 列挙**する: `{種別／タイトル（再命名があれば 元→最終）／fold 先 or 新規／元素材／逆リンク先／ゲート・検証の残課題}`。**列挙に Markdown の番号付きリストを使わない**——各行は `- **ID n**: ...` のように candidate の `id` を地の文で書く（番号付きリストはレンダラがリストごとに 1 から振り直し、採否の ID 指定とずれる。失敗接地: 2026-06-12 初回実走で連番ずれが起きユーザ指摘で発覚）。`revisions`（drain 産ノートの見直し提案）と `done_candidates`（完了根拠の逐語引用と `quote_verified`）も同様に列挙する。採否入力は 4 件以下なら AskUserQuestion の multiSelect でもよいが、**5 件以上は番号指定で答えさせる**（列挙は常に本文・選択肢からの除外で候補を落とさない）。

- 洞察候補は claim（主張の一文）→タイトル→なぜ重要 の順で提示する（claim-first）。
- `quote_verified: false` の done 候補は「照合に落ちた」ことを明示して提示する（黙って落とさない・黙って通さない）。

### 5. 承認後の適用

承認されたものだけ適用する:

- 新規ノート: `content` を `pages/<タイトル>.md` に Write。
- fold: `backlink_edits` を畳み先ノートへ追記（当日 `[[日付]]` の `## 更新履歴` 追記も冪等に）。
- 逆リンク: `backlink_edits` を各既存ノートへ追記し、`updatedAt` を打ち直し・`## 更新履歴` に当日リンクを冪等追記。
- revisions: 承認された見直し（title はリネーム＋被リンク張り替え、tags/layer は frontmatter 修正）を適用。
- done 化: `progress: done` ＋ `updatedAt` 更新＋`## 更新履歴` に当日 `[[日付]]` ＋「完了」。`status:` は触らない。

### 6. 完了報告と運用ログ

- 作成・fold・逆リンク・done 化・保留（理由付き）を箇条書きで報告する。
- **運用ログ追記とカーソル更新は `pages/distill運用ログ.md` への単一の編集で同時に行う**（同一ファイルなので分離不能＝片落ちが構造的に起きない。daily のみ。backfill はカーソルを動かさない）。記録内容: 日付／モード／candidates の totals／**パイプライン内の再命名 全件（gate ログの initial→final）**／**人ゲートでの訂正 全件（タイトル・層判定・却下とその理由）**／洞察却下件数。パイプライン構成・モデルは script 固定なので記録不要。人ゲート訂正が自動化フェーズの教師データの本体（パイプライン内 rename は機械が直せた分、人ゲート訂正は機械が直せなかった分）。

## workflow との interface

正本は `~/.claude/workflows/distill-pipeline.js`（chezmoi source: `dot_claude/workflows/distill-pipeline.js`）。script を変更するときは本体 step 2（args）/ step 3（戻り schema）との整合を確認する。

script に encode 済みの判断系規約（どちらを変えるときも保持する）:

- **捏造補完の禁止**: 素材から復元できる範囲に留める。洞察 0 件・候補 0 件は正当な出力（「A 止まりですらない」もありうる）。
- **A／事実の区別**: 決め手はタイトルの高度。主語の一般化で 1 層上がる。事実・作業レポートに `#気づき` `#洞察` を付けない（タグ整合は script が機械検証もする）。
- **突き合わせの倒し方**: 明白に同一物の既出だけ畳む。迷ったら分けて作りリンクする（失敗は重複でなく orphan）。
- **タスクの層分離**: タスクを洞察素材に含めない（タスク→気づき→洞察の経由必須）。
- **命名規約**: 1 タイトル 1 要点・避けたい失敗を plain な確立語で名指す・作業ログは具体のまま。
- **backfill の保守性**: 気づき(A) を作らない・journal を埋めない・タスクは ① のみ（schema enum で表現不能化＋script filter の二重防御）。

## 撃ち直した残差の記録（2026-06-12 Workflow 化で前提条件が消えた防御）

旧設計（313 行の単一 SKILL.md・プロンプト層の規律）の失敗接地由来の防御のうち、以下は**構造変更で前提条件が消えたため撤去した**。元の失敗が新構造で再発したら、該当の錨ごと復活させる:

- **複文 grep ゲートの「結果転記」規約**（失敗接地: 2026-06-06/07/09 の複文化再発。○× 自己採点が甘く、機械実行の転記を必須化していた）→ script の JS regex になり、通過しない候補は bundle に入れない。転記・自己申告の経路自体が消滅。
- **命名点検 subagent の grounding 一式**（書き換え禁止・ツール非使用・生成時の確信を持ち込まない。失敗接地: 2026-06-11 A3 踏み外し＝[[同じ context で自己点検は甘くなる]] A7）→ 命名 agent と点検 agent が workflow の独立 spawn になり、別 context 分離が構造になった。点検 agent は schema 出力を返すだけで write 経路を持たない。再命名→3 層再適用→最大 2 ラウンド→未解決持ち越しのループは script の for 文。
- **backfill ②③ 封鎖の 3 重ゲート**（失敗接地: 過去日の感覚を想像で埋める捏造リスク）→ 抽出 schema の label enum が backfill では `['①']` になり ②③ が**表現不能**。script filter で二重防御。散文の宣言・確認・破棄の 3 段は機構ごと消滅。
- **モデル出し分けの手動 `/model` 運用と非対称性の許容**（drain=Sonnet/日次=Opus。忘れた場合の劣化を運用ログ「起動モデル」欄で観測していた）→ script が agent 単位でモデルを固定し、main のモデルが結果に影響しなくなった。「起動モデル」観測欄は廃止。
- **ラベル ①②③ の残存禁止・`- [ ]` 禁止・`updatedAt`/`更新履歴` 必須・タグ整合の散文規律**→ script の `validateCandidate()` が機械検証し、違反は fix agent →再検証→残るものはトリアージに明示。
- **運用ログ追記とカーソル更新の「必ず一緒に」対規約**（失敗接地: 片落ちで観測と対象選定がズレる）→ 同一ファイルへの単一編集に統合し、分離が構造的に不可能になった。
- **done 化の証拠ベース判定の散文規律**→ `evidence_quote` の素材包含照合を script が実行（`quote_verified`）。

旧 SKILL.md の「タイトルの付け方」「subagent 起動仕様」「3 モード差分」の詳細は script のプロンプト断片と schema に移管した。3 層モデル・タグ規約・`progress:` 仕様の正本は `Life/CLAUDE.md`。

## やってはいけないこと

- 弱い繋がりから洞察を捏造する（A を B に水増しする）・会話に無い感覚をダイジェストに足す
- **workflow を介さず本体から直接 Agent で候補生成・命名・点検を fan-out する**（命名ゲート・件数集計・封鎖を決定論層に置いた設計の骨抜き）
- **workflow 戻りの `candidates` を要約・取捨・マージ・再命名してから提示する**（生の N 件＝提示の N 件。ゲートの迂回）
- `gate.unresolved` / `quote_verified: false` を黙って通す・黙って落とす（残課題はトリアージに明示して人に委ねる）
- 承認前に pages/ へ Write する（単一 writer は「承認後の main」のみ）
- input/ をこのスキルで処理する（/drain の担当。入口ガードで誘導する）
- `imports/kindle/` `imports/wallabag/` の編集・リネーム
- 運用ログを形骸化させる（重くして書かなくなるのが最大の失敗。人ゲート訂正の記録は承認ループの副産物に留める）
