# 00-env.fish - 環境変数の設定

# PATH の設定
add_fish_path $HOME/.local/share/mise/shims
add_fish_path $HOME/.cargo/bin
add_fish_path $HOME/.local/bin

# 文字コード関連
set -gx LESSCHARSET utf-8

# エディタ設定
set -gx EDITOR nvim
set -gx VISUAL cursor

# シェル設定
set -gx STARSHIP_SHELL fish
