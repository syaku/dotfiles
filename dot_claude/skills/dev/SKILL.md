---
name: dev
description: 計画→実装→レビュー→修正→レポートを順次回す開発オーケストレータ。各フェーズは可能な限り既存スキル（plan, code-review 等）に委譲し、不足分のみ subagent を起こす。「全部おまかせで開発して」「フルプロセスで」などの依頼で起動する。
---

# dev: 開発オーケストレータ

計画から実装、レビュー、修正、レポートまでの 5 フェーズを順次回す。各フェーズは可能な限り既存スキルに委譲し、無いものだけ Agent tool で subagent を起こす。

## フロー

### 1. 計画

- Skill tool で `plan` スキルを起動する。
- 戻りの plan.md パスと、main context に残った決定事項のニュアンスを後段で利用する。

### 2. 実装

- Agent tool で実装担当 subagent を起動:
  - `subagent_type`: `general-purpose`
  - `prompt`: plan.md のパス＋計画の主要な決定事項のサマリ＋「これに従って実装してください。完了したら変更概要を返してください」
- 依頼が TDD 志向なら `tdd-workflow` スキルを subagent の prompt に組み込むか、依頼者と相談して切り替える。
- 戻りで変更概要を受け取り main context に保持する。

### 3. レビュー

- Skill tool で `code-review` スキルを起動する。
- effort level は依頼の重要度に合わせる（デフォルトは省略 = medium、厳重に見たいときは high/max、深掘りしたいときは ultra）。
- 指摘リストを受け取り main context に保持する。
- **指摘＋修正を 1 ステップで済ませたいとき**は `code-review --fix` を呼び、ステップ 4 を統合してよい（修正の透明性を上げたい場合は分割のまま）。

### 4. 修正

- レビュー指摘があれば Agent tool で修正担当 subagent を起動:
  - `subagent_type`: `general-purpose`
  - `prompt`: 指摘リスト＋plan.md パスを渡し、「指摘に対応してください。完了したら対応概要を返してください」
- 軽微なクリーンアップが中心なら `simplify` スキルでも代替可能。
- 指摘なし、または前ステップで `--fix` を済ませた場合はスキップ。

### 5. レポート

- Agent tool でレポート担当 subagent を起動:
  - `subagent_type`: `general-purpose`
  - `prompt`: plan.md・実装サマリ・レビュー結果・修正サマリから作業レポートを Obsidian の所定パスに書く。内部で `obsidian:obsidian-cli` 等の既存スキルを活用してよい
- レポートの出力パスをユーザに報告する。

## ガード

- `/plan` の承認が取れる前に実装系 Agent やレビュー skill を起動しない。
- 各フェーズの結果（plan.md パス・変更概要・指摘リスト・修正概要）を main context に残し、次フェーズの prompt に組み込んで引き継ぎを担保する。
- 大きめのタスクではフェーズ間にユーザ確認を挟む。小規模なら通しで回してよい。

## オプション

- ステップ 5 の前に `verify` スキルで動作確認を挟むと、レポートに「動作確認済み」と書ける（依頼の性質に応じて選択）。
