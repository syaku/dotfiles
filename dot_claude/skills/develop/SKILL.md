---
name: develop
description: 計画→実装→レビュー→修正→レポートを回す開発オーケストレータ。各フェーズは既存スキル（plan, implement, code-review / skill-review 等）に委譲し、状態の正本はタスクディレクトリの実行台帳 develop-log.md に置く（resume・ラウンド計数・レポートの一次ソース）。入口でトラック（code / skill）を判定してレビュー計器を選び、ゲートは 3 つ（plan 承認・副作用前承認・3 ラウンド非収束時の報告）に限定してフェーズ間確認は持たない。「全部おまかせで開発して」「フルプロセスで」などの依頼で起動する。
---

# develop: 開発オーケストレータ

計画から実装、レビュー、修正、レポートまでを回す「**ファイルベースの実行台帳を持つ薄いステートマシン**」。各フェーズは既存スキルに委譲し、develop 本体は順序・引き継ぎ・ゲートの管理に徹する。フェーズ間の引き継ぎは main context の記憶でなく実行台帳 `develop-log.md` を正本とする（compaction・セッション中断をまたいで resume できる）。

## 実行台帳 develop-log.md

- 置き場所: `~/workspace/tasks/<タスクディレクトリ名>/develop-log.md`（plan.md と同居）。step 0 で frontmatter を作成し、以降は各フェーズ完了時に 1 エントリ追記する。
- **append-only はエントリ列に適用**する。既存エントリは書き換えない。frontmatter の `status` のみ可変（in-place 書き換え可）。
- **各フェーズの開始時に必ず台帳を Read してから着手する**（引き継ぎの正本。main context の記憶を頼らない）。
- frontmatter: `task`（依頼の一文）/ `track: code|skill` / `status: in-progress|converged|non-converged|aborted` / `current_phase`（着手マーカー。**各フェーズの開始時に更新する**）。`non-converged`＝ゲート (c) の報告を経て非収束のまま完走した状態。`aborted`＝ユーザの中断指示でタスクを畳んだ状態（develop が設定。resume 対象にしない——再開はユーザの明示指示があるときだけ）。
- エントリ形式: `## [N] <フェーズ名> — <ISO 時刻>`。フェーズごとの必須フィールド:
  - `plan`: plan.md パス・承認結果
  - `implement`: 作業ツリー cwd・変更ファイル一覧・テストコマンド・検証結果
  - `review`: 計器（code-review / skill-review static）・ラウンド番号・指摘件数と指摘リスト
  - `fix`: 対応概要・自己確認結果
  - `report`: 出力パス
- **ラウンド計数＝台帳の review エントリ数**（初回レビューが Round 1。`--fix` 統合経路も「review(+fix)」エントリ 1 件で 1 ラウンド）。記憶で数えない。
- エントリ schema の厳密度（自由記述をどこまで構造化するか）は **v1 で運用を観測してから決める**（初版は必須フィールド＋自由記述。resume・レポートが読み損ねる観測が出てから構造化度を上げる）。

## ゲート（3 つだけ。フェーズ間確認は持たない）

- **(a) plan 承認** — plan スキル内蔵（develop は所有しない）。develop 側に残るのは順序ガードのみ: **plan 承認が台帳に記録される前に実装系 Agent・レビュー skill を起動しない**。
- **(b) 副作用前承認** — develop 所有。**chezmoi apply・commit・push・外部公開を伴う書き込みの前に承認を取る**（Obsidian 等の私的ノート出力は対象外）。skill トラックのレビュー・収束で発生する chezmoi apply は、**最初の apply の前（step 3 Round 1 のレビュー前 apply を含む）**に「以降のレビュー・収束ループ中の apply」を包括承認として 1 回取る（承認範囲は Round 1 から収束までの全 apply。ラウンドごとに確認を挟まない）。
- **(c) 3 ラウンド非収束時の報告** — develop 所有。台帳の review エントリが 3 件に達してなお指摘が残る場合、黙って打ち切らず残指摘をユーザに報告してから次へ進む。この経路で step 5 へ進むときは台帳の `status` を `non-converged` にする（`converged` と区別する）。

委任後は確認なしで進み、事後報告とする。

## トラック dispatch（code / skill）

入口（step 0）で判定し、台帳 frontmatter に記録する。計器は本表で引く:

| | code トラック | skill トラック |
|---|---|---|
| 判定 | 下記以外のコード開発 | 改修対象が `~/.claude/skills/` 配下の SKILL.md・プロンプト文書（chezmoi source 側 `dot_claude/skills/` を含む）、および skill を構成する workflow js・補助 script。**SKILL.md と js の混在変更は skill トラックとし、js 部分には code-review を併用** |
| レビュー計器（step 3） | `Skill: code-review`（effort は依頼の重要度に応じる。既定 medium） | `Skill: skill-review <skill 名>`、**mode: static を明示**（軽量実行。full にしない） |
| 修正後の客観確認（step 4） | 台帳の implement エントリのテストコマンドを **develop 本体の Bash で同一作業ツリーで再実行** | `chezmoi apply` → `chezmoi diff` が空であることを確認 → static 再実行 |

- skill トラックの注意: skill-review は target（`~/.claude/skills/<name>/SKILL.md`）を評価するため、各ラウンドのレビュー前に source の編集を apply する（ゲート (b) の包括承認 1 回で回す）。
- code トラックの非コード成果物（diff に出ない設定・ドキュメント）は code-review に明示パスで読ませる（diff が無いと空振りする）。

## フロー

### 0. 入口判定

判定順:

1. タスクディレクトリを特定する（依頼文のパス指定、または `~/workspace/tasks/` の既存ディレクトリ検出。新規なら `tasks/CLAUDE.md` の命名規則で作る）。
2. `develop-log.md` あり → **resume**: 台帳を Read し、`current_phase`（着手マーカー）と最終完了エントリを突き合わせる。着手マーカーが最終完了エントリより先＝フェーズ途中の中断なので、**作業ツリーの dirty 状態（部分編集の残り）を確認してから**そのフェーズをやり直す（未記録の変更との二重適用を避ける）。dirty だった場合は差分の要約を提示し、**「残存変更を活かして続行／破棄してやり直し」をユーザに確認する**（黙って破棄しない）。一致していれば最終エントリの次のフェーズから再開する。
3. `plan.md` のみあり（台帳なし）→ **途中参加**: 承認状態が台帳に無いため、**develop 自身が plan.md の要点を提示して AskUserQuestion でゲート (a) を取り直してから**実装フェーズへ（plan スキルは再起動しない。ゲート (a) の所有は plan のまま、途中参加時の代行のみ develop が担う）。frontmatter 作成後、**plan エントリ（plan.md パス・代行承認の結果）を台帳に追記してから step 2 へ進む**（順序ガード「plan 承認が台帳に記録される前に実装系を起動しない」の充足を経路上で閉じる）。
4. `premise.md`（status: final）のみあり → step 1（plan）から。premise の自動検出は plan 側の既存契約に乗る。
5. 何も無し: 依頼が曖昧（目的・対象・完了条件のいずれかが不明）なら `Skill: sear-me` を先に回してから step 1 へ（args に step 0 で確定したタスクディレクトリを含め、premise.md の出力先をそこへ固定させる——premise.md / plan.md / 台帳の同居を経路全体で維持する）。明確なら step 1 直行。

トラック（code / skill）を判定し、台帳の frontmatter を作成する。

### 1. plan

- `Skill: plan` を起動する（ゲート (a) の承認まで plan 側が担う）。args に **step 0 で確定したタスクディレクトリ（＝台帳の所在）** を含め、plan.md の出力先をそこへ固定させる（「plan.md と台帳の同居」前提の維持。plan 側に別ディレクトリを新設させない）。
- 戻りの plan.md パスが**台帳と同ディレクトリであることを確認してから**、plan.md パスと承認結果を台帳に追記する（不一致なら同居前提が破れているので、是正してから進む）。

### 2. implement

- 台帳を Read し、`Skill: implement` を起動する。args には **plan.md パス・develop-log.md パス・明示句「develop 経由（step 4 の承認ゲートを省略し結果返却のみ）」・副作用禁止の明示**（「commit / push / chezmoi apply / 外部公開を行わない。変更は作業ツリー内のファイル編集に限る」——step 4 の修正 subagent と同文。ゲート (b) の境界を implement 経由の実装 subagent にも伝搬させる）を含める。**長文の決定事項サマリは渡さない**（plan.md と台帳が一次ソース。implement は実装 subagent に plan.md を直接読ませる規約を持つので、3 層とも一次ソース直読みになる）。
- 戻り `{変更概要, 変更ファイル一覧, 検証結果（実行したテストコマンドを含む）, 作業ツリー cwd}` を台帳に追記する。
- `Skill` tool は main で動くため、implement 本体は main で動く。実装・検証・self-review・修正の各工程は implement が起動する implement-pipeline workflow 側の agent 群に隔離され、implement 本体に残るのは入力確定・本体 Bash の最終客観確認・承認/結果返却のみ（詳細は implement 側「実行モデル」節）。

### 3. review

- 台帳を Read し、トラック表で計器を選んで起動する。**起動前に、main の cwd が台帳 implement エントリの作業ツリーと一致することを確認する**（不一致のままだとレビュー対象の diff がずれる。計器に明示パスを渡せる場合は併せて渡す）。
- 指摘リストを台帳の review エントリに記録する（ラウンド番号＝台帳の review エントリ数）。
- step 2 の implement 内 self-review とは観点で住み分ける（self-review＝plan 突合専任——green 判定は implement の workflow script が検証結果から計算する、ここ＝correctness/quality の adversarial レビュー。典拠は各 description）。同じバグ探しを二重にしない。
- `code-review --fix` を使う場合の後続は step 4 の記述に従う（**--fix 規則の正本は step 4**）。

### 4. fix 収束

- 収束条件は**「指摘ゼロ かつ 客観確認 pass」**（code: テスト green／skill: apply → diff 空 → static 指摘ゼロ）。満たしたら台帳の `status` を `converged` にして step 5 へ。レビュー指摘がゼロでも客観確認が fail なら収束とせず、失敗内容を指摘として同じループで修正する（その修正→再確認も通常どおりラウンド計数に乗る）。
- 修正担当 subagent（`subagent_type`: `general-purpose`）の prompt 必須項目: **指摘リスト・plan.md パス・develop-log.md パス・作業ツリー cwd（台帳の implement エントリから）・変更ファイル一覧（同）・副作用禁止の明示**（「commit / push / chezmoi apply / 外部公開を行わない。修正は作業ツリー内のファイル編集に限る」——ゲート (b) は develop 本体所有なので、その境界を起こす subagent に伝搬させる）・自己確認指示（「修正後、修正したファイルを読み直し、(a) 各指摘に対応できているか (b) 他を壊していないか（regression）を自己確認し、対応概要に加えて自己確認結果も返してください」。修正の自己申告だけを信じず、客観確認は下の再実行で担保する）。**skill トラックでは加えて「編集対象は chezmoi source（`dot_claude/skills/` 配下）。target `~/.claude/` を直接編集しない。指摘中の target パスは source パスに読み替える」を必須項目に含める**（target 直編集は直後の `chezmoi apply` が stale source で上書きして修正がロストし、同じ指摘が再発してラウンドを浪費する）。
- 軽微なクリーンアップが中心なら `simplify` スキルでも代替可（品質のみ・バグは見ない）。
- 修正後の客観確認はトラック表で引く（code: 台帳のテストコマンドを同一作業ツリーで再実行／skill: apply → diff 空 → static 再実行）。**skill トラックの static 再実行は、下の収束ループの計器再実行と同一実行**（別に走らせない。apply → diff 空 → static の 1 連鎖が 1 ラウンドを構成し、review エントリ 1 件として記録する）。
- **--fix 規則（正本）**: step 3 で `code-review --fix` により修正を統合した場合、本ステップの修正適用はスキップする。ただし **--fix で修正済みでも解消確認のため最低 1 回は再レビューし、指摘が残れば通常経路と同じく最大 3 ラウンドまで**回す。
- **再レビュー収束ループ**: 修正 → step 3 の計器を再実行 → 残指摘の修正、を**指摘ゼロになるか台帳の review エントリが 3 件に達するかの早い方まで**回す。各ラウンドの fix / review を台帳に追記する。3 ラウンドで指摘が残ればゲート (c)（残指摘を報告してから次へ進む。未検証のまま step 5 へ流さない）。

### 5. report

- レポート担当 subagent（`subagent_type`: `general-purpose`）に **develop-log.md と plan.md のパスを渡して直接読ませる**（サマリの手渡しをしない）。内部で `obsidian:obsidian-cli` 等の既存スキルを活用してよい。
- 出力先は **Obsidian の `~/workspace/notes/obsidian/Life/input/`**（呼び出し時に明示パスがあれば優先）。
- 出力パスを台帳に追記し、レポートのパスをユーザに報告する。
- オプション: code トラックでは step 5 の前に `verify` スキル（コード変更の動作確認用。Obsidian ノート検証の同名 `verify` とは別物）で動作確認を挟むと、レポートに「動作確認済み」と書ける（依頼の性質に応じて選択）。

## ガード

- **メタタスク（改修対象が SKILL／プロンプト文書）でも、step 4 の再レビュー収束ループは本来の規約（最大 3 ラウンド）どおり回す。** 対象の失敗パターンが develop 側で再生産される懸念があっても予防的に打ち止めない（予防的な打ち止めは上流 skill 改善の不信任と等価）。実発生したらユーザと合意の上で下流 skill（plan / code-review / skill-review）の改修タスクを起票する。**失敗接地**: 2026-06-10、plan SKILL で観点インフレ observed。**検証実績**: 2026-06-11、蒸留スキル（現 /harvest）改修で本来のループが正常収束（Round 2 で指摘ゼロ）。

## 撃ち直した残差の記録（2026-06-12 台帳化で前提条件が消えた防御）

旧設計の防御のうち、以下は構造変更で前提条件が消えたため置換・撤去した。元の失敗が新構造で再発したら、該当の錨ごと復活させる:

- **「各フェーズの結果を main context に残し、次フェーズの prompt に組み込む」**→ 台帳のパス渡しに置換（compaction でロストする引き継ぎを構造で解消）。
- **「フェーズ間のユーザ確認は既定 ON。小タスクのみ通し」**→ 3 ゲート＋台帳に置換。「通し / 確認 ON」のモード概念ごと廃止（implement 内蔵ゲートとの未定義な重複も同時に解消。implement 側は args の明示句で承認分岐する）。
- **「self-review をスキップさせたら step3 は必須」**→ スキップさせる経路自体が消滅（implement は develop 経由でも plan 突合を必ず残す）。到達経路の無いガードのため撤去。

## やってはいけないこと

- plan 承認が台帳に記録される前に実装系 Agent・レビュー skill を起動する。
- 台帳を読まずにフェーズを開始する／既存エントリを書き換える（append-only。frontmatter `status` は除く）。
- implement へ長文の決定事項サマリを渡す（plan.md＋台帳のパスが一次ソース）。
- ラウンド数を記憶で数える（台帳の review エントリ数が正）。
- 3 ラウンド非収束を黙って打ち切る（ゲート (c) で報告する）。
- 副作用（chezmoi apply・commit・push・外部公開）を承認なしに実行する（ゲート (b)）。
- implement の self-review と step 3 を同じバグ探しの二重レビューにする（住み分けは step 3 参照）。
