# .automode-environments/

Claude Code の `autoMode` ブロック（auto mode 分類器に渡す環境記述）をマシン単位で管理するディレクトリ。`dot_claude/settings.json.tmpl` が描画時に `<hostname>.json` を `autoMode` キーとして差し込む。対応ファイルが無いマシンでは `autoMode` キーごと省略される（分類器は working directory とカレントリポジトリの remote のみ信頼する既定で動く。機能欠損ではない）。

`/auto-mode-setup` の生成物はシェル履歴・ワークスペース観察に由来しマシンごとに異なるため、OS 分岐ではなく hostname 単位で持つ。置き場がユーザ `~/.claude/settings.json` に限られる（project settings / settings.local.json からは分類器が読まない）ため、chezmoi 同期対象の settings.json への template 注入で「同期ファイルの中のマシンローカル領域」を作っている。

## 新しいマシンで autoMode を有効にする手順

1. `chezmoi update` 済みの状態で、Claude Code で `/auto-mode-setup` を実行する（target の `~/.claude/settings.json` に `autoMode` ブロックが直書きされる。この時点では chezmoi drift）。
2. 生成された `autoMode` の値（オブジェクト全体）を、このディレクトリの `<hostname>.json` に移す。hostname は `chezmoi data` の `.chezmoi.hostname`。既存の `odin.json` が書式の実例（継続行に 2 スペースの基底インデント）。
3. `chezmoi apply ~/.claude/settings.json` で target を template 描画に戻し、`chezmoi verify ~/.claude/settings.json` で drift が無いことを確認して commit・push する。

Claude に「settings.json の autoMode ブロックを .automode-environments に移して」と頼めば 2〜3 は代行できる。

## 注意

- `/auto-mode-setup` を再実行すると target 直書きの drift が再発する。再生成したら手順 2〜3 をやり直す。
- ここに置くファイルはマシン観察の記述であり機密ではない前提。業務機密が混ざる内容は書かない（同期リポジトリに載る）。
