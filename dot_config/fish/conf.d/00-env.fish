# 00-env.fish - 環境変数の設定

# Homebrew (Apple Silicon)
if test -x /opt/homebrew/bin/brew
    /opt/homebrew/bin/brew shellenv | source
end

# PATH の設定
fish_add_path /snap/bin
fish_add_path $HOME/.local/share/mise/shims
fish_add_path $HOME/.cargo/bin
fish_add_path $HOME/.local/bin

# 文字コード関連
set -gx LESSCHARSET utf-8

# エディタ設定
set -gx EDITOR nvim
set -gx VISUAL "code --wait"

# git 専用のエディタ/ページャ（gitconfig には書かず環境ごとに指定）
set -gx GIT_EDITOR "code --wait"
set -gx GIT_PAGER delta

# シェル設定
set -gx STARSHIP_SHELL fish

# シェルの挨拶を表示しない
set -gx fish_greeting

set -gx SOPS_AGE_KEY_FILE $HOME/.config/sops/age/keys.txt
