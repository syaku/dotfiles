# cd を zoxide に置き換える（z→cd, zi→cdi）。実体は builtin cd 経由なので chpwd フックも発火する
eval "$(zoxide init zsh --cmd cd)"