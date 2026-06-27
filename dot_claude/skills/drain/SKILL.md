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
- **inbox 件数が 30 件を超えるとき分割を促す**: スナップショット件数が **30 件を超える** 場合は、1 cycle で全件処理せず分割を推奨する（理論見積もりで subagent_tokens が許容閾値 300k に近づくため。詳細は plan.md の安全ゾーン計算）。同席ユーザがいれば「分割しますか」と一言確認する。
- inbox 本文の取得は **workflow 内で各 drain 抽出 subagent が Read する**規約（main は本文を持たない）。main で取得するのは `inbox_files: [{path}]` の path 列だけ（`ls` 結果から構築）。後方互換のため、本文を持ちたい例外ケースでは `content` を同梱してもよい（workflow 側で content 非空なら Read をスキップする）。
- 曖昧な点があり同席ユーザがいれば確認する（無い文脈を想像で復元しない）。Obsidian Sync 競合対策として、同席ユーザがいれば他端末の Obsidian を閉じるよう一言促す（副次的防御。主防御は step 5 の照合・停止）。
- 現在時刻（ISO-T）と当日日付を `date` で取得する（workflow script は Date を使えないため args で渡す）。
- **Obsidian 起動判定**: `pgrep -x Obsidian` で起動の有無を 1 回だけ確認する（起動判定は run 中で不変なので再取得しない）。この真偽は step 2 の `obsidian_available` で workflow に渡す——被リンク洗い・タスク列挙の obsidian-cli/rg 分岐は決定論なので script 側が解決し、各 subagent に `pgrep`＋分岐を委ねない。
- **既存タスク一覧の収集** (起動判定で分岐・done 検出の突き合わせ素材): frontmatter tags に `タスク` を含む既存ノートの path + title 一覧を作る。drain 抽出 subagent が done 候補検出のために突き合わせる素材となる（args `open_tasks: [{path, title}]` で渡す）。

    ```bash
    if pgrep -x Obsidian >/dev/null; then
      obsidian tag name=タスク | grep '^notes/'
    else
      rg -l --multiline -U '(?s)^---\n(.*?\n)*?tags:\n(\s*-\s+[^\n]*\n)*\s*-\s+タスク' ~/workspace/notes/obsidian/Life/notes
    fi
    ```

    取得した path 列から拡張子を落として title を作る（または各ノートの frontmatter title フィールドがあればそれを優先）。

### 2. harvest-pipeline workflow の起動

`Workflow` tool を以下で起動する:

- `scriptPath`: `~/.claude/workflows/harvest-pipeline.js`
- `args`（JSON オブジェクトとして渡す。文字列化しない）:
  - `mode`: `"drain"`
  - `vault`: vault の絶対パス
  - `now`: ISO-T 現在時刻 / `today`: `YYYY-MM-DD`
  - `inbox_files`: `[{path}]`（step 1 で `ls` した全件・README 除く）。**主流路は `path` のみ・`content` は省略可**（workflow 側の drain 抽出 subagent が Read tool で本文を取る）。後方互換: 例外的に `content` を同梱した場合は subagent 側で Read をスキップしてそのまま使う。
  - `open_tasks`: `[{path, title}]`（step 1 で収集した既存タスクノートの一覧。drain 抽出 subagent が done 候補検出のために突き合わせる素材。**drain では必須**）
  - `obsidian_available`: `pgrep -x Obsidian` の真偽（boolean）。被リンク洗い・タスク列挙の obsidian-cli/rg 分岐を script が解決するために渡す

drain では path 列のみ必須・open_tasks 必須・他は省略可。

### 3. 戻り解釈

workflow は `{candidates, link_rewrites, done_candidates, duplicate_detected, totals, flags}` を返す（schema は script 冒頭を参照）。

- `totals` は script 計算。`candidates.length` との一致を一瞥確認する（不一致は script 改変事故なので報告して停止）。
- `flags.extraction_failed` に入った inbox ファイルは「未処理」と明示し、archive 退避の対象から外す。`flags.insight_failed` / `flags.done_failed` の軸は「未実施」と明示する。**drain 抽出が落ちた inbox は done 検出も同時に失われる**（v6 plan で done 検出を drain 抽出に併合したため、extraction_failed の inbox からは done 候補も harvest されない。受容済みの trade-off で、取りこぼしは /harvest backfill の reconcile sweep が後から拾う）。
- 各 candidate の `gate`（命名ゲートのログ）と `validation_errors` はトリアージ提示に添える。
- `duplicate_detected` は drain mode で done 候補と promotions が同じ `inbox_origin` から両方出た組（drain 抽出 subagent の order 強制 + 排他指示のフェイルセーフ。0 件が望ましいが非空なら step 4 で両方提示し人に解消を委ねる）。

### 4. トリアージ承認ゲート

candidate 全件を**本文で per-item 列挙**する: `{種別／タイトル（再命名があれば 元→最終）／昇格元 inbox／fold 先 or 新規／逆リンク先／ゲート・検証の残課題}`。**列挙に Markdown の番号付きリストを使わない**——各行は `- **ID n**: ...` のように candidate の `id` を地の文で書く（番号付きリストはレンダラがリストごとに 1 から振り直し、採否の ID 指定とずれる。失敗接地: 2026-06-12 初回実走で連番ずれが起きユーザ指摘で発覚）。`done_candidates`（完了根拠の逐語引用と `quote_verified`）も列挙する。**`quote_verified` は drain 抽出 subagent の自己照合（subagent が自分の context 内で evidence_quote が inbox 本文に包含されることを確認した結果）であり、workflow 側の再照合は v6 plan で廃止した**（drain mode では full inbox 本文が workflow に流れず再包含照合できないため・YAGNI で path 単位の再照合 Read agent は別 cycle 候補）。`quote_verified: false` の done 候補は「subagent 自己照合で inbox 本文への包含が確認できなかった」ことを明示して提示する（黙って落とさない・黙って通さない）——人が証跡の妥当性を判断する。**`DUPLICATE_DETECTED` ログが出た候補（done_candidates と promotions が同じ `inbox_origin` で重複検出された組）は両方提示し、人に重複解消を委ねる**（drain 抽出 subagent の prompt 内 order 強制と排他指示が機能しなかったケースのフェイルセーフ。片方を勝手に落とさない）。**洞察候補は `derivation.common_axis` を逐語で必ず表示する**（各 source の回避法／共通点も添える）。common_axis は洞察タイトルの導出元かつ成立判断の材料なので、**これを出さずに洞察候補を採否にかけない**（タイトルだけ見て通すと、claim 起点・手元の像で命名した未成立の洞察を見逃す。失敗接地 2026-06-15: common_axis を提示せず洞察を一度 unresolved/破棄→手順を実走して common_axis から再導出したら成立した）。common_axis が単純合算でない判断軸になっているか人が確認する。`derivation_ok: false`（チェックリスト未充足）は明示する。**気づき候補は `derivation.lesson_axis` を逐語で必ず表示する**（各 `source_observations` の抜粋／`pattern_generalization` の抜粋／`generalization_check` も添える）。`pattern_generalization` は subagent の中間抽象化過程の出力（事例に固有でない構造を 1 文で抽出した結果）で、`lesson_axis` が単なる事例の言い換えに止まっていないかを人ゲートで判定する第 1 材料（事例に固有でない一般語に置換された 1 文として読む）。lesson_axis は気づきタイトルの導出元かつ「個別事象に張り付いた一般化でないか」の判定材料なので、**これを出さずに気づき候補を採否にかけない**（個別事象・実装意図・事実記述を気づき層に上げて drop されるパターンへの第 1 防御線。失敗接地 2026-06-27 drain 18 回目: 気づき drop 率 75% を観察したが命名ゲートは事実記述/実装意図/個別事象を素通しさせていた）。lesson_axis が一般語の主語で機序/教訓を名指しているか人が確認する。`derivation_ok: false`（チェックリスト未充足）は洞察と同型に明示する——自動ブロックしないので人が個別事象・実装意図・事実記述でないかを判断する。採否入力は 4 件以下なら AskUserQuestion の multiSelect でもよいが、5 件以上は番号指定で答えさせる（列挙は常に本文・選択肢からの除外で候補を落とさない）。

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
- `quote_verified: false` の done 候補を黙って通す・黙って落とす（subagent 自己照合で証拠が inbox 本文に包含されなかった旨をトリアージに明示して人に委ねる。workflow 側の再照合は v6 plan で廃止済み——drain では subagent 自己申告のみが照合結果）
- 運用ログを形骸化させる（重くして書かなくなるのが最大の失敗。done 訂正の記録は承認ループの副産物に留め、最小テンプレで書く）
- `imports/kindle/` `imports/wallabag/` の編集・リネーム
