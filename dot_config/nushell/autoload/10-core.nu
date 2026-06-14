# コア設定ファイル
# このファイルは基本的な環境変数と設定を定義します

# コマンドの存在確認を行う関数
def check_command [cmd: string] {
    if (which $cmd | is-empty) {
        print $"Warning: ($cmd) is not installed"
        return false
    }
    return true
}

def check_commands [...commands: string] {
    for cmd in $commands {
        if not (check_command $cmd) {
            return false
        }
    }
    return true
}

# PATH の設定
def --env add_to_path [path: string] {
    if ($path | path exists) {
        $env.PATH = ($env.PATH | split row (char esep) | prepend $path)
        # print $"Added ($path) to PATH"
    }
}

add_to_path $"($env.HOME)/scoop/shims"
add_to_path $"($env.HOME)/.cargo/bin"
add_to_path $"($env.HOME)/.local/bin"

# シェル設定
$env.STARSHIP_SHELL = "nu"

# 文字コード関連
$env.LESSCHARSET = "utf-8"

# エディタ設定
$env.EDITOR = "nvim"
$env.VISUAL = "zed -wait"

# YAZI設定
if $nu.os-info.name == "windows" {
  $env.YAZI_FILE_ONE = "C:/Program Files/Git/usr/bin/file.exe"
}

# テーブルの表示モード
$env.config.table.mode = 'rounded'

# バナー表示の設定
$env.config.show_banner = false
