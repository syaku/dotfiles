# キーバインド設定ファイル
# このファイルはカスタムキーバインドを定義します

# カスタムキーバインドの定義
let custom_keybindings = [
    {
        name: ghq_fzf_binding
        modifier: control
        keycode: char_g
        mode: [emacs, vi_normal, vi_insert]  # すべてのモードで有効
        event: { 
            send: executehostcommand
            cmd: "ghq-fzf"
        }
    }
    # 追加のキーバインドをここに記述可能
]

# キーバインドの設定を適用
$env.config = ($env.config | upsert keybindings (
    $env.config.keybindings | append $custom_keybindings
)) 