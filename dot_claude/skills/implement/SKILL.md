---
name: implement
description: 承認済みの plan.md に従って実装を進め、テスト実行と self-review で自己検証してから変更概要を返すスキル。実装は subagent に出して重いコード編集を隔離する。standalone でも /develop のステップ 2 からでも呼ばれてよい（develop 経由は args の明示句で step 4 の承認ゲートを省略し結果返却のみ。明示が無ければ standalone 扱い）。「実装して」「plan に従って作って」などの依頼で起動する。plan と対になる実装フェーズ担当。
---

# implement: 実装フェーズ

承認済みの `plan.md` を入力に、実装を subagent へ出し、承認前にテスト実行＋self-review で自己検証してから呼び出し元へ変更概要を返すスキル。`plan` と対になる。計画は立て直さない（計画は `plan` フェーズの責務）。

## 厳守プロトコル

- **実装をこのスキル本体の context で直接やらない。** 重いコード編集は `Agent` で起こす実装 subagent に隔離する。スキル本体はオーケストレーション＋テスト実行に徹する。
- **作業ツリーを最初に 1 つ固定し、実装 subagent・テスト実行 Bash・self-review すべて同じツリーを指す。** cwd 不一致でテストが空振りするのを防ぐ（`tasks/CLAUDE.md` の worktree 運用がある場合はそれに合わせる）。
- **plan.md がある場合は再計画しない。** 計画の決定事項に従って実装する。
- **スキルは chezmoi 管理下の正本を触るとき、target ではなく source を編集する**（dotfiles ルール。`~/.claude/...` を直接編集しない）。

### 実行モデルと context 分離（正直な前提）

`Skill` tool は **main 会話で動く**。`/develop`(main) → `Skill: implement` と呼ぶと、このスキルのオーケストレーション層（入力確定・テスト実行・self-review 取り込み）は develop と同じ main context で動く。隔離されるのは**実装 subagent のコード編集工程だけ**＝**部分分離**であって、実装の全工程を隔離する完全分離ではない。

## フロー

### 1. 入力確定と作業ツリー確定

- 引数や呼び出し元から **plan.md パス**を受け取れば採用し、その親（`~/workspace/tasks/<slug>/`）または対象リポジトリの worktree を**作業ツリーとして固定**する。
- **plan.md が無い場合**: 既定は plan への誘導。AskUserQuestion で「`plan` を先に回す（推奨）／このまま小タスクとして実装」を選ばせ、既定を plan 側に置く。小タスク選択時のみ依頼文から直接続行する（この plan-less 経路にだけ責務境界の曖昧さが出る点を意識する）。
- **呼び出し元（standalone か develop 経由か）を把握する。** 判定は呼び出し args の明示句「develop 経由（step 4 の承認ゲートを省略し結果返却のみ）」の有無で行い、**明示が無ければ standalone として扱う**（推測で省略しない＝fail-safe 側に既定を置く）。後段 step 4 の承認分岐と self-review の強度判断に使う。develop 経由では develop-log.md（実行台帳）のパスも受け取り、plan.md と併せて一次ソースとして扱う。

### 2. 実装（subagent 起動）

- `Agent` tool, `subagent_type`: `general-purpose`。
- `prompt`: plan.md のパス（**一次ソース。subagent に『サマリでなく plan.md を直接読め』と伝える**）＋計画の主要な決定事項のサマリ（補助）＋作業ツリーの cwd 指定＋**副作用禁止の明示**（「commit / push / chezmoi apply / 外部公開を行わない。変更は作業ツリー内のファイル編集に限る」。呼び出し元（/develop 等）の args に同句があれば必ずそのまま伝搬させる）＋「これに従って実装し、(a) 変更ファイル一覧 (b) 変更概要 (c) 実行したテスト/ビルドの結果 を構造化して返してください」。
- 依頼が TDD 志向なら `tdd-workflow` スキルを subagent の prompt に組み込むか、依頼者と相談して切り替える。
- 戻りの変更概要・変更ファイル一覧を main(skill) context に保持する。

### 3. 自己検証（承認前）

`plan` の 3.5 に相当するが、implement では diff と動くアプリがあり Bash も使えるので簡素化する（検証 subagent や自動リトライは持たない）。

- **動作検証**: テスト/ビルド/lint を**スキル本体の Bash で直接実行**する。実装 subagent の自己申告を信用せず、main 側で客観的に green を確認する。作業ツリーは手順 1 で固定したものに揃える。
- **self-review（観点を絞る）**: `code-review` との二重を避けるため、self-review subagent（`general-purpose`）の役割を**「plan との突合（未実装項目・plan 逸脱の検出）＋テスト green 確認」に限定**する。correctness/quality のバグ探索は呼び出し元（`/develop` ステップ 3 の code-review）に委ねる。
  - **develop 経由でも self-review を完全スキップせず plan 突合だけは残す**（バグ探索のみ step3 に委ねる。step3 が万一省かれても plan 突合が最後の網）。
  - **standalone のとき**は後段レビューが無いので self-review をやや厚めにする。必要なら `code-review` / `verify` skill を呼んでよい（plan フェーズと違い、実物があるので呼べる）。
- **失敗時の扱い**: テスト赤・未実装が残っても**自動リトライループは回さない**（再実装は高コスト・暴走リスク）。その事実を承認時にユーザへ提示して指示を仰ぐ。明白で安全な breakage（typo 等）のみ、実装 subagent に 1 回だけ修正を依頼するのは可。

### 4. 承認・引き継ぎ

- **standalone**: 変更概要＋検証サマリ（テスト結果／未解決の赤・未実装／self-review の要判断点）を提示し、AskUserQuestion で承認可否を取る。承認後にスキルを終了する。
- **develop 経由（args に明示句あり）**: AskUserQuestion による承認は行わず、結果を返却して終了する（承認系ゲートは呼び出し元 develop が所有: 副作用前承認・非収束時報告。テスト赤・未実装が残る場合もその事実を戻り値に明記して返す——隠して返さない）。
- 戻り値はどちらの経路でも `{変更概要, 変更ファイル一覧, 検証結果（実行したテストコマンドを含む）, 作業ツリー cwd}`（呼び出し元が実行台帳への記録・テスト再実行に使うため、テストコマンドと cwd を省略しない）。

## やってはいけないこと

- 実装をスキル本体の context で直接行う（実装は subagent に出し、重いコード編集を隔離する）。
- `implement` の self-review を `develop` の code-review と同じ「バグ探し」にして二重レビューにする（self-review は plan 突合＋テスト green に観点を絞る）。
- 承認前に自動リトライループで再実装を繰り返す（高コスト・暴走リスク。赤は承認時にユーザへ提示）。
- plan.md がある場合に再計画する（計画は `plan` フェーズの責務）。
- target（`~/.claude/...`）を直接編集して chezmoi source と乖離させる。
