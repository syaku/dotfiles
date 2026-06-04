---
name: plan
description: 依頼を整理して ~/workspace/tasks/<slug>/plan.md に計画を書き、承認まで進めるスキル。standalone でも /develop から呼ばれてもよい。フロントマターで Bash/Edit がツール層ブロックされ、計画フェーズの実行を抑制する。「計画を立てて」「plan して」などの依頼で起動する。
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

### 3.5. 自己検証・レビュー（承認前）

承認をユーザに求める前に、plan.md を 2 種類の subagent で検証・レビューする。**ここで使うのは plan.md という文書に対応した専用 subagent であり、既存の `verify` / `code-review` スキル（diff・実行アプリ対象）とは別物。** 両スキルは plan フェーズでは入力を持たないので呼ばない。

1. **2 つの subagent を並列起動**（独立タスクなので並列）。
   - **検証 subagent**（事実の grounding／read-only）:
     - `subagent_type`: `Explore`
     - `prompt`: plan.md パスと**対象リポジトリのパス**を渡し「各事実主張を実コードと照合し、不一致だけを `{主張, 実態, 確認方法, 深刻度}` のリストで返せ。Critical files のパス実在、Reusable utilities の所在・シグネチャ、現状挙動の前提を重点的に。アプローチの良し悪しは判断するな」
     - **「実在」「再利用可」の主張は filesystem の Read/Grep でなく、統合ブランチ（既定 `origin/master`）に対する git で確認させる**: `git -C <repo> grep -n <symbol> origin/master` / `git -C <repo> ls-tree origin/master -- <path>`。**失敗接地**: 同一リポジトリの未マージ worktree が複数並走するとき、作業ツリーや別ブランチの worktree を grep すると「統合ブランチに実在・再利用可」と誤断定し、実装着手時に当該シンボルが統合ブランチに無く詰む。skill 本体は Bash ブロックのため git はこの検証 subagent でしか叩けない＝委譲必須。
     - 各「再利用」主張には**現在どのブランチに在るか**（統合ブランチか、未マージの feature ブランチか）を実態に併記させる。未マージなら「先行マージ待ち」か「自前新設」かを Approach への反映候補として返させる。
   - **レビュー subagent**（計画の妥当性／判断）:
     - `subagent_type`: `general-purpose`
     - `prompt`: plan.md パス＋元の依頼文を渡し「計画の妥当性・網羅性・リスクを批評し、指摘を `{論点, 深刻度, 修正提案}` で返せ。特に過度な抽象化（YAGNI 違反）と Verification 節の十分性を見よ」
2. **結果の取り込み**:
   - 検証で見つかった事実誤りのうち、**訂正に出典（`origin/master` 上の `path:line` / sha 等）を伴うものだけ** plan.md を Write で書き直して自動修正する（Edit はブロック済みなので全文 Write で上書き）。
   - **出典を示せない訂正は自動で書き換えず**、当該主張に「要確認」マークを残す。**失敗接地**: 出典なき自動修正は、誤った主張を別の同様に未確認な主張へ“それらしく”書き換えるだけで、結局どちらも統合ブランチに無いまま、という二重の誤りを生む（ロンダリング）。
   - レビュー指摘は自動反映しない。承認時にユーザへ提示して判断を仰ぐ。
3. **リトライ（最大 1 回）**: 深刻な指摘（計画の前提を覆すもの）が残る場合のみ、ステップ 3 の起草に 1 回だけ戻って書き直し、再度この 3.5 を回す。2 回目以降はループせず、未解決の論点を承認時に提示する。

### 4. 承認

- plan.md のパスを示し AskUserQuestion で承認可否を取る。
- 提示時にステップ 3.5 のサマリを添える: 「検証で N 件修正・**要確認 J 件**（出典が出せず自動修正を保留した主張）／レビューで M 件の論点（対応済み K 件・要判断 L 件）」。ユーザは検証済みの計画に対して承認判断できる。
- 承認後はスキル終了。呼び出し元（main セッションまたは /develop）に plan.md のパスを返す。

## やってはいけないこと

- plan.md 以外を Write する
- 承認後に自分で実装に進む（subagent 起動含む）
- 検証・レビュー subagent に実装やコード変更をさせる（どちらも read-only。検証は Explore、レビューは批評のみ）
- plan フェーズで `verify` / `code-review` スキルを呼ぶ（diff・実行アプリが無いので機能しない。実装後に呼び出し元が回す責務）
- 出力先を `.claude/plans/` にする
- EnterPlanMode を呼ぶ（このスキルは plan モードを使わない設計）
