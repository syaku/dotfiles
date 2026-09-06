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

ユーザは Mac/Windows 両環境の dotfile を chezmoi で単一ソース一元管理している（環境差は `.tmpl` の `{{ .chezmoi.os }}` 等で吸収）。**ホーム配下の dotfile（`~/.gitconfig`, `~/.config/` 配下, `~/.claude/` 配下など）は chezmoi 管理下の可能性が高く、正本は常に source 側。** 過去に target を直接編集して source との乖離を作る失敗を繰り返している。

**`paths` 付きのまま据え置く理由（2026-09-06）**: この rule の中核（target を直接編集しない）は `~/.claude/hooks/chezmoi-source-guard.sh` が exit 2 で止めるので、rule が読み込まれなくても守られる。rule が足すのは止められた後の手順で、それは hook の stderr にも出る。paths 付きは長いセッションで発火しないことがある（`/knowledge-placement` の「paths 付き rules の書き方」）が、常時ロードへ移す理由には足りないと判断した。

- 編集前に `chezmoi managed | grep <name>` か `chezmoi source-path <file>` で管理状況と source パスを確定する。
- 管理下なら source（`~/.local/share/chezmoi/`）を編集する。target を直接編集しても source が古いままなら次の `chezmoi apply` で巻き戻る。
  - 命名規則: `~/.gitconfig` → `dot_gitconfig`、`.tmpl` 付きはテンプレート。source パスは `chezmoi source-path <file>` で確定させる。
- 編集後は `chezmoi apply <file>` で target に反映し、`chezmoi diff <file>` で source と target が一致したことを確認する（差分なし＝OK）。
