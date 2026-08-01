---
name: develop
description: 計画→実装→レビュー収束→draft PR→レポートを回す開発オーケストレータ。**plan 承認以降は人の介入なしで draft PR まで走り切る**（ready 化・merge・デプロイはやらない）。フェーズは既存スキル（sear-me・plan・implement・skill-review）と review-pipeline workflow に委譲する。「全部おまかせで開発して」「フルプロセスで」「計画から PR まで通して」などの依頼で起動する。
---

# develop: 開発オーケストレータ

計画から実装、レビュー収束、draft PR、レポートまでを回す「**ファイルベースの実行台帳を持つ薄いステートマシン**」。各フェーズは既存スキルと workflow に委譲し、develop 本体は順序・引き継ぎ・ゲートの管理に徹する。フェーズ間の引き継ぎは main context の記憶でなく実行台帳 `develop-log.md` を正本とする（compaction・セッション中断をまたいで resume できる）。

**plan 承認が唯一の人ゲート。** そこを通ったら draft PR まで人の介入なしで走り切る。この設計は前段に負荷をかける——実装中に判明する類の情報の欠落は承認後には誰も止められず、確定していない仕様で実装された PR として出てくる。だから sear-me で「後続が自力で埋められない情報」を出し切ることが前提条件になる。draft で作るのは、外向きの最後の一歩（ready 化）を人の手に残すため。

## 実行台帳 develop-log.md

- 置き場所: `<現在の作業スペース>/develop-log.md`（plan.md と同居）。step 0 で frontmatter を作成し、以降は各フェーズ完了時に 1 エントリ追記する。
- **append-only はエントリ列に適用**する。既存エントリは書き換えない。frontmatter の `status` と `current_phase` のみ可変（in-place 書き換え可）。
- **各フェーズの開始時に必ず台帳を Read してから着手する**（引き継ぎの正本。main context の記憶を頼らない）。
- frontmatter: `task`（依頼の一文）/ `track: code|skill` / `status: in-progress|converged|non-converged|aborted` / `current_phase`（着手マーカー。**各フェーズの開始時に更新する**）。`non-converged`＝ゲート (c) の報告を経て非収束のまま完走した状態。`aborted`＝ユーザの中断指示でタスクを畳んだ状態（develop が設定。resume 対象にしない——再開はユーザの明示指示があるときだけ）。
- エントリ形式: `## [N] <フェーズ名> — <ISO 時刻>`。フェーズごとの必須フィールド:
  - `plan`: plan.md パス・承認結果
  - `implement`: 作業ツリー cwd・変更ファイル一覧・テストコマンド・検証結果
  - `review`: review-pipeline の戻り（ラウンド数と各ラウンドの内訳・件数の内訳（総数 / 解消 / 反証 / 重複 / 既存 / cleanup / 未検証 / 理由なし乖離 / 未対応）・未対応の指摘リスト・報告に回した指摘・`stopped_by`・`flags`）・**workflow の run id**（未完走時の `resumeFromRunId` に要る）・レビューの計装（`level_decision` / `review_stats` / `diff_stat` / `flags.cap_shortfall`）・客観確認の結果・変更ファイル突合の差分。**収束ループ全体で 1 エントリ**
  - `pr`: ブランチ名・コミット一覧（sha と subject）・draft PR の URL
  - `report`: 出力パス
- **ラウンド計数は review-pipeline の戻り（`rounds`）が正**。台帳の review エントリ数で数える旧規約は、収束ループが script 内に移ったため廃止した。記憶で数えない。
- エントリ schema の厳密度（自由記述をどこまで構造化するか）は **v1 で運用を観測してから決める**（初版は必須フィールド＋自由記述。resume・レポートが読み損ねる観測が出てから構造化度を上げる）。

## ゲート（3 つだけ。フェーズ間確認は持たない）

- **(a) plan 承認** — plan スキル内蔵（develop は所有しない）。develop 側に残るのは順序ガードのみ: **plan 承認が台帳に記録される前に実装系 Agent・レビュー収束 skill を起動しない**。**ただし step 0.5 の pre-plan skill-review はこの順序ガードの対象外**——これは「plan への入力生成」であって実装系でも収束ループのレビュー計器でもない（read-only 評価。plan の前に走るのが本来の位置）。この分類は本ガードと「やってはいけないこと」節の同文禁止の双方に効く。
- **(b) draft PR より外側の承認** — develop 所有。**収束後の commit・push・draft PR 作成までは自動で進む**（plan 承認以降は人が介入しない設計の一部）。承認が要るのはその外側で、**draft の ready 化・merge・デプロイ・PR 以外への外部公開はこのスキルでは行わない**。各フェーズの subagent には副作用禁止句を伝搬させ続ける（commit は本体が step 4 でまとめて行い、実装 / 修正 subagent には commit させない）。**chezmoi apply は skill トラックの客観確認に必要なため下記の包括承認で回す**（Obsidian 等の私的ノート出力は対象外）。skill トラックのレビュー・収束で発生する chezmoi apply は、**最初の apply の前（step 3 Round 1 のレビュー前 apply を含む）**に「以降のレビュー・収束ループ中の apply」を包括承認として 1 回取る（承認範囲は Round 1 から収束までの全 apply。ラウンドごとに確認を挟まない）。**包括承認の取得結果と承認範囲（対象ファイル・期間）は台帳に記録する**（main context の記憶だけに置くと、compaction・resume 後に未承認のまま apply が走るゲート破りの経路になる）。承認範囲の境界は**タスクの改修対象 skill 単位**（期間は Round 1 から収束まで）: fix で編集対象が同一 skill 内で増えた場合は範囲内として台帳の承認記録に追記し、**改修対象 skill の外のファイルへ apply が及ぶ場合のみ再承認を取る**（境界を編集ファイルの増減の解釈に委ねない）。resume 時は台帳の承認記録を確認し、記録が無ければ取り直す。
- **(c) 非収束時の報告** — develop 所有。**review-pipeline が `converged: false` を返したら発火する**（内訳は script の `stopped_by`: `round-limit`（上限 5 到達）/ `no-progress`（修正対象が前ラウンドから厳密に減っていない）/ `review-failed` / `fix-failed` / `cap-reached`（エンジンの報告上限で correctness の指摘が切り捨てられた＝見えていない指摘が確実に存在するため修正ループに入らず人へ渡す）/ `unexplained-divergence`（`extra_lenses` の乖離検査で、理由がどこにも記されていない食い違いが残った））。**ラウンド計数と前進判定は script がコードで行う**ため、本体で数え直さない（旧規約の「台帳の review エントリ数で数える」は収束ループが script 内に入ったため廃止。上限 5 の根拠は 2026-07-03 の観測——台帳 19 件中 4 件が旧上限 3 で非収束だった）。客観確認 fail もここに合流する。いずれの場合も黙って打ち切らず、未対応の指摘をユーザに報告する。**PR は作らない**（step 4 をスキップ。レビュー待ちの列に未完成のものを並べない）。skill トラックの報告には**「非収束の変更が target に apply 済みのまま稼働している」事実と、source revert＋再 apply で巻き戻せること**を必ず含める（未収束の skill が現役で動き続けることをユーザから見える形にする）。台帳の `status` は `non-converged` にする（`converged` と区別する）。

委任後は確認なしで進み、事後報告とする。

## トラック dispatch（code / skill）

入口（step 0）で判定し、台帳 frontmatter に記録する。計器は本表で引く:

| | code トラック | skill トラック |
|---|---|---|
| 判定 | 下記以外のコード開発 | 改修対象が `~/.claude/skills/` 配下の SKILL.md・プロンプト文書（chezmoi source 側 `dot_claude/skills/` を含む）、および skill を構成する workflow js・補助 script。**SKILL.md と js の混在変更も skill トラックとする**（skill 固有の全体評価は step 3 でなく pre-plan の skill-review が担う——下記「skill トラックの review 配置」） |
| レビュー計器（step 3） | **review-pipeline workflow**（`~/.claude/workflows/review-pipeline.js`）。自前レビューエンジン（Scope→観点別 finder→独立 verify→sweep→synthesize。security 観点の並走付き）→ 未検証分の点検 → 修正 → 再レビューを収束まで回す | 同じ review-pipeline（SKILL.md＋js を対象）＋**名前参照追跡**（指摘が言及するガード／収束条件／台帳記録の定義箇所を diff 外でも develop 本体の Read で確認し非局所結合の崩れを検出）。**skill-review は step 3 では使わない**（noisy 計器の収束ゲート利用を撤去。skill 全体評価は pre-plan へ前倒し） |
| 収束後の客観確認 | 台帳の implement エントリのテストコマンドを **develop 本体の Bash で同一作業ツリーで再実行** | `chezmoi apply` → `chezmoi diff` が空であることを確認 → **名前参照追跡 pass** |
| workflow へ渡す `source_note` | 空文字 | 「編集対象は chezmoi source（`~/.local/share/chezmoi/dot_claude/` 配下）。target（`~/.claude/`）を直接編集しない。指摘中の target パスは source パスに読み替える」（target 直編集は直後の `chezmoi apply` が stale source で上書きして修正がロストし、同じ指摘が再発してラウンドを浪費する） |

**`Skill: code-review` はモデルから呼べない。** Skill tool 経由はブロックされる（実測: `Skill code-review cannot be used with Skill tool due to disable-model-invocation`。subagent への preload も不可）。step 3 のレビュー本体は review-pipeline 内蔵の自前エンジンが担う（bundled code-review と同じ観点構成——角度 A〜E・独立検証・cleanup 5 レンズ——を自前の文面で実装したもの。bundled への委譲経路は 2026-08-02 に撤去、経緯は「撃ち直した残差の記録」）。step 5 で人に促すのは、レビューが劣化したとき（`cap_hit_correctness` / `security_failed`）のローカル再実行に限る。

- **skill トラックの review 配置**: skill 全体の評価（skill-review full）は **plan の前段で 1 回**回し plan の参照入力にする（step 0.5）。post-implement の step 3 は **review-pipeline（diff ベース）＋名前参照追跡**で回す——skill-review を毎ラウンドの収束ゲートに使うと per-run の detection turnover で収束しない構造だったため、収束ゲートから外した（撃ち直し記録は「撃ち直した残差の記録」節）。
- skill トラックの注意: review-pipeline は apply 後の作業ツリー（target 反映済み）に対する diff を見るため、**workflow 起動の前に source の編集を apply する**（ゲート (b) の包括承認 1 回で回す）。workflow 内の修正 agent は source を編集するので、workflow 完了後にもう一度 apply して `chezmoi diff` が空であることを確認する。pre-plan の skill-review full は read-only 評価で apply を伴わない。
- code トラックの非コード成果物（diff に出ない設定・ドキュメント）は workflow の `changed_files` に明示パスで渡す（diff が無いと空振りする）。skill トラックでも SKILL.md/js が diff に出ない場合は同様に渡す。

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

### 3. review 収束

レビュー・修正・再レビューの収束ループは **review-pipeline workflow**（`~/.claude/workflows/review-pipeline.js`）に委譲する。ラウンド計数・前進判定・修正対象の絞り込み・件数集計は script がコードで計算するため、自己申告に依存しない。本体の責務は起動・戻り解釈・客観確認・台帳記録。

- 台帳を Read する。**起動前に、main の cwd が台帳 implement エントリの作業ツリーと一致することを確認する**（不一致のままだとレビュー対象の diff がずれる）。skill トラックでは**先に source を apply する**（workflow は target 反映済みの diff を見る）。
- **起動前に本体 Bash で差分の実測を取る**（script は filesystem を持たないので自分で git を叩けない。渡さないと規模判定と `pre_existing` 判定が働かない）:
  - `git -C <worktree> diff --numstat HEAD` を集計して `diff_stat`（`{ files, insertions, deletions }`）にする
  - `git -C <worktree> diff --name-only HEAD` を `changed_files_actual` にする（未追跡ファイルは `git status --porcelain` から補う）
- `Workflow` tool を `scriptPath: ~/.claude/workflows/review-pipeline.js` で起動する。args:
  - `request`（元の依頼文）/ `worktree_cwd`（台帳の implement エントリの値。**これ以外を使わない**）/ `side_effect_ban`（「commit / push / chezmoi apply / 外部公開を行わない。修正は作業ツリー内のファイル編集に限る」）/ `plan_path` / `changed_files`（台帳の implement エントリ＝実装工程の申告）/ `changed_files_actual`（上の実測。`pre_existing` 判定の正本）/ `diff_stat`（上の実測。規模判定の入力）/ `diff_command`（既定は `git -C <worktree> diff HEAD`。コミット済みの差分をレビューするときだけ明示する）/ `source_note`（トラック表で引く）/ `max_rounds`（既定 5）/ `per_angle` `verify_model` `verify_effort` `max_verifiers`（任意。コスト knob。下記）/ `extra_lenses`（任意。下記）
- **`extra_lenses` はエンジンの角度に無い観点を並走させる口。** エンジンは角度 A〜E と cleanup 5 レンズが固定で、Conventions レンズは「規約の逐語と違反行の逐語が両方引けるとき」しか挙げない建て付けなので、**思想・設計意図との整合や、CLAUDE.md の外（docs 等）にあるルールは構造的に拾われない**。そこを埋めるのがこの引数。並走なのでエンジンの報告上限や角度ごとの候補上限の影響を受けない。
  - `{ key, focus, category, context?, requires_rationale? }` の配列。`focus` は何を探すか（具体名で書くほど効く）。`category` は `correctness` なら修正ループに入り、`cleanup`（既定）なら報告のみ。`context` に参照先（docs のルート・索引・規約の所在）を渡す
  - **`requires_rationale: true` は文書との乖離を見る観点向け。** 出力に理由の所在（`plan` / `comment` / `none`）を持たせ、**理由がどこにも無い乖離があれば `stopped_by: unexplained-divergence` で収束を止める**。文書は古びるので違反と断定させず、どちらが更新されるべきかの見立てを添えさせる。理由が plan にあるものはゲート (a) を通った承認済みの判断なので収束を妨げない
  - **観点を 3 つより多く足すときは点検段の作りを見直す。** 未検証候補を 1 agent が全件見る構造なので、件数が増えるとエンジンの verify 段が避けている形（1 コンテキストで全件判定）に戻る
- **レビュー本体は自前エンジン 1 本。** Scope（差分と規約を一度だけ取得して全担当に配布）→ 観点別 finder（角度 A〜E＋cleanup 5 レンズ）→ 独立 verify → sweep（`xhigh` のみ）→ synthesize の 5 段。観点構成は bundled code-review と同じだが文面は自前で、報告上限で切り捨てた件数（`stats.dropped`）と同一根本原因の他ロケーション（`also_at`）を構造化して返す。
- **コスト knob。** `per_angle`（角度ごとの候補上限。候補数を通じて verifier 数に線形に効く）/ `verify_model`（verifier のモデル。finder は下げない — 挙げなかった候補は下流の誰も再導出せず取りこぼしが無音で恒久になる）/ `verify_effort` / `max_verifiers`（超えたらロケーション単位からファイル単位のグループ化に落ちる）。実測ではレビュー本体のコストは verifier が約 6 割、finder が約 3 割を占める。
- 規模判定で `high` / `xhigh` を切り替え、**既定は `xhigh`**（`diff_stat` が無い・判定材料が壊れている場合も `xhigh` に倒れる）。エンジンの角度に無い security 観点は、専用の自前 agent が並走する。
- **修正対象の絞り込みは script が持つ。** 対象は「独立した検証を通った」かつ「この差分が持ち込んだ」かつ「`category: correctness`」かつ「偽陽性でも重複でもない」指摘だけ。`cleanup` と `pre_existing: true` と未検証のものは修正せず報告に回る。**本体で対象を足したり減らしたりしない。**
- step 2 の implement 内 self-review とは観点で住み分ける（self-review＝plan 突合専任、ここ＝correctness / quality の adversarial レビュー）。同じバグ探しを二重にしない。
- **cleanup の専用段は置かない。** 品質クリーンアップは implement-pipeline の cleanup ステージが実装直後に当てており、review の修正で生じる diff は小さい。`Skill: simplify` の呼び出しも撤去した（bundled skill の Skill tool 呼び出しはブロックされうるため、依存させない）。レビューエンジンが Reuse / Simplification / Efficiency / Altitude / Conventions の 5 レンズを Round 1 で回すので、指摘としては拾われる（`category: cleanup` として報告に回り、修正ループには入らない）。
- **起動時の run id を台帳の review エントリに記録する。** workflow が完走しなかったときの再開に要る（main の記憶に置くと compaction・resume 後に再開経路を失う）。
- **workflow が途中で落ちたら `resumeFromRunId` で再開する。** agent の連続失敗・session limit・中断で完走しなかった場合、`Workflow({ scriptPath, resumeFromRunId: '<run id>', args: <起動時と同じ args> })` で続きから回せる。完了済みの agent は (prompt, opts) が変わっていなければキャッシュから即座に返るので、落ちた地点から先だけが実走する。**args は起動時と同じものを渡す**（変えると script の前提が変わりキャッシュの整合も崩れる）。**再開は同一セッション内に限る**——セッションを跨ぐとキャッシュを引けないので、最初から回し直すか、ゲート (c) で未完のまま報告する。使用量上限で落ちた場合は上限のリセットを待てば同じセッションから続けられる。**再開の前に journal（`<transcript dir>/journal.jsonl`）を読み、完了済み agent が実際に結果を返しているか確認する**（キャッシュされた結果が空のこともある。空を前提に診断を始めない）。

戻りを受けたら:

- `flags` の true な軸を「未実施」「劣化」として明示する（`review_failed` はレビューエンジン未実施（理由は `review_error`。security と追加観点しか残っていない）、`triage_failed` は点検が未実施で未検証の指摘が残る、`fix_failed` は修正未適用、`security_failed` は security 観点が欠落、`extra_lenses_missing` はその数の追加観点が未実施、`unexplained_findings` は理由の記されていない乖離の件数、`cap_reached` はエンジンの報告上限で検証済みの指摘が切り捨てられた（件数は `cap_shortfall`。エンジンが組み立て時にコードで数える正確な値）。併せて `cap_hit_correctness` が立っていれば押し出された中に correctness が含まれることが確定しており、その場合だけ修正ループに入らず `cap-reached` で止まる。cleanup 側の切り捨てなら報告に載せるだけで収束は妨げない）。**観点が欠けたまま完走した場合は、全部揃ったかのように提示しない**（`security_failed` と `extra_lenses_missing` がその指標）。
- **`level_decision` と `review_stats` と `diff_stat` を台帳に記録する。** 規模判定の閾値は 1 サンプルからの外挿なので、実行ごとにこの 3 つを貯めて後から見直す（計装）。`flags.cap_shortfall` も併記する。
- **報告に回った指摘を提示する。** `totals.pre_existing` と `totals.cleanup` と `totals.unverified` と `totals.unexplained` は修正されていない。件数と内容を提示し、別チケットにするか今回直すかをユーザに判断させる。`unverified` は点検が届かなかったもので、偽陽性か真の欠陥かが未確定である旨を添える。`unexplained` は文書との乖離のうち理由が見つからなかったもので、**実装と文書のどちらを直すかは人の判断**である旨を添える（文書が古い可能性があるので、実装を巻き戻す前提で提示しない）。
- **skill トラックの名前参照追跡**: workflow の指摘が言及する**ガード／収束条件／台帳記録**（「ゲート (b)」「収束条件」等の名前参照）の定義箇所を、diff に出ていなくても develop 本体の Read で読み、局所編集が遠隔の定義を無効化していないか（非局所結合の崩れ）を確認する。崩れを検出したら指摘として review エントリに追加する。
- **客観確認**（トラック表で引く）: code は台帳のテストコマンドを同一作業ツリーで本体 Bash で再実行。skill は `chezmoi apply` → `chezmoi diff` が空 → 名前参照追跡 pass。**実行が 0 件の場合は pass と数えない**（code トラック＝台帳のテストコマンド欄が空。skill トラック＝apply / diff の実行記録が無い）。検証手段の不在自体を未対応として扱い、確立できなければゲート (c) と同様に報告する（vacuous converged を成立させない）。
- **変更ファイル突合**: 本体 Bash の `git status --porcelain` と workflow の `changed_files` を突合し、差分を review エントリに並記する（申告は書き換えない）。skill トラックでは apply 前の `chezmoi diff` 確認が同じ役割を担う。
- ラウンド数・件数の内訳・未対応の修正対象・報告に回した指摘・`stopped_by` を台帳の review エントリに **1 件**追記する（**ラウンド計数は workflow の `rounds` が正**。台帳の review エントリ数で数える旧規約は廃止＝収束ループが script 内に入ったため）。
- **収束条件は「修正対象ゼロ かつ 客観確認 pass」。** 満たせば台帳の `status` を `converged` にして step 4 へ。満たさなければゲート (c) で未対応の指摘を報告し、`non-converged` にして **step 4 をスキップし step 5 へ**（PR は作らない）。レビュー指摘がゼロでも客観確認が fail なら収束とせず、失敗内容を未対応として扱う。**報告に回った pre_existing と cleanup は収束判定に入れない。** ただし `stopped_by: cap-reached` は収束させない（見えていない指摘が確実に存在する状態なので `converged` を名乗らせない）。

### 4. commit と draft PR（収束したときだけ）

台帳の `status` が `converged` のときだけ実行する。`non-converged` ならスキップして step 5 へ。

- **ブランチ**: 作業ツリーが既に feature ブランチならそれを使う。ベースブランチ上なら `feature/<Issue ID>` を切る（Issue ID は台帳 frontmatter / 作業スペースの命名から取る）。**ベースブランチへ直接 commit しない。**
- **commit**: 意味のある単位に分割する（1 コミット 1 意図。plan の Phase 分割が単位の手がかり）。メッセージは対象リポジトリの既存慣習に合わせる（`git log --format=%s -20` で確認し、絵文字・チケット ID の付け方を踏襲する。独自形式を持ち込まない）。
- **pre-commit フックを飛ばさない。** `--no-verify` は使わない。フックが落ちたら原因を解消してから通す（環境起因でも解消する）。解消できなければ commit を止めて報告する。
- **push**: `git push -u origin <ブランチ>`。
- **draft PR**: `gh pr create --draft --base <ベース> --head <ブランチ> --title "<subject>" --body-file <ファイル>`。**body は必ずファイル経由で渡す**（バッククォートを含む本文を `--body` に直書きするとコマンド置換事故になる）。
  - 対象リポジトリに `.github/PULL_REQUEST_TEMPLATE.md` があれば **必ず Read してその構成で body を書く**（独自フォーマットで書かない）。
  - **作成者が確認する種類のチェックボックスは空 `[ ]` のまま残す**（「自身の修正として品質を保証できる」等。本体がチェックを入れない）。
  - body に**このスキルが走った事実**を書く: レビュー収束のラウンド数と指摘の内訳、報告に回した pre-existing と nit、**`/code-review` が未実施であること**（自前計器で収束させたことを隠して渡さない）。
- ブランチ名・コミットの sha と subject・draft PR の URL を台帳の pr エントリに追記する。

### 5. report

- レポート担当 subagent（`subagent_type`: `general-purpose`）に **develop-log.md と plan.md のパスを渡して直接読ませる**（サマリの手渡しをしない）。prompt 必須項目に副作用禁止を含める: 「書き込みは出力先ディレクトリ配下のレポートファイルに限る。commit / push / chezmoi apply を行わない」（ゲート (b) の境界の伝搬。修正 subagent と同旨）。内部で `obsidian:obsidian-cli` 等の既存スキルを活用してよい。
- 出力先は **Obsidian の `~/workspace/notes/obsidian/Life/inbox/`**（呼び出し時に明示パスがあれば優先）。
- 出力パスを台帳に追記し、レポートのパスをユーザに報告する。
- **収束した場合**: draft PR の URL とブランチ名を最終報告に含める。**ready 化はユーザの判断**であることを添える。
- **非収束の場合**: PR を作っていないので、未コミット変更の所在（作業ツリー cwd・変更ファイル一覧）と未対応の指摘・赤の内容を最終報告に必ず含める。ここから先（直して再開するか、そのまま commit するか）はユーザの判断。
- **レビューの追加実行は、劣化しているときだけ促す。** 通常は step 3 のレビューエンジンが本家 code-review と同じ観点構成を回しているので、同じものを人に叩き直させる理由はない。**`flags.cap_hit_correctness` / `flags.security_failed` のいずれかが立っているときだけ**、作業ツリーのパスを添えて `/code-review xhigh` の実行を促す（順に、報告上限で見えていない指摘が残っている状態 / 認可とデータ保護の観点が欠落した状態）。**`/code-review ultra` は既定では促さない**——クラウド実行で claude.ai アカウントと課金を伴い、業務環境では使えないことがある。促すとしてもユーザがその環境で使えると分かっている場合に限る。変更がユーザ向け挙動・実行可能物に触れるなら `/verify` を促す（モデルからは起動できないため、促すことしかできない）。

## ガード

- **メタタスク（改修対象が SKILL／プロンプト文書）でも、step 3 のレビュー収束ループは本来の規約（上限 5・前進なし早期報告）どおり回す。** 対象の失敗パターンが develop 側で再生産される懸念があっても予防的に打ち止めない（予防的な打ち止めは上流 skill 改善の不信任と等価）。実発生したらユーザと合意の上で下流（plan / review-pipeline / skill-review）の改修タスクを起票する。**失敗接地**: 2026-06-10、plan SKILL で観点インフレ observed。**検証実績**: 2026-06-11、蒸留スキル（現 /harvest）改修で本来のループが正常収束（Round 2 で指摘ゼロ）。

## 撃ち直した残差の記録（2026-06-12 台帳化で前提条件が消えた防御）

旧設計の防御のうち、以下は構造変更で前提条件が消えたため置換・撤去した。元の失敗が新構造で再発したら、該当の錨ごと復活させる:

- **「各フェーズの結果を main context に残し、次フェーズの prompt に組み込む」**→ 台帳のパス渡しに置換（compaction でロストする引き継ぎを構造で解消）。
- **「フェーズ間のユーザ確認は既定 ON。小タスクのみ通し」**→ 3 ゲート＋台帳に置換。「通し / 確認 ON」のモード概念ごと廃止（implement 内蔵ゲートとの未定義な重複も同時に解消。implement 側は args の明示句で承認分岐する）。
- **「self-review をスキップさせたら step3 は必須」**→ スキップさせる経路自体が消滅（implement は develop 経由でも plan 突合を必ず残す）。到達経路の無いガードのため撤去。
- **「skill トラックの step 3/4 計器は skill-review static」**→ **撤去**。skill-review を毎ラウンドの収束ゲートに使うと per-run 40〜50% の detection turnover で「指摘ゼロ」収束に到達しない構造だった（実測・2026-06 判別実験）。skill 全体評価は pre-plan の skill-review full に前倒しし（plan の参照入力）、step 3 は diff ベースの計器＋名前参照追跡に置換。**錨**: 「noisy 計器を per-round の収束ゲートに使う」構造が再発したら（例: 別の全文評価計器を step 3 に戻す）、この非収束が戻る。pre-plan 配置＋diff 計器の分離を保つこと。
- **「レビュー計器は `Skill: code-review`」**→ **撤去して自前の review-pipeline に置換**（2026-07-29）。bundled の `/code-review` は `disable-model-invocation: true` で、モデルからの Skill tool 呼び出しがブロックされる（実測: `Skill code-review cannot be used with Skill tool due to disable-model-invocation`。公式ドキュメントは subagent への preload も不可と明記）。Claude Code v2.1.215 以降の仕様変更で、それ以前はモデルからも起動できた。**錨**: 計器を自前で持つ以上、検出力は `/code-review` に及ばない。step 5 でユーザに `/code-review` の実行を促す経路を消さないこと。
- **「計器を自前で持つ以上、検出力は `/code-review` に及ばない」**→ **bundled の実体を workflow として名指しで呼ぶ形に変更**（2026-08-01）。`disable-model-invocation` が塞いでいるのは Skill tool 経路だけで、workflow の名前解決にはフィルタが無い（`hidden` は一覧表示から隠すだけ）。実測で `Workflow({name:"code-review", args:"high <target>"})` が完走し、script 内の `workflow()` からも名前解決できることを確認した（2.1.220）。レビュー本体を委譲したことで、観点（行単位スキャン / 削除された振る舞いの監査 / 呼び出し元トレース / 言語固有の落とし穴 / ラッパー委譲）と独立検証と cleanup 5 レンズが本家のものになる。**錨**: hidden 登録は公開契約ではない。フォールバック経路の報告と `cap-reached` での非収束扱いを消さないこと。本家に無い security 観点の並走も消さないこと。（フォールバック経路そのものは次項で bundled 委譲ごと撤去）
- **「レビュー本体は bundled 委譲＋inhouse フォールバック」**→ **bundled への委譲経路を撤去し、自前エンジン専用に変更**（2026-08-02）。理由は 2 つ: plugin 化を見据えて本家プロンプト資産の逐語コピーを自前の文面に書き直した（観点構成・判定ラダーの思想は維持）ことと、フォールバックの実発生が無く 2 エンジン維持のコストに見合わなかったこと。`review_engine` / `flags.fallback_used` / `flags.engine_used` は廃止。副産物として、cap 到達の検出が merge 注記の文字列パースからの推定でなく、エンジンが組み立て時にコードで数える正確な値（`stats.dropped` / `droppedCorrectness`）になった。**錨**: security 観点の並走と `cap-reached` での非収束扱い、`cap_hit_correctness` / `security_failed` 時に step 5 で `/code-review xhigh` を促す経路は維持すること。hidden workflow の名指し呼びの知見は前項に残る（復活させる場合はそちらを参照）。
- **「ラウンド計数＝台帳の review エントリ数」「修正 subagent と `Skill: simplify` を本体が回す」**→ 収束ループを review-pipeline workflow に移したため、計数・前進判定・修正対象の絞り込みは script のコードが持つ（自己申告に依存しない）。cleanup の専用段は置かない（implement-pipeline の cleanup が実装直後に当てており、review の修正 diff は小さい。bundled skill への依存も避ける）。**錨**: 本体側で指摘を要約・取捨してから提示すると、script が確定した件数と提示の件数が乖離する。生の戻りをそのまま出すこと。
- **「完走しても develop が自発的に commit / push しない」**→ **終点を draft PR に変更**（2026-07-29）。plan 承認以降は人が介入しない前提に揃え、収束後の commit・push・draft PR 作成を自動化した。ゲート (b) の守る範囲は draft PR の外側（ready 化・merge・デプロイ）へ移動。**錨**: draft で作ることと、非収束時に PR を作らないことが、外向きの誤爆を止める 2 点。どちらも外さないこと。

## やってはいけないこと

- plan 承認が台帳に記録される前に実装系 Agent・レビュー収束の workflow を起動する（**例外: step 0.5 の pre-plan skill-review は「plan への入力生成」で順序ガード対象外**。ゲート (a) の分類と整合）。
- 台帳を読まずにフェーズを開始する／既存エントリを書き換える（append-only。frontmatter の `status` / `current_phase` は除く）。
- implement へ長文の決定事項サマリを渡す（plan.md＋台帳のパスが一次ソース）。
- ラウンド数を記憶で数える（review-pipeline の戻り `rounds` が正）。
- **review-pipeline の戻りの指摘・件数・flags を本体で要約・取捨してから提示する**（script が確定した件数と提示が乖離する。未実施の軸は未実施と、報告に回した pre-existing / nit は修正していないと明示する）。
- **修正対象の絞り込みを本体で足し引きする**（script の判定。low と pre_existing を修正対象に戻さない）。
- 非収束（`converged: false`）を黙って打ち切る（ゲート (c) で報告する）。前進なしを「もう 1 ラウンド様子を見る」で先送りしない。
- **非収束のまま PR を作る**（step 4 は `converged` のときだけ）。
- **draft を ready にする・merge する・デプロイする・PR 以外へ外部公開する**（ゲート (b)。走り切る範囲は draft PR の作成まで）。
- **実装 / 修正 subagent に commit させる**（commit は本体が step 4 でまとめて行う。各 subagent には副作用禁止句を伝搬させ続ける）。
- **pre-commit フックを `--no-verify` で飛ばす**（落ちたら原因を解消する。解消できなければ commit を止めて報告する）。
- **PR 本文の作成者確認欄にチェックを入れる**（人が確認する項目）。
- **`Skill: code-review` / `Skill: verify` / `Skill: simplify` を呼ぼうとする**（bundled skill は `disable-model-invocation` でモデルから起動できない。促すことしかできない）。
- implement の self-review と step 3 を同じバグ探しの二重レビューにする（住み分けは step 3 参照）。
