# エディタ設定
$env.EDITOR = "cursor"
$env.VISUAL = "cursor"

# PATH の設定
$env.PATH = ($env.PATH | split row (char esep) | prepend $"($env.HOME)/scoop/shims")
$env.PATH = ($env.PATH | split row (char esep) | prepend $"($env.HOME)/.cargo/bin")
$env.PATH = ($env.PATH | split row (char esep) | prepend "~/.local/bin")
$env.STARSHIP_SHELL = "nu"

# テーブルの表示モード
$env.config.table.mode = 'rounded'