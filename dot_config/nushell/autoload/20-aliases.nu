# エイリアス設定ファイル
# このファイルはコマンドのエイリアスとショートカットを定義します
# 依存: 10-core.nu (check_command関数)

# ディレクトリ表示の関数
def ll [] {
    ls | sort-by type name | table
}

def la [] {
    ls -a | sort-by type name | table
}

# エイリアスの設定
if (check_command "eza") {
    alias ls = eza --icons --hyperlink --color=always --group-directories-first
}

if (check_command "bat") {
    alias cat = bat
    alias c = bat
}

if (check_command "rg") {
    alias grep = rg
    alias g = rg
}

if (check_command "fd") {
    alias find = fd
}

if (check_command "tldr") {
    alias man = tldr
} 