# 00-env.fish - 環境変数の設定

# PATH の設定
fish_add_path /snap/bin
fish_add_path $HOME/.local/share/mise/shims
fish_add_path $HOME/.cargo/bin
fish_add_path $HOME/.local/bin

# 文字コード関連
set -gx LESSCHARSET utf-8

# エディタ設定
set -gx EDITOR nvim
set -gx VISUAL cursor

# シェル設定
set -gx STARSHIP_SHELL fish

# シェルの挨拶を表示しない
set -gx fish_greeting