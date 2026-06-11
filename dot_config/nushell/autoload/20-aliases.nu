# エイリアス設定ファイル
# xonsh/rc.d/10-aliases.xsh を正本として揃えている。
# 依存: 10-core.nu (check_command関数)

#alias ls-builtin = ls

# ディレクトリ表示
# ls は nushell builtin (構造化データ + table) を残し、ll/la のみ lsd に差し替える設計 (nu固有)
#alias ls = lsd --group-dirs first --hyperlink auto --icon auto --color auto

alias ll = lsd -l --group-dirs first --hyperlink auto --icon auto --color auto --git
alias la = ll -a

# 引数体系が大きく違うツール (bat/rg/fd/delta 等) は alias を張らず、実体名で使う。
# 短縮 c/g だけは実体ツールに向ける。
alias c = bat

alias g = rg

alias man = tldr

alias vi = nvim
alias vim = nvim

# ナビ
alias .. = cd ..

# git 短縮
alias gs = git status
alias ga = git add
alias gc = git commit
alias gp = git push
alias gl = git pull
