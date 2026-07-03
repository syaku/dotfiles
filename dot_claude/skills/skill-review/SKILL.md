---
name: skill-review
description: 任意の自作 skill（オーケストレータ／単発を問わず）の改善点を3ソース（静的レビュー / 実運用トレース分析 / 実走観察）×4軸（フェーズ設計・委譲構造 / プロンプト・指示の品質 / 失敗・抜け穴の堅牢性 / 成果・目的整合）で洗い出し、根拠付きの改善点レポートにまとめる評価スキル。評価パイプライン（抽出・批評・逐語裏取り・支持判定・畳み込み）は skill-review-pipeline workflow（~/.claude/workflows/skill-review-pipeline.js）に決定論オーケストレーションとして委譲し、本体は対象確定・Workflow 起動・レポート Write・実走観察の承認ゲートに徹する。引用の実在照合・破棄・深刻度格上げ・件数集計は script がコードで実行するため自己申告に依存しない。既定は full（静的＋トレース）で、/develop は既存 skill 改修の **plan 前段（step 0.5）で full を 1 回**回し plan の参照入力にする（develop の post-implement ループの収束計器としては使わない——そちらは code-review）。mode: static は静的レビューのみの軽量 standalone 実行として残す。「<skill 名> を評価して」「skill-review <skill 名>」「<skill 名> の改善点を出して」などの依頼で起動する。
---

# skill-review: 任意自作 skill の評価

自作 skill（計画→実装→…の多段オーケストレータでも、単発の処理 skill でも）の改善点を、繰り返し当てられる評価の型として洗い出すスキル。**評価対象は引数で受け取る**（後方互換は持たない）。対象 SKILL.md の内容から委譲先・subagent 起動・外部 IO を自動抽出し、必要メタ情報を skill 側に持たせない。

評価の主要工程（抽出・引用の機械照合・静的批評・トレース分析・逐語裏取り・支持判定・畳み込み）は **skill-review-pipeline workflow**（`~/.claude/workflows/skill-review-pipeline.js`）に委譲する。引用の実在照合・指摘の破棄・深刻度の格上げ・件数集計は workflow script が**コードで決定論的に実行**するため、LLM の自己申告（「再照合した」「悉皆でやった」）に依存しない。本体の責務は対象確定・Workflow 起動・レポート Write・実走観察の承認ゲートのみ。

評価は3ソース（静的レビュー / トレース分析 / 実走観察）×4軸で行う。**4軸は全フェーズを通して固定**で、これ以外に広げない:

- **フェーズ設計・委譲構造** — フェーズ分割の妥当性、skill 委譲・subagent 起動・外部 IO（Bash curl／WebFetch／filesystem 直書きなど）の住み分け、引き継ぎ（context の受け渡し）。
- **プロンプト・指示の品質** — 各フェーズ／subagent への指示の曖昧さ・冗長・抜け。
- **失敗・抜け穴の堅牢性** — ガード破り、データ／context ロスト、暴走の余地。
- **成果・目的整合** — skill の成果物が SKILL.md 冒頭の目的を達成したか。下流の運命（承認・訂正・差し戻し・作り直し）とゲートの採否精度を、規約遵守とは独立に評価する。トレースが主戦場で、静的には「成果の良し悪しが観測可能に定義されているか」のみを問う。下流が見えるのは同一セッション内まで（セッションを跨いだ帰結は射程外）。

## 厳守プロトコル

- **評価対象のスキル本体・委譲先を変更しない。** read-only の評価に徹する（改善の適用は別タスク）。
- 本体が使うのは Read/Glob/Grep/Write（レポートのみ）/Workflow/AskUserQuestion と、step 0 の読み取り系 Bash（`chezmoi diff` 等）のみ。**本体から直接 Agent で批評・検証を fan-out しない**（オーケストレーションと照合を決定論層に置いた設計の骨抜き）。
- **workflow 戻りの `findings` / `dropped` を本体で要約・取捨・マージしない。** script が確定した生の N 件をそのまま提示する。破棄された指摘（dropped）も件数と理由を隠さない。
- skill フロントマターに `disallowed-tools` を**置かない**——`Skill` tool は main で動くため、スキルが active な間呼び出し元まで巻き添えでツールを失う（失敗接地: 2026-06-11、plan スキルで確認済みの構造）。

## モード

- **full（既定）**: 静的批評＋トレース分析。終了時に実走観察（step 4）を提案する。**/develop は既存 skill 改修の plan 前段（step 0.5）でこの full を 1 回**回し、レポートを plan の参照入力にする（改修前バージョンのトレースが plan の設計入力として活きる位置）。
- **static**: 静的批評のみ（トレース分析・実走提案を省く軽量実行）。呼び出し時に明示指定されたときだけ使う **standalone 軽量実行**。かつて /develop の post-implement ループでレビュー計器として毎ラウンド使っていたが、per-run の detection turnover で収束しないため develop 側を code-review に切り替えた（static の develop 計器利用は廃止。standalone 用途として残す）。

## フロー

### 0. 対象 skill の確定

引数 `<skill-name>`（kebab-case 1 語）を必須で受け取る。

- **引数なしで起動された場合**: 「`/skill-review <skill-name>` を指定してください（例: `/skill-review develop`）」と告知して停止する。
- **形式バリデーション**: 引数は正規表現 `^[a-z][a-z0-9-]*$` に従う必要がある。形式違反のときは「引数 `<received>` は kebab-case 1 語の形式に従いません（正規表現 `^[a-z][a-z0-9-]*$`）。**plugin namespace 形式（`plugin:skill` のようにコロンを含む語）は受け付けません — plugin skill は SKILL.md 精読不可で評価不能です**。typo の場合は再指定してください」と告知して停止する。
- **対象 SKILL.md パスの解決と全文取得**: `~/.claude/skills/<skill-name>/SKILL.md` を Read で実在確認すると同時に**全文をメモリに乗せる**（step 1 で `args.skill_md_text` に渡すため。head 等での一部読みでなく完全読み込み）。不在なら「対象 skill `~/.claude/skills/<name>/SKILL.md` が見つかりません。**対象は自作 skill に限ります（ビルトイン skill・plugin skill は SKILL.md 精読不可で評価不能。typo の場合は kebab-case 1 語で再指定してください）**」と告知して停止する（ビルトイン／plugin と typo が一律不在エラーで潰れないようメッセージで理由を分離）。
- **chezmoi 管理下の source/target 整合の確認**: 対象 SKILL.md は target で解決するが、**chezmoi 管理下では target が source の apply 待ちで stale になりうる**。最新の改修が target に反映されていない疑いがあるときは `chezmoi diff` で差分を確認してから評価せよ（差分があれば改修前の target を評価してしまい、改修の効能検証として無意味になる）。失敗接地: 2026-06-10、source 改修→target 未 apply の状態で `/skill-review skill-review` を回すと改修前 target を評価する潜在事故が code-review で発覚。
- モードを確定する（明示指定が無ければ full）。

### 1. pipeline 起動

`Workflow` tool を以下で起動する:

- `scriptPath`: `~/.claude/workflows/skill-review-pipeline.js`
- `args`（JSON オブジェクトとして渡す。文字列化しない）:
  - `skill_name`: 解決済み skill 名
  - `skill_md_path`: 対象 SKILL.md の絶対パス
  - `skill_md_text`: **step 0 で Read 済みの対象 SKILL.md 全文を必ず渡す**。script は引用照合に使う。これを args で渡すことで抽出 agent に全文をエコーさせず output token の直列ボトルネックを避ける（失敗接地: 2026-06-12 抽出フェーズが対象＋全委譲先 SKILL.md を structured output に逐語エコーして数分〜十分単位で律速されていた事象。原因と対処は 2026-06-13 inbox ノート参照）。
  - `mode`: `full` または `static`
  - `max_trace_sessions`: 任意（省略時 5。新しい順に選択され、超過分は script が log で明示する）

パイプラインの構成（script 側に encode 済み・本体から重複指示しない）: 抽出（委譲・subagent・外部 IO のメタデータのみ。委譲先 SKILL.md の本文はエコーさせない。引用は script が SKILL_MD_TEXT への包含判定で機械照合し、不一致は 1 回だけ再抽出）→ 静的批評とトレース分析の独立並列（委譲先の精読は批評 agent が Read tool で取りに行く）→ 裏取り（対象 SKILL.md 由来の静的指摘は script が SKILL_MD_TEXT に直接照合。委譲先その他のファイル由来は echo agent で原文取得 → script の包含判定で照合。全トレース由来＋全 severity:high は検証 agent の反証視点＋script 照合で悉皆。トレース由来は現行 SKILL.md への対処済み突合——`addressed_in_current`——を含む）→ 畳み込み（同一軸内の重複統合・裏取り通過したトレース顕在化の 1 段格上げ（現行版対処済みは除く）・集計）。

### 2. 戻り解釈

workflow は `{extraction, findings, dropped, traces, totals, flags}` を返す（件数・破棄・格上げは script がコードで計算済み。schema は script 冒頭の定義を参照）。本体の処理:

1. **sanity check（一瞥確認）**: `totals.count` が `findings.length` に一致すること。script 計算なので破れない設計だが、script 改変事故の検知としてだけ見る（不一致なら script のバグなのでユーザに報告して停止）。
2. **`flags` の確認**: 未実施・欠落の軸を「実施済み」として装わない——`static_failed` は静的軸の欠落、`trace_discovery_failed`／`traces.analyst_failures` はトレース軸の欠落（または部分欠落）としてレポートに明記する。`extract_unverified` は抽出テーブルの該当項目に未照合マークを付す。`dedup_failed` は重複未統合のまま提示する。`support_verify_incomplete` の該当指摘は破棄せず「支持判定未完」のまま提示する。`static_echo_incomplete` は委譲先その他ファイル由来の静的指摘について echo agent が結果を返さず引用照合が完了しなかった件数（該当指摘は破棄せず `quote_verified=false` のまま「引用照合未完」として提示する。echo が動いて found=false / quoteIn 失敗だったケースは別途 dropped に入る）。`traces` の自己参照ガードカウンタ（`dedup_removed` / `evidence_rejected_script` / `evidence_rejected_echo` / `evidence_echo_failures` / `scout_needle_hits` / `scout_excluded_no_launch`）はガードの正常動作による除外の可視化であって機構の失敗ではない——レポート冒頭のトレース重み行に件数を併記する。`sessions_found` は実走判定を通過して scout が返した件数（needle の grep ヒット数ではない）、`sessions_dropped` は検証通過分のうち上限超過で未分析の件数に意味が変わっている。
3. **findings 表に未照合マーク**: `quote_verified=false` の指摘には未照合マーク（例: `⚠️ 引用照合未完`）を付して提示する。script の機械照合を通過していない状態をユーザに見えるようにする。
4. `findings[].severity`・`escalated`・`addressed_in_current`・`dropped` を本体で再分類・復活・隠蔽しない。
5. **`addressed_in_current=true` の指摘は「現行版で対処済み（改修の効能確認）」**——script が現行 SKILL.md の逐語引用の機械照合で確定した印で、現行への改修判断からは外れる。レポートでは findings 表に混ぜず別節で提示する（step 3）。`totals.addressed_in_current` が件数。

### 3. レポート組み立てと Write

レポートは本体が組み立てて Write する（workflow はファイルに触れない）。構成:

- **冒頭にソースの重みを明示** — 既定は静的（主体）＋トレース（補助。`traces.sessions_analyzed` 件のケーススタディと件数明示。0 件なら「トレース未取得」）。static モードなら静的のみと明記。実走観察（step 4）は承認時に加わる 3 つ目のソース。
- **検算ハンドル（抽出テーブル）** — `extraction` の委譲先（精読可否・行番号・逐語引用）・subagent・外部 IO を中間出力として載せ、対象 SKILL.md の実態と照合可能にする。**精読不可委譲先（`unreadable_delegates`）は評価範囲の穴として明記**する。
- **縮退表記** — `extraction.degenerate` が `no-delegation` なら「委譲構造: N/A: 委譲先なし（subagent 起動・外部 IO のみで完結）」、`dialog-only` なら「委譲構造: N/A: 対話完結（外部 IO・subagent なし）」と書く。軸は抹消しない（フェーズ設計＝内部ステップの分割妥当性はどの skill にも問える）。
- **findings 全件の表** — `{軸, 指摘, 根拠の逐語引用, ソース（静的／トレース。併記あり）, 深刻度（escalated なら格上げ印）, 改善提案}`。深刻度ルーブリックは 3 段（高=ガード破り・データ／context ロスト・目的不達成（成果物が下流で覆された）、中=指示の曖昧さ・冗長・住み分け不明、低=文体・可読性）。
- **「現行版で対処済み」の分離提示** — `addressed_in_current=true` の指摘は findings 表に混ぜず、別節「現行版で対処済み（改修の効能確認）」に件数付きで列挙する（隠さない。過去バージョンの実走に当該失敗様式が実在した確認として価値を持つ）。
- **dropped 全件** — `{指摘, ソース, 破棄理由}`。機械照合・支持判定で何が落ちたかの透明性を確保する（黙って消さない）。

出力先・命名:

- **出力先は呼び出し時に指定**できるが、**既定は Obsidian の `~/workspace/notes/obsidian/Life/inbox/`**（capture inbox。後で `/drain` が notes/ へ昇格させる運用）。frontmatter は付けてよいが notes テンプレ強制はなく、本文 H1 は置かない。永続化を Obsidian にするのは 作業スペース が削除されうるため。中間作業物のみ 現在の作業スペース 配下。
- 既定 basename: `<YYYY-MM-DD> skill-review-<対象 skill 名>.md`。同日同 skill の再評価は時刻サフィックス `<YYYY-MM-DD>T<HH:mm> ...` で上書きを避ける。呼び出し時の明示 basename があれば優先。

### 4. 実走観察（full のみ・別建て・承認ゲート）

性質（実装系スキルの起動・ユーザ承認・コスト）が他と違うため別フェーズにする。**skill-review 本体からは自動実行しない。** ユーザ承認の上で、小規模なサンプルタスクを対象 skill で 1 回実走させ、新規トレースを作る。

- トレースが薄いうちは、**初回適用ではこのフェーズを「既定で提案」する**（任意に倒しきらず、やる前提でユーザに諮る）。トレースが貯まれば省略可。
- **サンプルタスクは副作用が小さいものを選ぶ**。対象 skill が破壊的副作用（git push / chezmoi apply / 外部 API 課金 / 大規模ファイル削除）を持つ場合は実走をスキップし、既存トレースのみに閉じる。実走の有無は承認時に明示する。
- 実走後は pipeline を再起動して新トレース込みで再評価し、レポートを時刻サフィックス付きで再 Write する（トレース探索は動的なので新セッションを自動で拾う）。

## workflow との interface

正本は `~/.claude/workflows/skill-review-pipeline.js`（chezmoi source: `dot_claude/workflows/skill-review-pipeline.js`）。script 側を変更するときは本体 step 1（args）/ step 2（戻り schema）との整合を確認する。

script に encode 済みの判断系規約（本体・script のどちらを変えるときも保持する）:

- **逐語引用の機械照合**: 引用が原文への包含判定（空白差吸収）に失敗した指摘は script が破棄し `dropped` に記録する。行番号だけの根拠は構造的に通らない（失敗接地: 2026-06-09、finder が実在する行番号 L30/L52 を引きつつ「ガード無し」と中身を捏造。実ファイルには当該ガードが実在した）。
- **悉皆の支持判定**: 全 severity:high＋全トレース由来は、検証 agent の反証視点で「引用が指摘を実際に支持するか」まで判定する。サンプル化しない（失敗接地: 2026-06-09、高深刻度 3 件の捏造＋未読トレースの捏造事象。2〜3 件サンプルでは取りこぼす構成だった）。
- **格上げは裏取り通過後のみ**: トレース顕在化による 1 段格上げは、機械照合＋支持判定を通過した指摘だけに script が適用する（失敗接地: 2026-06-09、捏造トレース事象が「顕在化したから高」と格上げされかけた。格上げ規則が捏造を増幅する逆効果の防止）。
- **例示・注記・対比を委譲に数えない**: 抽出は role（call / example-or-note）を判別する（失敗接地: develop SKILL.md の「`Skill: implement` ではなく `Agent` で…」のような注記は対比であり実呼び出しではない）。
- **plugin 配下 SKILL.md も精読可**: `~/.claude/plugins/marketplaces/*/skill-sources/` を Glob で動的解決する（失敗接地: 2026-06-10、plugin 探索を落とした初版で `verify` が誤って精読不可扱いになるリグレッション）。
- **指摘ゼロは正当・軸ごとの件数ノルマなし**: 「軸ごとに 1 件以上」の網羅をしない（観点インフレ禁止。失敗接地: 2026-06-10、plan SKILL のレビューで観点インフレ observed——同じ批評 agent 類型への移植）。
- **ケーススタディの正直表示**: トレース分析は件数を明示し統計的一般化をしない（「いつも」「毎回」と書かせない）。
- **トレース探索は cwd を限定しない**: jsonl path は cwd 依存のため、特定 cwd に絞ると他 cwd セッションを取りこぼす。session ID のハードコードもしない。
- **実走証跡の機械照合（fail-closed）**: トレース候補を scout の自己申告で採らない。実走イベント行の逐語証跡を script が構造マーカー（tool_result の content が丁度「Launching skill: <name>」である行の非エスケープ JSON 断片）包含とセッション配下判定で照合し、さらに echo agent の独立読取を script が照合して通過分だけを分析に回す。echo が結果を返さないセッションは分析対象にしない（失敗接地: 2026-07-02、sear-me 評価で評価実行中のメタセッション——agent プロンプト内の文字列引用のみで実走ゼロ——が最新実走として拾われ、分析スロットを空振り消費した）。
- **トレース指摘の現行版突合**: トレース由来の支持判定は「現行 SKILL.md が当該失敗様式に対処済みか」まで判定し、`current_quote` が現行文面への機械照合を通過したものだけ `addressed_in_current=true` にする。対処済みは格上げしない・drop もしない（別節提示で効能確認として残す）。dedup 統合では全メンバーが対処済みのときだけ維持する——静的由来（現行文面が根拠）と統合されたら現行の指摘に戻る（失敗接地: 2026-07-03、sear-me 回帰評価でトレース内にエコーされた旧 SKILL 文面を規範として引用した前提不成立の high 指摘 2 件が、照合・支持判定を正しく通過した上で格上げ増幅されて提示された）。規定の存在と実効性は区別する——実走当時から存在した規定が破られた「ガード破り」型は、現行に同じ文面があっても対処済みにしない（失敗接地: 2026-07-03 の初回実走で、規定既存の違反 2 件——mkdir 実行・複数問同時出し——が対処済みへ誤分離された。同型の別 2 件は正しく現行指摘に残っており、verify agent 間で判定が割れていた）。
- **成果・目的整合軸の住み分け**: トレースが主戦場（成果物と下流の運命を同一セッション内で追う。成果物ファイルの Read 可）、静的は「成果の良し悪しが観測可能に定義されているか」のみ。件数ノルマ禁止・逐語照合・悉皆支持判定は他軸と同一に適用する（軸の追加は観点インフレの解禁ではない）。

## 撃ち直した残差の記録（2026-06-12 Workflow 化で前提条件が消えた防御）

旧設計（単一 read-only subagent への prompt 委譲＋main の規律による再照合）の失敗接地由来の防御のうち、以下は**構造変更で前提条件が消えたため形を変えた**。元の失敗が新構造で再発したら、該当の錨ごと復活させる:

- **main による抽出テーブルの目視照合**→ 引用照合は script の包含判定に置換され、main の目視は不要化。検算ハンドル自体はレポート冒頭の中間出力として残置（ユーザの目視可能性は維持）。
- **main による「統合前 grounding 再照合（高・トレース悉皆）」の規律**→ script がコードでループを強制し、再照合の実施が LLM の規律でなく構造になった（2026-06-09 の捏造事故由来。検証の実体は検証 agent＋script 照合に移った）。
- **「読み取り系を 1 read-only subagent に統合」する圧縮**（評価対象と同型の多段オーケストレータ化の禁止由来）→ 「多段管理を main の LLM がやらない」という元の趣旨は、オーケストレーションの script 移譲でそのまま保たれた。批評・分析・検証の fan-out が可能になったため、禁止は「main 本体から直接 Agent fan-out しない」に撃ち直し。
- **抽出 agent に対象＋全委譲先 SKILL.md の全文を structured output で吐かせる**（初版 Workflow 化の機械照合要件由来。workflow script は filesystem に直接アクセスできないため LLM 経由で原文を取り込む案だった）→ output token が autoregressive で直列生成・キャッシュ無効でフェーズ律速になることが判明（失敗接地: 2026-06-12〜13、抽出フェーズが数分〜十分単位で律速）。対象 SKILL.md は main の step 0 で Read 済みなので **`args.skill_md_text` 経由で script に渡す**形に撃ち直し。委譲先 SKILL.md は **批評 agent が Read tool で取りに行き、引用照合は finding 単位の echo agent + script の包含判定**に置換（trace 由来引用で既に確立しているパターンの流用）。「機械照合は決定論的に行う」という規約は維持。

## ガード

- 評価対象のスキル本体・委譲先を**変更しない**（read-only。改善の適用は別タスク）。
- 実走観察（step 4）を**ユーザ承認なしに自動実行しない**。
- 評価軸は4つに固定する。トークン／コスト効率、委譲先スキル単体の改善、常設インフラ化は対象外。
- **対象は自作 skill に限る**（ビルトイン skill・plugin skill は SKILL.md 不在で評価の足場が立たない）。
- **引数なし／不在 skill 名で起動された場合は早期に停止する**（step 0 のバリデーション。後続フェーズに進めない）。

## やってはいけないこと

- 評価対象や委譲先のファイルを編集する（read-only 評価のはずが実装に踏み込む）。
- **workflow を介さず本体から直接 Agent で批評・検証を fan-out する**（照合と集計を決定論層に置いた設計の骨抜き。LLM 自己申告ベースの再照合に巻き戻る）。
- **workflow 戻りの `findings` / `dropped` を要約・取捨・マージして件数を減らしてから提示する**（破棄理由ごと見せる。生の N 件＝提示の N 件）。
- **`findings[].severity` / `escalated` を本体で再分類する・dropped の指摘を本体判断で復活させる**（script の決定論判定を main の解釈で上書きしない）。
- **`flags` を無視して「全軸実施済み」として提示する**（未実施・欠落の軸は未実施と明示する）。
- **精読不可の委譲先**を黙って評価対象から落とす、または精読したかのように書く（評価範囲の穴はレポートに明記する）。
- 実走観察を承認なしに自動で回す。
- 改善点レポートを 作業スペース 配下だけに残す（作業スペースは削除されうる。永続化は Obsidian）。
- **script の判断系規約（機械照合・悉皆支持判定・裏取り後格上げ・例示除外・plugin 精読・観点インフレ禁止・実走証跡照合・現行版突合・成果整合軸の住み分け）を prompt から削る**（interface 節参照。モデル能力でなく判断方針の規約で、Opus 前提でも残す）。
