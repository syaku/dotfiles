# CLAUDE.md

chezmoi の dotfiles ソースリポジトリ。`chezmoi apply` で `~/` に展開される。編集はソース側を直してから `chezmoi apply`。

## gitconfig の include 構成

`dot_gitconfig` は2つのファイルを include する。**どちらも chezmoi 管理外**（symlink／ローカルファイルは手動作成、`symlink_*` ソースは置かない）。

- `~/.gitconfig.secret` … `~/Syncthing/vault/git/.gitconfig.secret` への symlink。**全マシンで Syncthing 同期**。private だが共有したい identity（`[user]` の email/name）。email を chezmoi リポジトリに入れないための分離。
- `~/.gitconfig.local` … **このマシン固有・非同期の通常ファイル**。OS 固有設定を置く（Windows ではこのマシンで scoop delta テーマ include ＋ GCM `helperselector`）。OS ごとに各自で用意し、存在しない OS では git が欠落 include を黙って無視する。

symlink を chezmoi 管理にしていないのは、OS 間で参照先パスが変わって破綻するのを避けるため。各マシンで手動作成する方針（このマシンは開発者モードで非管理者でも symlink 作成可）。
