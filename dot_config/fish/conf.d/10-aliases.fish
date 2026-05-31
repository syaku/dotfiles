# 10-aliases.fish - エイリアス定義
# xonsh/rc.d/10-aliases.xsh を正本として揃えている。

# ディレクトリ表示
alias ls "eza --group-directories-first --hyperlink --icons=auto --color=auto"
alias ll "eza -l --group-directories-first --hyperlink --icons=auto --color=auto --git"
alias la "eza -la --group-directories-first --hyperlink --icons=auto --color=auto --git"

# 引数体系が大きく違うツール (bat/rg/fd/delta 等) は alias を張らず、実体名で使う。
# 短縮 `c`/`g` だけは bat/rg を直接指す (混乱しない範囲のショートカット)。
alias man "tldr"

# 短縮エイリアス
alias g "rg"
alias c "bat"

# エディタエイリアス
alias vim "nvim"
alias vi "nvim"

# ナビ
alias .. "cd .."

# git 短縮
alias gs "git status"
alias ga "git add"
alias gc "git commit"
alias gp "git push"
alias gl "git pull"
