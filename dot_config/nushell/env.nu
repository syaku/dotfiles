# 環境変数設定ファイル
# このファイルは基本的な環境変数の設定を行います

# ベンダーディレクトリのパスを生成する関数
def get_vendor_path [name: string] {
    $nu.data-dir | path join "vendor/autoload" $name
}

# ツールの初期化を行う関数
def init_tool [name: string, init_command: string, description: string] {
    if not (which $name | is-empty) {
        try {
            nu -c $init_command | save -f (get_vendor_path $"($name).nu")
        } catch { |e| 
            print $"Failed to initialize ($name): ($e)"
        }
    } else {
        print $"Warning: ($name) is not installed"
    }
}

# ベンダーディレクトリの作成
mkdir ($nu.data-dir | path join "vendor/autoload")

# 各ツールの初期化
init_tool "starship" "starship init nu" "プロンプトカスタマイズ"
init_tool "atuin" "atuin init nu --disable-up-arrow" "コマンド履歴管理"
init_tool "mise" "mise activate nu" "バージョン管理"
init_tool "zoxide" "zoxide init nushell" "ディレクトリジャンプ"