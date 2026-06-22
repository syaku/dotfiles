---
name: drain
description: vault の inbox/ に溜まった capture（人の生ダンプ・会話文脈の無い AI 成果物）を notes/ ノードへ昇格させる inbox 排出スキル。昇格時に inbox の作業レポートから既存タスクの完了（done）も検出する（証跡が耐久ファイルに逐語で残る入口なので done 検出は drain の責務）。蒸留パイプライン（素材整理（既存突き合わせ・候補生成・命名ゲート inline）→洞察検出→タスク・done 検出）は harvest-pipeline workflow（~/.claude/workflows/harvest-pipeline.js, mode: drain）に決定論オーケストレーションとして委譲し、本体は inbox/ スナップショット・Workflow 起動・トリアージ承認ゲート・承認後の Write 適用・archive 退避・運用ログ記録に徹する。モデル出し分けは script が agent 単位で固定するため /model 手動切替は不要。「drain して」「inbox を処理して」「inbox を空にして」などで起動する。遡り蒸留（期間指定の done reconcile・創発/メタ洞察）は別スキル /harvest（backfill）が担当。対象 vault は ~/workspace/notes/obsidian/Life（Obsidian、日本語運用）。
---

# drain: inbox/ → notes/ の昇格（inbox 排出）

`~/workspace/notes/obsidian/Life`（以下 vault）の `inbox/` に着地した capture を notes/ ノードへ昇格させるスキル。capture と AI の処理は非同期（capture は inbox/ に足すだけ・notes/ は AI 単一 writer）なので、**会話に作業痕跡が無いのは劣化ではなく正常運用**——`inbox/` の中身が正規の作業リスト。3 つの認知対象（気づき A／洞察 B／タスク T）の定義・タグ規約は vault の `Life/CLAUDE.md`「学習ループ」節が正本。

昇格の主要工程（素材整理＝既存ノード突き合わせ・候補生成・命名ゲートを inline で含む → 洞察検出 → done 候補検出 → 規約の機械検証）は **harvest-pipeline workflow**（`~/.claude/workflows/harvest-pipeline.js`, `mode: 'drain'`）に委譲する。モデルは script が agent 単位で固定する（昇格・整形=sonnet、洞察検出=opus、命名点検=sonnet）——main セッションのモデルは結果に影響しない。

**done 検出は drain の責務**。完了証跡（「X 完了」と読める作業レポート）は inbox/ という耐久ファイルに逐語で着地する——drain は昇格中の inbox 本文を corpus に既存タスクと突き合わせ、done 候補を出す。証跡到着＝drain 起動＝トリアージ承認ゲートの連鎖なので、**done 化も命名・層判定と同じ人承認経由**で整合する（揮発する会話バッファでなく耐久ファイルが証跡なのが要点）。順序ギャップ（完了レポートが先に drain され、タスクノートが後から作られて drain 時に存在しないケース）は event-driven では構造的に拾えず、期間を切って再照合する /harvest（backfill）の reconcile sweep が拾う。

drain は drain 産ノートの後段見直し（命名・層判定の opus 再点検）を持たない——その役目は /harvest（backfill）が期間指定で担う。drain は done 訂正が承認ループで発生する入口なので、**運用ログ記録は行う**（step 6・記録フォーマットは /harvest スキルの同名節が正本）。

## 厳守プロトコル

- **notes/ への Write/Edit は、トリアージ一覧の承認後に本体だけが行う**（workflow は read-only の分析と候補生成のみ）。
- **workflow 戻りの `candidates` を本体で要約・取捨・マージ・再命名しない**（生の N 件＝提示の N 件。命名はゲート済み）。
- **処理前スナップショットを不変に保つ。** 読込直後に `ls ~/workspace/notes/obsidian/Life/inbox/*.md | sort` の出力を控え、処理途中で取り直さない（archive 退避前の消失検知の基準）。
- **外部インポート（`imports/kindle/`・`imports/wallabag/`）は読み取りのみ。**
- inbox が空・所感なしの断片だけなら「A 止まりですらない」と正直に報告し、洞察をでっち上げない。原本の archive 退避だけ行う。

## フロー

### 1. スナップショットと読込

- `ls ~/workspace/notes/obsidian/Life/inbox/*.md | sort` を控える（README.md は処理対象外）。**空なら「drain 対象なし」と報告して即終了**。
- 各 inbox ファイルを Read する（内容は workflow への args になり、done 候補の証拠照合の母体にもなる）。
- 曖昧な点があり同席ユーザがいれば確認する（無い文脈を想像で復元しない）。Obsidian Sync 競合対策として、同席ユーザがいれば他端末の Obsidian を閉じるよう一言促す（副次的防御。主防御は step 5 の照合・停止）。
- 現在時刻（ISO-T）と当日日付を `date` で取得する（workflow script は Date を使えないため args で渡す）。
- **Obsidian 起動判定**: `pgrep -x Obsidian` で起動の有無を 1 回だけ確認する（起動判定は run 中で不変なので再取得しない）。この真偽は step 2 の `obsidian_available` で workflow に渡す——被リンク洗い・タスク列挙の obsidian-cli/rg 分岐は決定論なので script 側が解決し、各 subagent に `pgrep`＋分岐を委ねない。
- **家風タイトルの収集**: frontmatter tags に `気づき`/`洞察` を含む notes のファイル名（拡張子なし）一覧を作る（多い場合は新しめ 20 件程度）。上の起動判定が真なら `obsidian tag name=気づき` / `obsidian tag name=洞察` の `^notes/` 行、偽なら `rg -l` を使う（実タグ索引を引くので `rg` の frontmatter 正規表現より速く・正確——`rg` は body 内 inline タグや部分一致を巻き込み過剰一致する）。命名 agent が vault の確立した家風を実例として倣うための同梱素材（失敗接地: 2026-06-12 初回実走で命名 agent が素の文脈で命名し、説明文型の長いタイトルを量産した）。
- **運用ログの収集**: `notes/distill運用ログ.md` を Read して全文を取る（args `distill_log_text` で workflow に渡す）。workflow script が ✗→○ 訂正ペアと「初稿 通過」型を regex 抽出し、家風タイトル（直近 rg ピック）より優先して命名 agent に few-shot 注入する（人ゲート approve 済み＝最も家風に合致する教師データ。失敗形→修正形の対は ○ 単体より家風転写が強い）。ログが空・薄い段階では rg ピックがフォールバックとして機能する。

### 2. harvest-pipeline workflow の起動

`Workflow` tool を以下で起動する:

- `scriptPath`: `~/.claude/workflows/harvest-pipeline.js`
- `args`（JSON オブジェクトとして渡す。文字列化しない）:
  - `mode`: `"drain"`
  - `vault`: vault の絶対パス
  - `now`: ISO-T 現在時刻 / `today`: `YYYY-MM-DD`
  - `inbox_files`: `[{path, content}]`（step 1 で Read した全件。README 除く）
  - `style_titles`: 既存 `#気づき`/`#洞察` ノートのタイトル配列（step 1 で収集した家風の実例）
  - `distill_log_text`: `notes/distill運用ログ.md` の本文全文（step 1 で Read。空文字列 ok）
  - `obsidian_available`: `pgrep -x Obsidian` の真偽（boolean）。被リンク洗い・タスク列挙の obsidian-cli/rg 分岐を script が解決するために渡す

### 3. 戻り解釈

workflow は `{candidates, link_rewrites, done_candidates, totals, flags}` を返す（schema は script 冒頭を参照）。

- `totals` は script 計算。`candidates.length` との一致を一瞥確認する（不一致は script 改変事故なので報告して停止）。
- `flags.extraction_failed` に入った inbox ファイルは「未処理」と明示し、archive 退避の対象から外す。`flags.insight_failed` / `flags.done_failed` の軸は「未実施」と明示する。
- 各 candidate の `gate`（命名ゲートのログ）と `validation_errors` はトリアージ提示に添える。

### 4. トリアージ承認ゲート

candidate 全件を**本文で per-item 列挙**する: `{種別／タイトル（再命名があれば 元→最終）／昇格元 inbox／fold 先 or 新規／逆リンク先／ゲート・検証の残課題}`。**列挙に Markdown の番号付きリストを使わない**——各行は `- **ID n**: ...` のように candidate の `id` を地の文で書く（番号付きリストはレンダラがリストごとに 1 から振り直し、採否の ID 指定とずれる。失敗接地: 2026-06-12 初回実走で連番ずれが起きユーザ指摘で発覚）。`done_candidates`（完了根拠の逐語引用と `quote_verified`）も列挙する。**`quote_verified: false` の done 候補は「証拠引用が inbox 本文への包含照合に落ちた」ことを明示して提示する（黙って落とさない・黙って通さない）**——人が証跡の妥当性を判断する。**洞察候補は `derivation.common_axis` を逐語で必ず表示する**（各 source の回避法／共通点も添える）。common_axis は洞察タイトルの導出元かつ成立判断の材料なので、**これを出さずに洞察候補を採否にかけない**（タイトルだけ見て通すと、claim 起点・手元の像で命名した未成立の洞察を見逃す。失敗接地 2026-06-15: common_axis を提示せず洞察を一度 unresolved/破棄→手順を実走して common_axis から再導出したら成立した）。common_axis が単純合算でない判断軸になっているか人が確認する。`derivation_ok: false`（チェックリスト未充足）は明示する。採否入力は 4 件以下なら AskUserQuestion の multiSelect でもよいが、5 件以上は番号指定で答えさせる（列挙は常に本文・選択肢からの除外で候補を落とさない）。

### 5. 承認後の適用と archive 退避

承認されたものだけ適用する:

- 新規ノート: `content` を `notes/<タイトル>.md` に Write。fold は `backlink_edits` を畳み先へ追記。
- 逆リンク: `backlink_edits` を各既存ノートへ追記し、`updatedAt` 打ち直し・`## 更新履歴` に当日 `[[日付]]` を冪等追記。
- リンク張り替え: `link_rewrites`（昇格で inbox 名が変わる/分割される場合の被リンク元）の各ファイルで、元 inbox 名への wikilink を昇格先（複数分割なら主たる行き先）へ張り替える。
- done 化: 承認された done 候補の `progress: done` ＋ `updatedAt` 更新＋`## 更新履歴` に「完了」。`status:` は触らない。
- **archive 退避**: mv の前に `ls ~/workspace/notes/obsidian/Life/inbox/*.md | sort` を再実行し、step 1 のスナップショットと集合差分を取る。**欠落があれば mv せず、欠落ファイル名を報告してユーザ判断を仰ぐ**（Sync 消失の上に mv で状態を複雑化させない）。差分なしなら処理済み原本を `archive/inbox/` へ mv（`mkdir -p` の上で）。昇格先が同名 1:1 の場合は mv 自体が昇格を兼ねてよい（その場合 archive 退避は不要＝原本が notes/ で生きる）。

### 6. 完了報告と運用ログ

- 作成・fold・逆リンク・リンク張り替え・done 化・archive 退避（inbox/ 残量）・保留（理由付き）を箇条書きで報告する。
- **運用ログ記録**: `notes/distill運用ログ.md` に 1 実行 = 1 ブロックを追記する（記録項目・対記録フォーマットは `/harvest` スキルの「完了報告と運用ログ」節が正本——drain/harvest 共通）。drain で記録するのはモード `drain`／totals（候補・洞察・タスク・fold・done 候補）／**推奨/訂正ペア**（パイプライン推奨案 ↔ ユーザ指摘の訂正を 1 項目 1 ペアで・done の誤検出/取りこぼし訂正も含む）／洞察却下。**最小テンプレで始める**（重くして書かなくなるのが最大の失敗）。訂正が無い実行でも totals の 1 ブロックは残す。カーソル更新は無い（cursor は廃止済み）。

## workflow との interface

正本は `~/.claude/workflows/harvest-pipeline.js`（chezmoi source: `dot_claude/workflows/harvest-pipeline.js`）。判断系規約（捏造補完禁止・A／事実の区別・迷ったら分けて作る・タスク層分離・命名規約・persona との関係）は script に encode 済み——詳細と「撃ち直した残差の記録」は `/harvest` スキルの同名節を正本とする（drain/harvest は同一 pipeline を共有するため二重記述しない）。

## やってはいけないこと

- 「会話に作業痕跡が無い」を理由に素材無し扱いに格下げする（inbox/ の中身が正規の作業リスト。失敗接地: 過去に mtime 推定へ格下げして気づき生成を過保護にスキップした）
- workflow を介さず本体から直接 Agent で候補生成・命名・点検を fan-out する
- workflow 戻りの `candidates` を要約・取捨・マージ・再命名してから提示する（生の N 件＝提示の N 件）
- 承認前に notes/ へ Write する
- スナップショット照合をせずに archive へ mv する（欠落があれば止めて報告）
- inbox/ の原本を処理後も放置する（archive/inbox/ へ退避し inbox を空に保つ。残量＝未処理キューの可視化）
- 昇格で inbox 名が変わるのに `link_rewrites` の張り替えを省く（同名昇格を既定前提にしない。`alwaysUpdateLinks` は mv→新規作成では効かない）
- `quote_verified: false` の done 候補を黙って通す・黙って落とす（証拠が inbox 本文に包含されなかった旨をトリアージに明示して人に委ねる）
- 運用ログを形骸化させる（重くして書かなくなるのが最大の失敗。done 訂正の記録は承認ループの副産物に留め、最小テンプレで書く）
- `imports/kindle/` `imports/wallabag/` の編集・リネーム
