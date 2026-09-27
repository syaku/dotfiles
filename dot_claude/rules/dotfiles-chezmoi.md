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

ユーザは Mac/Windows 両環境の dotfile を chezmoi で 1 つの source から管理している（環境の差は `.tmpl` の `{{ .chezmoi.os }}` などで吸収する）。**ホーム配下の dotfile（`~/.gitconfig`, `~/.config/` 配下, `~/.claude/` 配下など）は chezmoi の管理下にある可能性が高く、元のファイルは常に source 側にある。**

- 編集前に `chezmoi managed | grep <name>` か `chezmoi source-path <file>` で管理状況と source パスを確定する。
- 管理下なら source（`~/.local/share/chezmoi/`）を編集する。target を直接編集しても source が古いままなら次の `chezmoi apply` で巻き戻る。
  - 命名規則: `~/.gitconfig` → `dot_gitconfig`、`.tmpl` 付きはテンプレート。source パスは `chezmoi source-path <file>` で確定させる。
- 編集後は `chezmoi apply <file>` で target に反映し、`chezmoi diff <file>` で source と target が一致したことを確認する（差分なし＝OK）。
