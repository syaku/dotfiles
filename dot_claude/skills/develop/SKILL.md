---
name: develop
description: 計画→実装→レビュー→修正→レポートを回す開発オーケストレータ。各フェーズは既存スキル（plan・implement・code-review／skill-review 等）に委譲する。「全部おまかせで開発して」「フルプロセスで」などの依頼で起動する。
---

# develop: 開発オーケストレータ

計画から実装、レビュー、修正、レポートまでを回す「**ファイルベースの実行台帳を持つ薄いステートマシン**」。各フェーズは既存スキルに委譲し、develop 本体は順序・引き継ぎ・ゲートの管理に徹する。フェーズ間の引き継ぎは main context の記憶でなく実行台帳 `develop-log.md` を正本とする（compaction・セッション中断をまたいで resume できる）。

## 実行台帳 develop-log.md

- 置き場所: `<現在の作業スペース>/develop-log.md`（plan.md と同居）。step 0 で frontmatter を作成し、以降は各フェーズ完了時に 1 エントリ追記する。
- **append-only はエントリ列に適用**する。既存エントリは書き換えない。frontmatter の `status` と `current_phase` のみ可変（in-place 書き換え可）。
- **各フェーズの開始時に必ず台帳を Read してから着手する**（引き継ぎの正本。main context の記憶を頼らない）。
- frontmatter: `task`（依頼の一文）/ `track: code|skill` / `status: in-progress|converged|non-converged|aborted` / `current_phase`（着手マーカー。**各フェーズの開始時に更新する**）。`non-converged`＝ゲート (c) の報告を経て非収束のまま完走した状態。`aborted`＝ユーザの中断指示でタスクを畳んだ状態（develop が設定。resume 対象にしない——再開はユーザの明示指示があるときだけ）。
- エントリ形式: `## [N] <フェーズ名> — <ISO 時刻>`。フェーズごとの必須フィールド:
  - `plan`: plan.md パス・承認結果
  - `implement`: 作業ツリー cwd・変更ファイル一覧・テストコマンド・検証結果
  - `review`: 計器（code-review / skill-review static）・ラウンド番号・指摘件数と指摘リスト
  - `fix`: 対応概要・自己確認結果・変更ファイル一覧（implement エントリから増減があった場合）
  - `report`: 出力パス
- **ラウンド計数＝台帳の review エントリ数**（初回レビューが Round 1。`--fix` 統合経路も「review(+fix)」エントリ 1 件で 1 ラウンド）。記憶で数えない。
- エントリ schema の厳密度（自由記述をどこまで構造化するか）は **v1 で運用を観測してから決める**（初版は必須フィールド＋自由記述。resume・レポートが読み損ねる観測が出てから構造化度を上げる）。

## ゲート（3 つだけ。フェーズ間確認は持たない）

- **(a) plan 承認** — plan スキル内蔵（develop は所有しない）。develop 側に残るのは順序ガードのみ: **plan 承認が台帳に記録される前に実装系 Agent・レビュー収束 skill を起動しない**。**ただし step 0.5 の pre-plan skill-review はこの順序ガードの対象外**——これは「plan への入力生成」であって実装系でも収束ループのレビュー計器でもない（read-only 評価。plan の前に走るのが本来の位置）。この分類は本ガードと「やってはいけないこと」節の同文禁止の双方に効く。
- **(b) 副作用前承認** — develop 所有。**chezmoi apply・commit・push・外部公開を伴う書き込みの前に承認を取る**（Obsidian 等の私的ノート出力は対象外）。skill トラックのレビュー・収束で発生する chezmoi apply は、**最初の apply の前（step 3 Round 1 のレビュー前 apply を含む）**に「以降のレビュー・収束ループ中の apply」を包括承認として 1 回取る（承認範囲は Round 1 から収束までの全 apply。ラウンドごとに確認を挟まない）。**包括承認の取得結果と承認範囲（対象ファイル・期間）は台帳に記録する**（main context の記憶だけに置くと、compaction・resume 後に未承認のまま apply が走るゲート破りの経路になる）。承認範囲の境界は**タスクの改修対象 skill 単位**（期間は Round 1 から収束まで）: fix で編集対象が同一 skill 内で増えた場合は範囲内として台帳の承認記録に追記し、**改修対象 skill の外のファイルへ apply が及ぶ場合のみ再承認を取る**（境界を編集ファイルの増減の解釈に委ねない）。resume 時は台帳の承認記録を確認し、記録が無ければ取り直す。
- **(c) 非収束時の報告** — develop 所有。次のいずれか早い方で発火する: **(c-1) 上限到達**——台帳の review エントリが 5 件に達してなお指摘が残る。**(c-2) 前進なし**——Round 2 以降で、そのラウンドの残指摘件数が前ラウンドから厳密に減っていない（修正の空転か plan 側の誤りのシグナルなので、上限を待たずに報告する）。件数比較は台帳の review エントリに記録した指摘件数で行う（記憶で数えない）。いずれの場合も黙って打ち切らず残指摘をユーザに報告してから次へ進む（旧上限 3 からの変更 2026-07-03: 計器の code-review 化・cleanup 段・TDD メイン化でラウンドの単価と信頼性が変わり、台帳 19 件中 4 件が旧上限で非収束だった。前進なし検出の追加で、空転タスクは旧上限より早くユーザに戻る）。skill トラックの報告には**「非収束の変更が target に apply 済みのまま稼働している」事実と、source revert＋再 apply で巻き戻せること**を必ず含める（未収束の skill が現役で動き続けることをユーザから見える形にする）。この経路で step 5 へ進むときは台帳の `status` を `non-converged` にする（`converged` と区別する）。

委任後は確認なしで進み、事後報告とする。

## トラック dispatch（code / skill）

入口（step 0）で判定し、台帳 frontmatter に記録する。計器は本表で引く:

| | code トラック | skill トラック |
|---|---|---|
| 判定 | 下記以外のコード開発 | 改修対象が `~/.claude/skills/` 配下の SKILL.md・プロンプト文書（chezmoi source 側 `dot_claude/skills/` を含む）、および skill を構成する workflow js・補助 script。**SKILL.md と js の混在変更も skill トラックとし、計器は code-review 一本**（SKILL.md/js 両対象。skill 固有の全体評価は step 3 でなく pre-plan の skill-review が担う——下記「skill トラックの review 配置」） |
| レビュー計器（step 3） | `Skill: code-review`（effort は依頼の重要度に応じる。既定 medium） | `Skill: code-review`（SKILL.md＋js を一本でレビュー。effort 既定 medium）＋**名前参照追跡**（指摘が言及するガード／収束条件／台帳記録の定義箇所を diff 外でも develop 本体の Read で確認し非局所結合の崩れを検出）。**skill-review は step 3 では使わない**（noisy 計器の収束ゲート利用を撤去。skill 全体評価は pre-plan へ前倒し） |
| 修正後の客観確認（step 4） | 台帳の implement エントリのテストコマンドを **develop 本体の Bash で同一作業ツリーで再実行** | `chezmoi apply` → `chezmoi diff` が空であることを確認 → **code-review 指摘ゼロ＋名前参照追跡 pass** |

- **skill トラックの review 配置**: skill 全体の評価（skill-review full）は **plan の前段で 1 回**回し plan の参照入力にする（step 0.5）。post-implement の step 3/4 は **code-review（diff ベース）＋名前参照追跡**で回す——skill-review を毎ラウンドの収束ゲートに使うと per-run の detection turnover で収束しない構造だったため、収束ゲートから外した（撃ち直し記録は「撃ち直した残差の記録」節）。
- skill トラックの注意: step 3/4 の code-review は apply 後の作業ツリー（target 反映済み）に対する diff を見るため、各ラウンドのレビュー前に source の編集を apply する（ゲート (b) の包括承認 1 回で回す）。pre-plan の skill-review full は read-only 評価で apply を伴わない。
- code トラックの非コード成果物（diff に出ない設定・ドキュメント）は code-review に明示パスで読ませる（diff が無いと空振りする）。skill トラックでも SKILL.md/js が diff に出ない場合は同様に明示パスを渡す。

## フロー

### 0. 入口判定

判定順:

1. タスクディレクトリを特定する（依頼文のパス指定、または 作業スペース の既存ディレクトリ検出。新規なら 作業スペース の命名規則で作る）。
2. `develop-log.md` あり → **resume**: 台帳を Read し、`current_phase`（着手マーカー）と最終完了エントリを突き合わせる。着手マーカーが最終完了エントリより先＝フェーズ途中の中断なので、**作業ツリーの dirty 状態（部分編集の残り）を確認してから**そのフェーズをやり直す（未記録の変更との二重適用を避ける）。dirty だった場合は差分の要約を提示し、**「残存変更を活かして続行／破棄してやり直し」をユーザに確認する**（黙って破棄しない）。一致していれば最終エントリの次のフェーズから再開する。
3. `plan.md` のみあり（台帳なし）→ **途中参加**: 承認状態が台帳に無いため、**develop 自身が plan.md の要点を提示して AskUserQuestion でゲート (a) を取り直してから**実装フェーズへ（plan スキルは再起動しない。ゲート (a) の所有は plan のまま、途中参加時の代行のみ develop が担う）。frontmatter 作成後、**plan エントリ（plan.md パス・代行承認の結果）を台帳に追記してから step 2 へ進む**（順序ガード「plan 承認が台帳に記録される前に実装系を起動しない」の充足を経路上で閉じる）。
4. `premise.md`（status: final）のみあり → step 1（plan）から。premise の自動検出は plan 側の既存契約に乗る。
5. 何も無し: 依頼が曖昧（目的（Purpose）・受入条件（Acceptance）のいずれかが不明）なら `Skill: sear-me` を先に回してから step 1 へ（args に step 0 で確定したタスクディレクトリを含め、premise.md の出力先をそこへ固定させる——premise.md / plan.md / 台帳の同居を経路全体で維持する）。明確なら step 1 直行。

resume（経路 2）以外の経路では、トラック（code / skill）を判定し、台帳の frontmatter を作成する（経路 3 内の frontmatter 作成はこの具体化）。resume では既存 frontmatter の `track` を引き継ぎ、再判定・再作成しない。

**skill トラックの新規/既存判定（pre-plan skill-review の起動可否）**: skill トラックと判定された経路では、入口で一回限りの 2 段分岐を加える（トラック判定と対象が一致するので、新たな判定機構を新設せず skill トラック判定の延長として行う）:

- **対象 `~/.claude/skills/<name>/SKILL.md` が不在 = 新規 skill 開発** → step 0.5 の pre-plan skill-review を**自動バイパス**（評価する既存実体も改修前トレースも無い。ユーザ確認不要）。
- **対象 SKILL.md が存在 = 既存 skill 改修** → step 0.5 の pre-plan skill-review（mode: full）を**既定実行**。ただし依頼が小規模改修に見える場合は、**入口で一度だけ「pre-plan skill-review をバイパスするか」を提案**し、ユーザが承認したときだけバイパスする（既定は実行。「小規模」を develop が自前分類せず、バイパス側にユーザ承認を要求する）。これは**入口一回限りの分岐であって mid-flow ゲートにしない**（ゲートは 3 つのまま。pre-plan skill-review は「plan への入力生成」でゲート (a) の順序ガード対象外）。

この判定結果（バイパス有無）を台帳 frontmatter か plan エントリに記録し、resume 後に二重起動・未起動が起きないようにする。

### 0.5 pre-plan skill-review（skill トラック・既存改修・非バイパス時のみ）

入口判定で「既存 skill 改修 かつ 非バイパス」のときだけ実行する（新規開発・小規模バイパス承認時はスキップして step 1 直行）。

- `Skill: skill-review <name>`（mode: full）を **1 回**実行し、改善点レポートを生成させる（既定出力は Obsidian `inbox/`）。これは plan への**参照入力の生成**であって、実装でも収束ループのレビュー計器でもない（ゲート (a) の順序ガード対象外。L27 参照）。read-only 評価なので apply を伴わない。
- 生成されたレポートのパスを台帳に記録し、step 1 で plan へ**参照入力として渡す**（plan は `skill_review_report_path` で受ける）。full の trace 分析は改修**前**バージョンの実走トレースを使う（「この skill が実際どう詰まったか」を plan の設計入力にする——full が機能する正しい位置）。
- 実走観察（skill-review step 4）は skill-review 側の承認ゲートのままで、ここから自動実行しない（pre-plan がコストを暴走させない）。

### 1. plan

- `Skill: plan` を起動する（ゲート (a) の承認まで plan 側が担う）。**step 0.5 を実行した場合は args に pre-plan skill-review レポートのパスを含め、plan の参照入力として渡す**（plan 側の `skill_review_report_path`）。args に **step 0 で確定したタスクディレクトリ（＝台帳の所在）** を含め、plan.md の出力先をそこへ固定させる（「plan.md と台帳の同居」前提の維持。plan 側に別ディレクトリを新設させない）。
- 戻りの plan.md パスが**台帳と同ディレクトリであることを確認してから**、plan.md パスと承認結果を台帳に追記する（不一致なら同居前提が破れているので、plan.md を台帳と同ディレクトリへ移動し、移動後パスを台帳に記録してから進む。承認は取り直さない——内容は不変のため）。

### 2. implement

- 台帳を Read し、`Skill: implement` を起動する。args には **plan.md パス・develop-log.md パス・明示句「develop 経由（step 4 の承認ゲートを省略し結果返却のみ）」・副作用禁止の明示**（「commit / push / chezmoi apply / 外部公開を行わない。変更は作業ツリー内のファイル編集に限る」——step 4 の修正 subagent と同文。ゲート (b) の境界を implement 経由の実装 subagent にも伝搬させる）を含める。**長文の決定事項サマリは渡さない**（plan.md と台帳が一次ソース。implement は実装 subagent に plan.md を直接読ませる規約を持つので、3 層とも一次ソース直読みになる）。
- 戻り `{変更概要, 変更ファイル一覧, 検証結果（実行したテストコマンドを含む）, 作業ツリー cwd}` を台帳に追記する。
- `Skill` tool は main で動くため、implement 本体は main で動く。実装・検証・self-review・修正の各工程は implement が起動する implement-pipeline workflow 側の agent 群に隔離され、implement 本体に残るのは入力確定・本体 Bash の最終客観確認・承認/結果返却のみ（詳細は implement 側「実行モデル」節）。

### 3. review

- 台帳を Read し、トラック表で計器を選んで起動する。**起動前に、main の cwd が台帳 implement エントリの作業ツリーと一致することを確認する**（不一致のままだとレビュー対象の diff がずれる。計器に明示パスを渡せる場合は併せて渡す）。
- **skill トラックの名前参照追跡**: code-review 実行後、その指摘が言及する**ガード／収束条件／台帳記録**（「ゲート (b)」「収束条件」等の名前参照）の定義箇所を、diff に出ていなくても develop 本体の Read で読み、局所編集が遠隔の定義を無効化していないか（非局所結合の崩れ）を確認する。崩れを検出したら指摘として review エントリに追加する。これは skill-review-pipeline に委譲せず本体の Read で行う独立ステップだが、**ラウンド計数上は同一ラウンドの code-review に属する**（step 4 の連鎖単位を参照）。
- 指摘リストを台帳の review エントリに記録する（ラウンド番号＝台帳の review エントリ数）。
- step 2 の implement 内 self-review とは観点で住み分ける（self-review＝plan 突合専任——green 判定は implement の workflow script が検証結果から計算する、ここ＝correctness/quality の adversarial レビュー。典拠は各 description）。同じバグ探しを二重にしない。
- `code-review --fix` を使う場合の後続は step 4 の記述に従う（**--fix 規則の正本は step 4**）。

### 4. fix 収束

- 収束条件は**「指摘ゼロ かつ 客観確認 pass」**（code: テスト green／skill: apply → diff 空 → **code-review 指摘ゼロ＋名前参照追跡 pass**）。**客観確認の実行が 0 件の場合は pass と数えない**。0 件の判定はトラック別: **code トラック＝台帳の implement エントリにテストコマンド＝検証結果の実行記録が無い**（implement 側で `no_tests_run`=true のとき実行記録は 0 件＝台帳のテストコマンド欄が空になるため等価）、**skill トラック＝apply → diff 空 → code-review（＋名前参照追跡）の実行記録が台帳の review エントリに無い**（skill トラックはテストコマンド欄が空なのが正常形なので、その空を vacuous 判定に使わない。code-review 実行記録の有無で判定する）。判定はどちらも compaction 後も参照できる台帳に一本化する——客観確認 fail と同様に扱い、検証手段の不在自体を指摘として同じループで扱う（検証コマンドの確立を修正対象にする）か、確立できなければゲート (c) と同様にユーザへ報告する（vacuous converged＝実行ゼロ件のままの converged を成立させない）。満たしたら台帳の `status` を `converged` にして step 5 へ。レビュー指摘がゼロでも客観確認が fail なら収束とせず、失敗内容を指摘として同じループで修正する（その修正→再確認も通常どおりラウンド計数に乗る）。
- 修正担当 subagent（`subagent_type`: `general-purpose`）の prompt 必須項目: **指摘リスト・plan.md パス・develop-log.md パス・作業ツリー cwd（台帳の implement エントリから）・変更ファイル一覧（台帳の implement エントリと以降の fix エントリの union——Round 1 以降の修正で増えたファイルを後続ラウンドに漏らさない）・副作用禁止の明示**（「commit / push / chezmoi apply / 外部公開を行わない。修正は作業ツリー内のファイル編集に限る」——ゲート (b) は develop 本体所有なので、その境界を起こす subagent に伝搬させる）・自己確認指示（「修正後、修正したファイルを読み直し、(a) 各指摘に対応できているか (b) 他を壊していないか（regression）を自己確認し、対応概要に加えて自己確認結果も返してください」。修正の自己申告だけを信じず、客観確認は下の再実行で担保する）。**skill トラックでは加えて「編集対象は chezmoi source（`dot_claude/skills/` 配下）。target `~/.claude/` を直接編集しない。指摘中の target パスは source パスに読み替える」を必須項目に含める**（target 直編集は直後の `chezmoi apply` が stale source で上書きして修正がロストし、同じ指摘が再発してラウンドを浪費する）。
- **修正後の cleanup（simplify 1 段）**: 修正担当 subagent の編集完了後、続けて `Skill: simplify` を 1 回呼び、reuse / simplification / efficiency / altitude の品質クリーンアップを当てる（バグ探し・plan 突合は混ぜない——`/simplify` 本来の責務に従う。修正の代替ではなく、修正で生じた diff を後段の客観確認・再 review に持ち込む前に整える段＝implement-pipeline の cleanup ステージと同型）。simplify 起動の args にも上記の修正 subagent と同じ必須項目（副作用禁止の明示・skill トラックでは source 編集規約）を伝搬させる。**この修正 + cleanup の 2 段で 1 fix 単位**——下の変更ファイル突合・客観確認は cleanup 後の作業ツリーに対して行う。`simplify` が結果を返さなかった場合は cleanup の不在を fix エントリに明記し、修正適用後の状態のまま客観確認へ進む（cleanup の失敗で fix ラウンドを止めない＝implement-pipeline の `simplify_failed` 戦略と同型）。
- **fix の変更ファイル突合（code トラック）**: fix 完了ごとに develop 本体の Bash で `git status --porcelain` を台帳の implement エントリと同一の作業ツリーで実行し、修正 subagent の申告（変更ファイル一覧）と突合して差分を fix エントリに並記する（申告は書き換えない。implement step 3 の changed_files 突合と同型——自己申告だけを根拠にしない）。skill トラックでは apply 前の `chezmoi diff` 確認が同じ役割を担う。
- 修正後の客観確認はトラック表で引く（code: 台帳のテストコマンドを同一作業ツリーで再実行／skill: apply → diff 空 → code-review＋名前参照追跡）。**skill トラックの code-review 再実行は、下の収束ループの計器再実行と同一実行**（別に走らせない）。**1 ラウンドの連鎖単位を一意にする**: `apply → diff 空 → code-review → 名前参照追跡` の 1 連鎖が **1 ラウンド＝review エントリ 1 件**（名前参照追跡は本体 Read の独立ステップだが **code-review と同一ラウンドに含め、別ラウンドとして二重計数しない**。収束判定は「code-review 指摘ゼロ AND 名前参照追跡 pass」を 1 ラウンドの結果として台帳に記録し、上限（c-1）と前進判定（c-2）の計数起点を一意にする）。
- **--fix 規則（正本）**: step 3 で `code-review --fix` により修正を統合した場合、本ステップの修正適用はスキップする。ただし **--fix で修正済みでも解消確認のため最低 1 回は再レビューし、指摘が残れば通常経路と同じ収束ループ（上限 5・前進なし早期報告）**で回す。
- **再レビュー収束ループ**: 修正 → step 3 の計器を再実行 → 残指摘の修正、を**指摘ゼロ・前進なし検出（ゲート c-2）・台帳の review エントリ 5 件到達（ゲート c-1）の最も早いものまで**回す。各ラウンドの fix / review を台帳に追記し、Round 2 以降は毎ラウンド、指摘件数を前ラウンドと比較する（厳密減少していなければ c-2 発火）。ゲート (c) 発火時は残指摘を報告してから次へ進む（未検証のまま step 5 へ流さない）。

### 5. report

- レポート担当 subagent（`subagent_type`: `general-purpose`）に **develop-log.md と plan.md のパスを渡して直接読ませる**（サマリの手渡しをしない）。prompt 必須項目に副作用禁止を含める: 「書き込みは出力先ディレクトリ配下のレポートファイルに限る。commit / push / chezmoi apply を行わない」（ゲート (b) の境界の伝搬。修正 subagent と同旨）。内部で `obsidian:obsidian-cli` 等の既存スキルを活用してよい。
- 出力先は **Obsidian の `~/workspace/notes/obsidian/Life/inbox/`**（呼び出し時に明示パスがあれば優先）。
- 出力パスを台帳に追記し、レポートのパスをユーザに報告する。
- **変更の引き渡し**: 最終報告に未コミット変更の所在（作業ツリー cwd・変更ファイル一覧）を必ず含める（ゲート (b) の commit/push 承認への到達経路はここ——所在の提示を受けてユーザが判断する）。commit はユーザがそのターンで明示依頼したときのみ実行する（push 許可スコープ規範と整合。完走しても develop が自発的に commit / push しない）。
- オプション: code トラックでは step 5 の前に `verify` スキル（コード変更の動作確認用。Obsidian ノート検証の同名 `verify` とは別物）で動作確認を挟むと、レポートに「動作確認済み」と書ける（依頼の性質に応じて選択）。

## ガード

- **メタタスク（改修対象が SKILL／プロンプト文書）でも、step 4 の再レビュー収束ループは本来の規約（上限 5・前進なし早期報告）どおり回す。** 対象の失敗パターンが develop 側で再生産される懸念があっても予防的に打ち止めない（予防的な打ち止めは上流 skill 改善の不信任と等価）。実発生したらユーザと合意の上で下流 skill（plan / code-review / skill-review）の改修タスクを起票する。**失敗接地**: 2026-06-10、plan SKILL で観点インフレ observed。**検証実績**: 2026-06-11、蒸留スキル（現 /harvest）改修で本来のループが正常収束（Round 2 で指摘ゼロ）。

## 撃ち直した残差の記録（2026-06-12 台帳化で前提条件が消えた防御）

旧設計の防御のうち、以下は構造変更で前提条件が消えたため置換・撤去した。元の失敗が新構造で再発したら、該当の錨ごと復活させる:

- **「各フェーズの結果を main context に残し、次フェーズの prompt に組み込む」**→ 台帳のパス渡しに置換（compaction でロストする引き継ぎを構造で解消）。
- **「フェーズ間のユーザ確認は既定 ON。小タスクのみ通し」**→ 3 ゲート＋台帳に置換。「通し / 確認 ON」のモード概念ごと廃止（implement 内蔵ゲートとの未定義な重複も同時に解消。implement 側は args の明示句で承認分岐する）。
- **「self-review をスキップさせたら step3 は必須」**→ スキップさせる経路自体が消滅（implement は develop 経由でも plan 突合を必ず残す）。到達経路の無いガードのため撤去。
- **「skill トラックの step 3/4 計器は skill-review static」**→ **撤去**。skill-review を毎ラウンドの収束ゲートに使うと per-run 40〜50% の detection turnover で「指摘ゼロ」収束に到達しない構造だった（実測・2026-06 判別実験）。skill 全体評価は pre-plan の skill-review full に前倒しし（plan の参照入力）、step 3/4 は code-review（diff ベース・低 turnover）＋名前参照追跡に置換。**錨**: 「noisy 計器を per-round の収束ゲートに使う」構造が再発したら（例: 別の全文評価計器を step 3 に戻す）、この非収束が戻る。pre-plan 配置＋diff 計器の分離を保つこと。

## やってはいけないこと

- plan 承認が台帳に記録される前に実装系 Agent・レビュー収束 skill を起動する（**例外: step 0.5 の pre-plan skill-review は「plan への入力生成」で順序ガード対象外**。ゲート (a) の分類と整合。レビュー収束 skill＝step 3/4 の code-review とは別物）。
- 台帳を読まずにフェーズを開始する／既存エントリを書き換える（append-only。frontmatter の `status` / `current_phase` は除く）。
- implement へ長文の決定事項サマリを渡す（plan.md＋台帳のパスが一次ソース）。
- ラウンド数を記憶で数える（台帳の review エントリ数が正）。
- 非収束（上限 5 到達・前進なし）を黙って打ち切る（ゲート (c) で報告する）。前進なし（c-2）を「もう 1 ラウンド様子を見る」で先送りしない。
- 副作用（chezmoi apply・commit・push・外部公開）を承認なしに実行する（ゲート (b)）。
- implement の self-review と step 3 を同じバグ探しの二重レビューにする（住み分けは step 3 参照）。
