# エイリアス設定ファイル
# このファイルはコマンドのエイリアスとショートカットを定義します
# 依存: 10-core.nu (check_command関数)

alias ls-builtin = ls

# ディレクトリ表示の関数
def ll [] {
    ls-builtin | sort-by type name | table
}

def la [] {
    ls-builtin -a | sort-by type name | table
}

# エイリアスの設定
alias ls = eza --icons --hyperlink --color=always --group-directories-first

alias cat = bat
alias c = bat

# lessの代替としてのbat
def less [...rest] {
    if ($rest | is-empty) {
        # 標準入力がある場合はそれを使用
        if ($in | is-empty) {
            echo "使用方法: less <ファイル名> または パイプで入力"
        } else {
            $in | bat --paging=always
        }
    } else {
        bat --paging=always ...$rest
    }
}

alias grep = rg
alias g = rg

alias find = fd

alias man = tldr

alias vi = nvim
alias vim = nvim
