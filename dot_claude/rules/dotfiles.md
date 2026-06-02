# dotfiles

ユーザは Mac/Windows 両環境の dotfile を chezmoi で単一ソース一元管理している（環境差は `.tmpl` の `{{ .chezmoi.os }}` 等で吸収）。

- **ホーム配下の dotfile（`~/.gitconfig`, `~/.config/` 配下, `~/.claude/` 配下など）は chezmoi 管理下の可能性が高い。** 編集する前に管理状況を確認し、管理下なら **target（`~/...`）ではなく source（`~/.local/share/chezmoi/`）を編集する**。正本は常に chezmoi source 側。
- 理由: 過去に target を直接編集して source との乖離を作る失敗を繰り返している。この前提は編集を始める前に効いている必要があるため常時ロードに置く。
- 確認コマンド・命名規則・apply/diff の検証手順・コミット方針などの具体手順は、条件ロードの `dotfiles-chezmoi.md`（dotfile 系パスを Read/Edit したとき発火）に置く。
