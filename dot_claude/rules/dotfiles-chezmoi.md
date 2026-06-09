---
paths:
  - "**/.local/share/chezmoi/**"
  - "**/.config/**"
  - "**/.claude/**"
  - "**/dot_*"
  - "**/*.tmpl"
  - "**/.gitconfig"
  - "**/.zshrc"
  - "**/.bashrc"
  - "**/.zshenv"
  - "**/.profile"
  - "**/.tmux.conf"
  - "**/.vimrc"
---

# dotfiles: chezmoi 操作手順

前提（dotfile は chezmoi 管理・正本は source 側）は常時ロードの `dotfiles.md` を参照。ここでは dotfile を実際に編集するときの具体手順を扱う。

- 編集前に `chezmoi managed | grep <name>` か `chezmoi source-path <file>` で管理状況と source パスを確定する。
- 管理下なら source（`~/.local/share/chezmoi/`）を編集する。target を直接編集しても source が古いままなら次の `chezmoi apply` で巻き戻る。
  - 命名規則: `~/.gitconfig` → `dot_gitconfig`、`.tmpl` 付きはテンプレート。source パスは `chezmoi source-path <file>` で確定させる。
- 編集後は `chezmoi apply <file>` で target に反映し、`chezmoi diff <file>` で source と target が一致したことを確認する（差分なし＝OK）。
- source（`~/.local/share/chezmoi`）は git リポジトリ。**コミット・push はユーザの明示指示があるまで行わない**。
  - **承認はその時点の修正範囲のみに効く**。一度「push して」と言われても、以降の別タスク・別修正には拡大しない。間に別の修正が入ったら改めて確認を取り直す（失敗接地: 最初の push 承認を「以降ずっと」と拡大解釈し、border_width の微調整など個別修正でも確認なく commit/push を回してユーザに指摘された）。複数修正を 1 度の承認でまとめるなら、範囲を明示してから承認を受ける（例「以下 3 つを 1 コミットで push します。よろしいですか?」）。グローバル CLAUDE.md の "approval in one context doesn't extend to the next" の chezmoi 具体化。
  - 「決め切って実行」を好むユーザ嗜好は実装・編集の話で、commit/push のような共有状態を変える action には適用しない（別軸）。
