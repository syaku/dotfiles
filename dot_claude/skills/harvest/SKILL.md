---
name: harvest
description: 期間を切って過去を遡り、未完了タスクの完了（done）を期間内の作業レポートと再照合（reconcile sweep）し、蓄積したノードグラフから創発・メタ洞察を検出する backfill（遡り蒸留）スキル。即時の inbox/ 排出・気づき/done の即時検出は /drain が event-driven で担い、backfill はそのすり抜け残差（順序ギャップで永久 open になったタスク・全構成ノードが過去 drain 済みの創発洞察）を retroactive に拾う。蒸留パイプライン（素材整理（既存突き合わせ・候補生成・命名ゲート inline）→洞察検出→タスク・done reconcile）は harvest-pipeline workflow（~/.claude/workflows/harvest-pipeline.js, mode: backfill）に決定論オーケストレーションとして委譲し、本体は期間確定・Workflow 起動・トリアージ承認ゲート・承認後の Write 適用・運用ログ記録に徹する。モデル出し分けは script が agent 単位で固定するため /model 手動切替は不要。「今週分を harvest」「先週を振り返って」「先月の done を拾い直して」「収穫して」などの期間系で起動する。inbox/ の即時排出・日次の気づきノード化は別スキル /drain が担当（このスキルは inbox/ を処理せず会話素材も掻かない）。対象 vault は ~/workspace/notes/obsidian/Life（Obsidian、日本語運用）。
---

# harvest: 期間を切った遡り蒸留（backfill）

期間を指定して呼ばれ、その期間を再走査して (a) 未完了タスクの完了を期間内の作業レポートと再照合（done reconcile sweep）し、(b) 蓄積したノードグラフから創発・メタ洞察を検出して `~/workspace/notes/obsidian/Life`（以下 vault）に固定するスキル。3 つの認知対象（気づき A／洞察 B／タスク T）の定義・層関係・タグ規約・`progress:` 仕様は vault の `Life/CLAUDE.md`「学習ループ」節が正本（ここで再定義しない）。

**2 層構造での立ち位置**: 即時の取り込み（inbox/ → notes/ 昇格・気づきノード化・done 即時検出）は `/drain` が event-driven で担う。backfill が拾うのはそのすり抜け残差——(i) **順序ギャップで永久 open になったタスク**（「X 完了」レポートが先に drain され、タスク X ノートが後から作られると drain 時に X が存在せず done 化されず、以降再スキャンされない）を期間で再照合する、(ii) **全構成ノードが過去 drain 済みの創発/メタ洞察**（新着が片足でも乗る関係は drain が発火時に回収済み・残るのは「今になって繋がって見える」束ね直しと高次の再発パターン）を拾う。即時の気づき(A) は作らない・会話素材も掻かない（会話で気づいたら inbox/ に書く＝capture 規律。`/drain` 経路で拾う）。

蒸留の主要工程（素材整理＝既存ノード突き合わせ・候補生成・命名ゲートを inline で含む → 洞察検出 → done reconcile）は **harvest-pipeline workflow**（`~/.claude/workflows/harvest-pipeline.js`, `mode: 'backfill'`）に委譲する。件数集計・モード封鎖・ノート規約検証・done 証拠の包含照合は workflow script が**コードで決定論的に実行**するため、LLM の自己申告に依存しない。done sweep の証跡（期間内の作業レポート系ノート本文）の絞り込みも frontmatter tags ベースで script が決定論フィルタする。命名規約・層判別などの判断系規約も script 内のプロンプト断片に single-source で encode 済み——本体から重複指示しない。

**inbox/ の排出は `/drain` スキルの担当**で、このスキルは inbox/ を処理しない。

**モデル**: workflow script が agent 単位で固定する（素材整理・洞察検出=opus、命名点検=sonnet）。main セッションのモデルは結果に影響しないので `/model` の手動切替は不要。

## 厳守プロトコル

- **notes/ への Write/Edit は、トリアージ一覧の承認後に本体だけが行う**（workflow は read-only の分析と候補生成のみ。notes/ 単一 writer は「承認後の main」1 箇所に固定される）。
- **workflow 戻りの `candidates` を本体で要約・取捨・マージしない。** script が確定した生の N 件をそのまま per-item 列挙する（生の N 件＝提示の N 件）。タイトルも本体で書き換えない（命名はゲート済み。人ゲートでの訂正は承認時にユーザが行う）。
- **捏造補完しない。** 過去 journal を埋めない・過去日の感覚を想像で復元しない。done 判定は期間内の作業レポート本文への逐語包含が証拠（要約・言い換えは照合に落ちる）。
- **外部インポート（`imports/kindle/`・`imports/wallabag/`）は読み取りのみ**。リンク先に使うのは可、編集・リネームは禁止。
- 承認後の適用では、approved candidate の `content` / `backlink_edits` をそのまま書く（`updatedAt`・`## 更新履歴` は script が機械検証済み。既存ノートへの逆リンク追記は最小限・本文の自然な位置に）。

## フロー

### 1. 入口ガードと期間確定

- **inbox/ 残量チェック**: `ls ~/workspace/notes/obsidian/Life/inbox/*.md`（README 除く）に未処理ファイルがあれば「先に /drain を回すか」をユーザに確認する（drain する意図での誤起動をここで捕まえる）。drain 先行ならこのスキルは中断してよい。
- **対象期間 `{from, to}` を確定する**（「今週分」「先週」「先月の done を拾い直して」等の期間指定から）。期間の起点はユーザ指定に従うが、明示が無ければ**運用ログ `notes/distill運用ログ.md` の直近の backfill ブロックの日付を起点に当日まで**を既定にする（cursor は廃止したので「最後の backfill いつか」は運用ログの直近ブロックから人が読む——自動追跡を捨てた代償。順序ギャップを構造的に外さないため起点は前回 backfill 以降で素直に切る）。
- **初回ブートストラップ（backfill ブロックが運用ログに無い場合）**: 運用ログに backfill モードのブロックが 1 つも無ければ（過去ログが全て旧 daily 等で backfill 履歴ゼロ）、起点を自動既定にせず**ユーザに対象期間を明示確認する**（「いつから遡るか」を聞く）。履歴ゼロの状態で当日との差を勝手に既定にすると、起点が決まらないまま広期間を走らせる事故になる。
- 現在時刻（ISO-T）と当日日付を `date` で取得する（workflow script は Date を使えないため args で渡す）。

### 2. harvest-pipeline workflow の起動

`Workflow` tool を以下で起動する:

- `scriptPath`: `~/.claude/workflows/harvest-pipeline.js`
- `args`（JSON オブジェクトとして渡す。文字列化しない）:
  - `mode`: `"backfill"`（固定）
  - `vault`: vault の絶対パス
  - `now`: ISO-T 現在時刻 / `today`: `YYYY-MM-DD`
  - `period`: `{from, to}`（step 1 で確定した対象期間）

パイプライン構成（script に encode 済み）: 素材整理（期間内 notes の収集・タスク① 候補生成・done sweep 用に作業レポート系ノート本文を収集・命名ゲート（機械 regex → 別 context 点検 agent → 再命名 → 再点検、最大 2 ラウンド）を inline で含む）→ 洞察検出（0 件正当・蓄積グラフの創発/メタ洞察が主眼）→ done reconcile（期間内作業レポート本文への証拠引用の包含照合）→ 規約の機械検証と集計。

### 3. 戻り解釈

workflow は `{candidates, link_rewrites, done_candidates, duplicate_detected, totals, flags}` を返す（schema は script 冒頭を参照）。素材整理段で生成される候補はタスク①のみ（②③ は schema enum で表現不能・気づきは backfill では作らない）が、その後の洞察検出が検出した洞察を候補に merge する（script の `candidates.push(...insights)`）。したがって**戻りの `candidates` にはタスク①＋洞察が含まれる**（下の per-item 列挙はこの全件を対象にする）。`duplicate_detected` と `totals.duplicate_detected` は drain mode のフェイルセーフ用フィールドで、backfill では常に空配列・0 が返る（drain と schema を共有しているため field は存在する）。

- `totals` は script 計算。`candidates.length` との一致を一瞥確認する（不一致は script 改変事故なので報告して停止）。
- **backfill 素材収集 agent が結果を返さない場合、workflow は flag に退避せず例外終了する**（`backfill 素材収集 agent が結果を返さなかった` を throw）。backfill は素材収集が単一 agent で全工程の前提になるため fail-loud にしてある（drain の `extraction_failed` への graceful な flag 退避とは非対称——drain は inbox ごとに独立して部分失敗を許せるが、backfill は素材ゼロでは後段が全て空回りするため）。例外が出たら戻りは無いので、ユーザに収集失敗を報告して中断する。
- `flags.insight_failed` / `flags.done_failed` が true の軸は「未実施」と明示する（実施済みを装わない）。`flags.done_skipped_no_reports` が true なら、期間内に作業レポート系ノート（無印）が無く done sweep が走らなかった旨を明示する（「走査して 0 件」ではなく「reconcile 対象ゼロ」——backfill の主眼 done reconcile が走ったかをユーザが識別できるようにする）。
- 各 candidate の `gate`（命名ゲートのログ: initial→final・ラウンド数・指摘内容）と `validation_errors`（規約の機械検証残）はトリアージ提示に添える。`gate.unresolved` / `gate.undecidable` は無理に解消せず、その旨を添えて人の採否に委ねる。

### 4. トリアージ承認ゲート

candidate 全件を**本文で per-item 列挙**する: `{種別／タイトル（再命名があれば 元→最終）／fold 先 or 新規／元素材／逆リンク先／ゲート・検証の残課題}`。**列挙に Markdown の番号付きリストを使わない**——各行は `- **ID n**: ...` のように candidate の `id` を地の文で書く（番号付きリストはレンダラがリストごとに 1 から振り直し、採否の ID 指定とずれる。失敗接地: 2026-06-12 初回実走で連番ずれが起きユーザ指摘で発覚）。`done_candidates`（reconcile sweep の完了根拠の逐語引用と `quote_verified`）も同様に列挙する。**洞察候補は導出チェックリスト `derivation`（各 source の回避法／共通点／共通軸）も提示し、common_axis が単純合算でない判断軸になっているか人が確認する。`derivation_ok: false`（チェックリスト未充足）は明示する。**採否入力は 4 件以下なら AskUserQuestion の multiSelect でもよいが、**5 件以上は番号指定で答えさせる**（列挙は常に本文・選択肢からの除外で候補を落とさない）。

- 洞察候補は claim（主張の一文）→タイトル→なぜ重要 の順で提示する（claim-first）。
- `quote_verified: false` の done 候補は「照合に落ちた」ことを明示して提示する（黙って落とさない・黙って通さない）。

### 5. 承認後の適用

承認されたものだけ適用する:

- 新規ノート: `content` を `notes/<タイトル>.md` に Write。
- fold: `backlink_edits` を畳み先ノートへ追記（当日 `[[日付]]` の `## 更新履歴` 追記も冪等に）。
- 逆リンク: `backlink_edits` を各既存ノートへ追記し、`updatedAt` を打ち直し・`## 更新履歴` に当日リンクを冪等追記。
- done 化（reconcile sweep の核）: `progress: done` ＋ `updatedAt` 更新＋`## 更新履歴` に当日 `[[日付]]` ＋「完了」。`status:` は触らない。

### 6. 完了報告と運用ログ

- 作成・fold・逆リンク・done 化・保留（理由付き）を箇条書きで報告する。
- **運用ログを `notes/distill運用ログ.md` に追記する**（drain/harvest 共通のログ・1 実行 = 1 ブロック。この節が両モード共通フォーマットの正本——drain SKILL からも委譲される）。cursor は廃止したので更新する行は無い（backfill では「最後の backfill いつか」をこのブロックの日付が緩く担う）。記録内容（**システムの推奨案とユーザの指摘・訂正を対で残す**のがこのログの目的＝自動化フェーズの教師データ）:
  - **日付** ／ **モード**: `drain | backfill`（実行したモードを書く）／ **totals**: 候補・洞察・タスク・fold・**done 候補**
  - **推奨/訂正ペア**: 各訂正項目を `推奨案: <システムが出した命名/層判定/done 候補> → 指摘: <ユーザの訂正と理由>` の対で書く（パイプライン内 rename は推奨ペアの自動解決分として別掲＝機械が直せた分。人ゲート訂正は機械が直せなかった分＝教師データの本体）
  - **タイトル訂正の書式**: タイトル訂正のペアは `<ID> 初稿 \`<X>\`（任意の註釈）→ \`<Y>\`` 形式で書く（例: ``A1 初稿 `subagent は規範を読んでも善意で踏み外す`（Opus 初出）→ `規範を読んだ subagent も善意で破る` ``）。バッククォートまたは「」で囲む。訂正なしで通過した初稿は `<ID> 初稿 \`<X>\` (1 ラウンド) 通過` 形式で書く（例: ``A1 `subagent のネスト起動は親から見えない` は subagent 点検 round 1 で非該当・1 ラウンド通過``）。書式は人ゲートの読みやすさのための統一であり、自動抽出には使われない。
  - **done 訂正（誤検出・取りこぼし）** も推奨/指摘ペアで記録する（done を drain/backfill に移したことで新たに教師データになる軸）
  - **洞察却下**: 件数 ＋ 却下理由
- パイプライン構成・モデルは script 固定なので記録不要。**最小テンプレを維持する**（重くして書かなくなるのが最大の失敗）。

## workflow との interface

正本は `~/.claude/workflows/harvest-pipeline.js`（chezmoi source: `dot_claude/workflows/harvest-pipeline.js`）。script を変更するときは本体 step 2（args）/ step 3（戻り schema）との整合を確認する。

script に encode 済みの判断系規約（どちらを変えるときも保持する）:

- **捏造補完の禁止**: 素材から復元できる範囲に留める。洞察 0 件・候補 0 件は正当な出力（「A 止まりですらない」もありうる）。
- **A／事実の区別**: 決め手はタイトルの高度。主語の一般化で 1 層上がる。事実・作業レポートに `#気づき` `#洞察` を付けない（タグ整合は script が機械検証もする）。
- **突き合わせの倒し方**: 明白に同一物の既出だけ畳む。迷ったら分けて作りリンクする（失敗は重複でなく orphan）。
- **タスクの層分離**: タスクを洞察素材に含めない（タスク→気づき→洞察の経由必須）。
- **命名規約**: 1 タイトル 1 要点・避けたい失敗を plain な確立語で名指す・作業ログは具体のまま。
- **backfill の保守性**: 気づき(A) を作らない・journal を埋めない・タスクは ① のみ（schema enum で表現不能化＋script filter の二重防御）。
- **done reconcile の証拠**: 期間内の作業レポート系ノート本文（無印＝気づき/洞察/タスク タグを持たないノートを script が決定論フィルタ）への逐語包含が証拠。会話素材や過去日の推測を証拠にしない（`quote_verified` で機械防御）。
- **persona との関係（drain/harvest 共通）**: `~/.claude/persona.md` の「書き口」規範は distill 生成物（洞察・気づき・タスクのタイトルと本文）に基本適用する。false agency 回避・偏愛語/必殺技造語/横文字メタファー/副詞スタッキング/翻訳調動詞/アカデミック自称/中黒並列/全角ダッシュ/装飾絵文字/形容詞や心情の「」囲み はそのまま当てる（workflow script の `NAMING_COMMON`・`noteCriteria`・`insightCriteria` に明示注入済み）。distill 側で部分例外を立てるのは次の 3 点に限る: (1) **主語＋述語の文型タイトル**は distill の命名（観察を名指す・判断軸を名指す）として許容する——ただし文型を錦の御旗にしてメタファー連結や抽象語の組み合わせを量産しない（命名ゲートで検知）。(2) **Wikipedia 調の断定禁止**は事実羅列スタイルの話で、洞察本文の教訓断定とは別物。(3) **主語の一般化**は「具体事象から構造を抽出する一般化」のみ許可——「人々は／我々は／現代社会において」型の空虚な一般化は distill でも禁止。distill 規約の用語として「命題化」「命題型」は使わない（形を守れば中身が空でも OK の抜け穴になるため。代わりに「観察を名指す」「判断軸を名指す」と呼ぶ）。

## 撃ち直した残差の記録（2026-06-12 Workflow 化で前提条件が消えた防御）

旧設計（313 行の単一 SKILL.md・プロンプト層の規律）の失敗接地由来の防御のうち、以下は**構造変更で前提条件が消えたため撤去した**。元の失敗が新構造で再発したら、該当の錨ごと復活させる:

- **複文 grep ゲートの「結果転記」規約**（失敗接地: 2026-06-06/07/09 の複文化再発。○× 自己採点が甘く、機械実行の転記を必須化していた）→ script の JS regex になり、通過しない候補は bundle に入れない。転記・自己申告の経路自体が消滅。
- **命名点検 subagent の grounding 一式**（書き換え禁止・ツール非使用・生成時の確信を持ち込まない。失敗接地: 2026-06-11 A3 踏み外し＝[[同じ context で自己点検は甘くなる]] A7）→ 命名 agent と点検 agent が workflow の独立 spawn になり、別 context 分離が構造になった。点検 agent は schema 出力を返すだけで write 経路を持たない。再命名→3 層再適用→最大 2 ラウンド→未解決持ち越しのループは script の for 文。
- **backfill ②③ 封鎖の 3 重ゲート**（失敗接地: 過去日の感覚を想像で埋める捏造リスク）→ 抽出 schema の label enum が backfill では `['①']` になり ②③ が**表現不能**。script filter で二重防御。散文の宣言・確認・破棄の 3 段は機構ごと消滅。
- **モデル出し分けの手動 `/model` 運用と非対称性の許容**（drain=Sonnet/日次=Opus。忘れた場合の劣化を運用ログ「起動モデル」欄で観測していた）→ script が agent 単位でモデルを固定し、main のモデルが結果に影響しなくなった。「起動モデル」観測欄は廃止。
- **ラベル ①②③ の残存禁止・`- [ ]` 禁止・`updatedAt`/`更新履歴` 必須・タグ整合の散文規律**→ script の `validateCandidate()` が機械検証し、違反は fix agent →再検証→残るものはトリアージに明示。
- **運用ログ追記とカーソル更新の「必ず一緒に」対規約**（失敗接地: 片落ちで観測と対象選定がズレる）→ 2026-06-13 の 2 層再編で **cursor 自体を廃止**（唯一の消費者だった daily の catch-up 追跡が daily 廃止で役目を失った）。片落ちの対象（カーソル更新）が消滅したので対規約も不要に。未蒸留の追跡は backfill の期間指定が担い、起点は運用ログ直近ブロックの日付から人が読む。
- **done 化の証拠ベース判定の散文規律**→ `evidence_quote` の素材包含照合を script が実行（`quote_verified`）。drain は inbox 本文・backfill は期間内作業レポート本文が証跡。
- **daily の会話抽出経路・drain 産ノートの revisions 再点検**（失敗接地: 揮発バッファ＝会話から取り込むのは耐久ストア＝inbox/ より信頼性が低い・承認済みノードの再スキャンは冗長）→ 2026-06-13 の 2 層再編で **daily モードと revisions を廃止**。会話のみで立つ気づきは「気づいた時点で inbox/ に書く」capture 規律へ移し、`/drain` 経路で拾う。drain 産ノートの後段見直しは backfill（期間指定）が担う。

旧 SKILL.md の「タイトルの付け方」「subagent 起動仕様」「3 モード差分」の詳細は script のプロンプト断片と schema に移管した。3 層モデル・タグ規約・`progress:` 仕様の正本は `Life/CLAUDE.md`。

## やってはいけないこと

- 弱い繋がりから洞察を捏造する（A を B に水増しする）・過去日の感覚を想像で復元する
- 即時の気づき(A) ノード化や会話素材の掻き出しを backfill でやる（即時取り込みは /drain の責務・会話で気づいたら inbox/ に書く capture 規律へ）
- **workflow を介さず本体から直接 Agent で候補生成・命名・点検を fan-out する**（命名ゲート・件数集計・封鎖を決定論層に置いた設計の骨抜き）
- **workflow 戻りの `candidates` を要約・取捨・マージ・再命名してから提示する**（生の N 件＝提示の N 件。ゲートの迂回）
- `gate.unresolved` / `quote_verified: false` を黙って通す・黙って落とす（残課題はトリアージに明示して人に委ねる）
- 承認前に notes/ へ Write する（単一 writer は「承認後の main」のみ）
- inbox/ をこのスキルで処理する（/drain の担当。入口ガードで誘導する）
- `imports/kindle/` `imports/wallabag/` の編集・リネーム
- 運用ログを形骸化させる（重くして書かなくなるのが最大の失敗。推奨/指摘の対記録は承認ループの副産物に留め、最小テンプレで書く）
