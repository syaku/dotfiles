$env.config = ($env.config | upsert keybindings (
    $env.config.keybindings | append {
        name: ghq_fzf_binding
        modifier: control
        keycode: char_g
        mode: [emacs, vi_normal, vi_insert]  # すべてのモードで有効
        event: { 
            send: executehostcommand
            cmd: "ghq-fzf"
        }
    }
))