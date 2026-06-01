---
name: plan
description: 依頼を整理して ~/workspace/tasks/<slug>/plan.md に計画を書き、承認まで進めるスキル。standalone でも /dev から呼ばれてもよい。フロントマターで Bash/Edit がツール層ブロックされ、計画フェーズの実行を抑制する。「計画を立てて」「plan して」などの依頼で起動する。
disallowed-tools: Bash Edit
---

# plan: 計画フェーズ

依頼を read-only で調査・整理し、`~/workspace/tasks/<slug>/plan.md` に計画を書き、ユーザの承認を取って終了するスキル。実装には進まない（実装は呼び出し元の責務）。

## 厳守プロトコル

- **`plan.md` を書く以外の Write は行わない。** 出力先は `~/workspace/tasks/<slug>/plan.md` 固定。
- フロントマターで Bash/Edit はツール層ブロック済み。Read/Glob/Grep/Write/Agent/AskUserQuestion のみ使う。
- 承認が取れたらこのスキルは終了する。実装系の Agent は起動しない。

## フロー

### 1. タスクの理解と出力先決定

- 依頼を整理し、曖昧点があれば AskUserQuestion で 1〜2 件に絞って確認する。
- タスクスラッグ（kebab-case 短語、例: `add-login-button`）を決める。
- 出力パス `~/workspace/tasks/<slug>/plan.md` をユーザに提示する。

### 2. 調査（read-only）

- Read/Glob/Grep で関係ファイル・既存実装を探す。
- 広範な調査が必要なら Agent (Explore) を最大 3 並列で起動する。
- 既存 utility/関数の再利用候補と、変更が必要なファイルを把握する。

### 3. 計画の起草

`~/workspace/tasks/<slug>/plan.md` を Write で作成する。構成:

- **Context**: 背景と目的（なぜこの変更が必要か）
- **Approach**: 推奨案のみ。代替案は載せない
- **Critical files**: 変更対象のファイル（パターンが繰り返されるなら 1 回説明＋代表パス数件）
- **Reusable utilities**: 再利用する既存実装（パス付き）
- **Verification**: 実行・テスト方法

### 4. 承認

- plan.md のパスを示し AskUserQuestion で承認可否を取る。
- 承認後はスキル終了。呼び出し元（main セッションまたは /dev）に plan.md のパスを返す。

## やってはいけないこと

- plan.md 以外を Write する
- 承認後に自分で実装に進む（subagent 起動含む）
- 出力先を `.claude/plans/` にする
- EnterPlanMode を呼ぶ（このスキルは plan モードを使わない設計）
