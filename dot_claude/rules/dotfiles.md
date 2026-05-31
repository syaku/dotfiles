# dotfiles

ユーザは Mac/Windows 両環境の dotfile を chezmoi で単一ソース一元管理している（環境差は `.tmpl` の `{{ .chezmoi.os }}` 等で吸収）。Mac 側 `~/.config` 等を読めば Windows 側の構成も把握できる。

- ホーム配下の dotfile（`~/.gitconfig`, `~/.zshrc`, `~/.claude/` 配下など）は **chezmoi 管理下の可能性が高い**。編集の前に必ず `chezmoi managed | grep <name>` か `chezmoi source-path <file>` で管理状況を確認する。
- 管理下なら **target（`~/...`）ではなく source（`~/.local/share/chezmoi/`）を編集する**。target を直接編集しても source が古いままなら次の `chezmoi apply` で巻き戻る。
  - 命名規則: `~/.gitconfig` → `dot_gitconfig`、`.tmpl` 付きはテンプレート。source パスは `chezmoi source-path <file>` で確定させる。
- 編集後は `chezmoi diff <file>` で source と target が一致したことを確認する（差分なし＝OK）。
- source（`~/.local/share/chezmoi`）は git リポジトリ。**コミット・push はユーザの明示指示があるまで行わない**。
- 理由: 過去に target を直接編集して source との乖離を作る失敗を繰り返している。dotfile の正本は常に chezmoi source 側。
