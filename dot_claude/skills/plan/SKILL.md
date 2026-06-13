---
name: plan
description: 依頼を整理して ~/workspace/tasks/<タスクディレクトリ名>/plan.md に計画を書き、承認まで進めるスキル。計画作成（調査・起草・検証/レビュー・リトライ収束）は plan-pipeline workflow（~/.claude/workflows/plan-pipeline.js）に決定論オーケストレーションとして委譲し、本体は入力確定・Workflow 起動・plan.md Write・per-item 判断ゲートに徹する。件数・状態の集計は workflow script がコードで計算するため自己申告に依存しない。standalone でも /develop から呼ばれてもよい。「計画を立てて」「plan して」などの依頼で起動する。
---

# plan: 計画フェーズ

依頼を read-only で調査・整理し、`~/workspace/tasks/<タスクディレクトリ名>/plan.md` に計画を書き、ユーザの承認を取って終了するスキル。実装には進まない（実装は呼び出し元の責務）。

計画作成の主要工程（調査・起草・検証/レビュー・出典付き訂正・リトライ収束）は **plan-pipeline workflow**（`~/.claude/workflows/plan-pipeline.js`）に委譲する。オーケストレーション・件数集計・状態判定・恒等式は workflow script が**コードで決定論的に実行**するため、LLM の自己申告に依存しない。本体の責務は入力確定・Workflow 起動・plan.md Write・per-item 判断ゲートのみ。

## 厳守プロトコル

- **`plan.md` を書く以外の Write は行わない。** 出力先は `~/workspace/tasks/<タスクディレクトリ名>/plan.md` 固定。plan.md の Write は常に本体が行う（workflow は `plan_md` 文字列を返すだけで、ファイルには触れない）。
- 本体が使うのは Read/Glob/Grep/Write/Workflow/AskUserQuestion のみ。Bash/Edit/Agent は使わない（agent の fan-out は workflow script の領分）。
- **workflow 戻りの `findings` を本体で要約・取捨・マージしない。** script が確定した生の N 件をそのまま per-item 列挙する（生の N 件＝提示の N 件）。
- 承認が取れたらこのスキルは終了する。実装系の作業は起動しない。

## 実行モデル

- `Skill` tool は **main 会話で動く**。skill フロントマターに `disallowed-tools` を**置かない**——フロントマター制限は main 全体に効くので、plan が active な間 /develop など呼び出し元まで巻き添えでツールを失う（失敗接地: 2026-06-11、develop からの呼び出しで develop 全体に Bash/Edit 制限が及ぶ構造を確認）。
- skill の指示による Workflow 起動は multi-agent orchestration の opt-in 要件を満たす（Workflow tool の仕様）。
- workflow は background で走り、完了通知で戻り値を受け取る。ユーザ対話（AskUserQuestion）は workflow 内ではできないため、確認・承認系は全て本体（step 1 / step 4 / step 5）に置く。

## フロー

### 1. タスクの理解と出力先決定

- 依頼を整理し、曖昧点があれば AskUserQuestion で 1〜2 件に絞って確認する。
- **同ディレクトリに `premise.md`（sear-me の成果物）があれば読み、その Goal / Scope / Assumptions / Decisions / Open questions を step1 の確認結果として扱う。premise.md の Open questions に挙がっていない軸は再質問しない**（premise.md が無ければ従来通り 1〜2 問確認する＝疎結合維持）。
- **呼び出し元（/develop 等）から skill-review レポートのパス指定があれば、それも参照入力として読む**（既存 skill 改修時の pre-plan 評価結果。premise.md とは別チャネル＝別ファイルとして並存し、自動検出には乗せず明示パス渡しで受ける。premise＝前提整理、skill-review レポート＝既存 skill の改善点で役割が違う）。step 2 で `skill_review_report_path` として workflow に渡す。
- **premise.md の frontmatter `status` が `final` のものだけを確定済みとして扱う。** `status: draft` は sear-me が確定前に終了した形跡なので、そのまま足場にせず、続行可否（draft のまま進める／sear-me をやり直す）をユーザに確認する。
- **Open questions の引き継ぎ規約**: premise.md の Open questions は workflow 内の調査・起草で解消させ、**解消できなかったものだけ plan.md の Risks に繰り越す**（未決論点の二重所有を避ける。この規約は workflow の起草 prompt に encode 済み）。
- タスクディレクトリ名は `~/workspace/tasks/CLAUDE.md` の命名規則に従う（チケットがあればチケット ID 起点、無ければ内容が一目で分かる日本語名。例: `genpass長さ上限警告/`。kebab-case 英語スラッグをデフォルトにしない）。**呼び出し元（/develop 等）からタスクディレクトリ（出力先）の指定があれば、命名規則より優先してそれを使う**（呼び出し元の実行台帳・premise.md との同居前提を壊さない。別ディレクトリを新設しない）。
- 出力パス `~/workspace/tasks/<タスクディレクトリ名>/plan.md` をユーザに提示する。

### 2. plan-pipeline workflow の起動

`Workflow` tool を以下で起動する:

- `scriptPath`: `~/.claude/workflows/plan-pipeline.js`
- `args`（JSON オブジェクトとして渡す。文字列化しない）:
  - `plan_path`: `~/workspace/tasks/<タスクディレクトリ名>/plan.md`
  - `repo_path`: 対象リポジトリのパス
  - `request`: 元の依頼文（main セッション or /develop から受け取ったもの。step 1 の確認結果を織り込む）
  - `premise_path`: premise.md のパス（あれば）
  - `skill_review_report_path`: pre-plan skill-review レポートのパス（既存 skill 改修で /develop の step 0.5 が生成した場合のみ。任意。premise_path と並ぶ optional 参照入力で、必須 args には混ぜない）

パイプラインの構成（script 側に encode 済み・本体から重複指示しない）: 調査 (Explore) → 起草 → 検証 (Explore) ＋レビュー並列 → 出典付き訂正の適用 → severity:high が残る間のリトライ収束ループ（質的減少で停止・ハードリミット 2 回）→ 修正起点の二次整合チェック（1 回上限）。

### 3. 戻り解釈

workflow は以下を返す（件数・状態は script がコードで計算済み。schema は script 冒頭の定義を参照）:

```json
{
  "plan_md": "<plan.md 全文。出典付き訂正適用後の最終形>",
  "corrections_applied": [{"claim": "...", "reality": "...", "how_verified": "...", "severity": "...", "source": "path:line / sha", "corrected_text": "..."}],
  "unverified_marks": [{"claim": "...", "reality": "...", "how_verified": "...", "severity": "..."}],
  "findings": [{"id": 1, "round": 1, "summary": "...", "status": "problem", "severity": "high", "subtype": "none", "quote_text": "", "quote_verified": false, "resolved": false, "resolved_round": null, "state": "要判断"}],
  "totals": {"count": 0, "resolved": 0, "needs_decision": 0, "no_action": 0, "deferred": 0},
  "retry_log": {"rounds_executed": 1, "retries": 0, "stopped_by": "no-problem-high|quality-decrease-broken|hard-limit-2|nested-recheck-done|review-failed"},
  "flags": {"verify_failed": false, "review_failed": false}
}
```

本体の処理:

1. **sanity check（一瞥確認）**: `totals` の 4 値の合計が `findings.length` に一致すること。script 計算なので破れない設計だが、script 改変事故の検知としてだけ見る（不一致なら script のバグなのでユーザに報告して停止）。
2. **`flags` の確認**: `review_failed=true` ならレビュー軸の結果が無い＝レビュー未実施として per-item ゲートで明示する（「レビュー済み」を装わない）。`verify_failed=true` も同様に検証未実施を明示する。
3. `findings[].state` は script が確定した 4 状態（対応済み・要判断・対応不要・保留-設計上意図）。本体で再分類しない。
   - 「対応済み」には `resolved_round` / `resolved_note`（どのラウンドの再レビューで解消判定されたか・根拠）が付く。
   - 「保留-設計上意図」は `quote_text`（plan 本文の observe-driven 宣言の逐語抜粋）が script の機械照合（`plan_md` への包含判定）を通過したものに限る。照合に落ちたものは script 側で「要判断」に倒れている。

### 4. 初回 Write と per-item 判断ゲート

- **初回 Write**: 戻りの `plan_md` を `~/workspace/tasks/<タスクディレクトリ名>/plan.md` にそのまま Write する。
- plan.md のパスを示し、検証/レビューサマリと**レビュー指摘の per-item 判断ゲート**を添えて承認可否を取る。**per-item 列挙は本文で行い、AskUserQuestion は採否入力（4 件以下）または反映後の最終承認に使う（提示と承認を同一 AskUserQuestion に押し込まない）**。
- **検証のサマリ**: 「検証で N 件修正（`corrections_applied`）・要確認 J 件（`unverified_marks`＝出典が出せず訂正を保留した主張。plan 内に（要確認）マーク付き）」。適用された訂正は per-item に `source`（path:line / sha）と `corrected_text` を併記し、ユーザが目視で正確性を確認できるようにする（出典が本当にその訂正を支持するかは機械検証できないため、ユーザ目視を最後の砦にする）。
- **レビュー指摘の per-item 提示**: `findings` の生の全件を、**1 件ずつ番号付きで `{論点／深刻度（severity:high|medium|low）／状態（対応済み｜要判断｜対応不要｜保留-設計上意図）／反映するなら plan のどこを何に変えるか}` を列挙**し、ユーザに per-item で採否を答えさせる。
  - 4 状態の件数（`totals`）を列挙の前に明示し、合計が `findings.length` に一致することを示す。
  - 「対応済み」は根拠（`resolved_round` / `resolved_note`、訂正起因なら対応する `corrections_applied[].source`）を併記する。
  - 「保留-設計上意図」は採否でなく「v1 観測項目として plan に明示済みか」の確認として提示する（要判断と混ぜない）。
  - 4 状態いずれも列挙の手前で消さず per-item に出す。
- **採否入力の手段**: 4 件以下なら AskUserQuestion の multiSelect『採用する指摘を選択』でもよい。**5 件以上は本文に全件列挙し、番号指定で per-item に採否を答えさせる（multiSelect は使わない）**。いずれも **multiSelect は採否入力の手段にすぎず、全指摘の列挙は常に本文で行う**＝選択肢からの除外で指摘を落とさない。

### 5. 承認後 Write と引き継ぎ

- 採否が決まった指摘だけを承認後に plan へ反映する（**承認後 Write = 全文 Write 固定**）。本体が plan の該当箇所に採用指摘を当てて全文を書き直し、`~/workspace/tasks/<タスクディレクトリ名>/plan.md` を Write する。採用指摘ゼロならこの Write はスキップ。
- 「保留-設計上意図」の項目は、採否でなく**「v1 観測項目として plan に明示する」ことが対応**——plan に observe-driven 宣言が既にあるか確認し、無ければ承認後 Write で該当節へ「v1 では観測後に決定する」旨を追記して終わる（reword 不要・要判断と混ぜない）。
- 採用指摘の plan 該当箇所への当て込みは本体側で行い、workflow の再実行はしない（パイプライン起動コストを増やさない）。
- 承認後はスキル終了。呼び出し元（main セッションまたは /develop）に plan.md のパスを返す。

## workflow との interface

正本は `~/.claude/workflows/plan-pipeline.js`（chezmoi source: `dot_claude/workflows/plan-pipeline.js`）。script 側を変更するときは本体節 step 2（args）/ step 3（戻り schema）との整合を確認する。

script に encode 済みの判断系規約（本体・script のどちらを変えるときも保持する）:

- **観点インフレ禁止**: レビューに「観点 N 個」「観点ごとに 1 件以上」の網羅指示を入れない。指摘ゼロは正当な出力。`status=problem-none`（supportive 含む）も findings に含めて母数を保つ。
- **deferred-by-design の意味論**: observe-driven の故意の未決を「曖昧 → medium」と読み替えない。逐語 `quote_text` 必須・script が `plan_md` への包含で機械照合し、落ちたら「要判断」へ demote。
- **出典なき自動修正の禁止**: 訂正は `origin/master` 上の出典（path:line / sha）を伴うものだけ適用。出典が無い不一致は（要確認）マークで保留（誤った主張を別の未確認主張へ"それらしく"書き換えるロンダリング防止）。
- **統合ブランチ基準の実在確認**: 「実在」「再利用可」は origin/master 基準。並走 worktree の grep で断定しない。
- **改稿の範囲制約**: revise agent は指示された訂正・指摘の範囲だけ plan を書き換える（レビュー観点の先回り反映・自己判断の改善を混ぜない）。medium/low はユーザ判断に委ねるため retry 改稿で触らない。
- **リトライの停止判定**: 質的減少（open high の厳密減少 AND open total の非増加）を script が不等式で判定。ハードリミット 2 回は暴走防止の保険。

## 撃ち直した残差の記録（2026-06-11 Workflow 化で前提条件が消えた防御）

旧設計（計画作成 subagent への prompt 委譲）の失敗接地由来の防御のうち、以下は**構造変更で前提条件が消えたため撤去した**。元の失敗が新構造で再発したら、該当の錨ごと復活させる:

- **件数保存則の二段アサート**（恒等式・全件要判断フェイルセーフ。失敗接地: 2026-06-09 の要判断 0 事故）→ `totals` を agent に申告させず script が `findings.length` から計算する構造になり、母数絞り・状態畳みが**構造的に不可能**になった。本体 step 3 の sanity check は script 改変事故の検知用に残置。
- **JSON fenced block 規約・末尾 block 規約・型コアース・schema 逸脱時の再実行**→ `agent(prompt, {schema})` の structured output が tool 層で validate するため不要。
- **nested_markers 機構一式**（random hex・/dev/urandom・OS 判定・Read 照合。失敗接地: [[subagent のネスト起動は親から見えない]]）→ agent の spawn が workflow script の決定論コードになり、観測ギャップ自体が消滅。
- **`auto_corrections_applied[].source` の強検出/弱検出 regex**（失敗接地: 2026-06-11 の越権 2 回観察 [[2026-06-11 plan スキルの越権]]）→ 検証（verify）とレビュー（review）が**独立並列の別 agent** になり、レビュー指摘が検証出力に混入する経路が構造消滅。レビュー反映は script が管理する retry 改稿経路のみで、改稿対象の指摘も script が指定する。
- **planner-agent（`~/.claude/agents/planner-agent.md`）と disallowedTools**→ 中間管理 LLM 自体を廃止（オーケストレーションは script）。Bash/Write による偽装経路は実行主体が消えたため封鎖対象も消滅。

## やってはいけないこと

- plan.md 以外を Write する
- 承認後に自分で実装に進む（agent / workflow 起動含む）
- 出力先を `.claude/plans/` にする
- EnterPlanMode を呼ぶ（このスキルは plan モードを使わない設計）
- **skill フロントマターに `disallowed-tools` を置く**（`Skill` tool は main で動くため、plan が active な間 /develop など呼び出し元の main 全体がツールを失う巻き添えが出る。失敗接地: 2026-06-11）
- **workflow を介さず本体から直接 Agent で計画作成・検証・レビューを fan-out する**（オーケストレーションと件数集計を決定論層に置いた設計の骨抜き。LLM 自己申告ベースの集計に巻き戻る）
- **workflow 戻りの `findings` を要約・取捨・マージして件数を減らしてから提示する**（指摘を列挙の手前で消す＝ゲートの迂回。生の N 件＝提示の N 件。失敗接地: 2026-06-09、自動反映と畳み込みで要判断 0 にして単一承認で済ませた事故）
- **`findings[].state` を本体で再分類する**（script の決定論判定を main の解釈で上書きしない。「対応不要」を要判断から振り分け直さない・要判断を対応済みに昇格させない）
- **`flags.review_failed` / `flags.verify_failed` を無視して「検証・レビュー済み」として提示する**（未実施の軸は未実施と明示する）
- **script の判断系規約（観点インフレ禁止・deferred-by-design・出典なき修正禁止・改稿範囲制約・質的減少停止）を prompt から削る**（interface 節参照。これらはモデル能力でなく判断方針の規約で、Opus 前提でも残す）
