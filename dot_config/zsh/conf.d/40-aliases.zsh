alias ls='eza --icons --hyperlink'
alias ll='ls -l'
alias la='ll -a'

# tldr を man 代わりに（man ページ本体は `command man <x>` で参照できる）
alias man='tldr'

# 短縮エイリアス（従来 grep/cat は引数互換のため温存し、短縮だけ実体ツールに向ける）
alias g='rg'
alias c='bat'

# エディタ
alias vim='nvim'
alias vi='nvim'