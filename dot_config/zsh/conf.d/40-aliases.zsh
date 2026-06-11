# 40-aliases.zsh - エイリアス定義
# xonsh/rc.d/10-aliases.xsh を正本として揃えている。

# ディレクトリ表示
alias ls='lsd --group-dirs first --hyperlink auto --icon auto --color auto'
alias ll='lsd -l --group-dirs first --hyperlink auto --icon auto --color auto --git'
alias la='lsd -la --group-dirs first --hyperlink auto --icon auto --color auto --git'

# tldr を man 代わりに（man ページ本体は `command man <x>` で参照できる）
alias man='tldr'

# 引数体系が大きく違うツール (bat/rg/fd/delta 等) は alias を張らず、実体名で使う。
# 短縮 c/g だけは実体ツールに向ける。
alias g='rg'
alias c='bat'

# エディタ
alias vim='nvim'
alias vi='nvim'

# ナビ
alias ..='cd ..'

# git 短縮
alias gs='git status'
alias ga='git add'
alias gc='git commit'
alias gp='git push'
alias gl='git pull'
