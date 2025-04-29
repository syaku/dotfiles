# 00-env.fish - 環境変数の設定

# PATH の設定
set -gx PATH $HOME/scoop/shims $HOME/.cargo/bin $HOME/.local/bin $PATH

# 文字コード関連
set -gx LESSCHARSET utf-8

# エディタ設定
set -gx EDITOR nvim
set -gx VISUAL cursor

# シェル設定
set -gx STARSHIP_SHELL fish

# ウィンドウタイトル
function fish_title
    echo " fish"
end 