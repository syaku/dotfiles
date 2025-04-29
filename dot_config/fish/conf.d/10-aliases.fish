# 10-aliases.fish - エイリアス定義

# ディレクトリ表示の関数
alias ls "eza --group-directories-first --hyperlink --icons --color=always"
alias ll "eza -l --group-directories-first --hyperlink --icons --color=always"
alias la "eza -a --group-directories-first --hyperlink --icons --color=always"

# ファイル操作の関数
alias cat "bat"
alias grep "rg"

alias find "fd"

alias man "tldr"

# lessの代替としてのbat
function less
    if test -n "$argv"
        bat --paging=always $argv
    else
        echo "使用方法: less <ファイル名> または パイプで入力"
    end
end

# 短縮エイリアス
alias g "grep"
alias c "cat"

# エディタエイリアス
alias vim "nvim"
alias vi "nvim" 