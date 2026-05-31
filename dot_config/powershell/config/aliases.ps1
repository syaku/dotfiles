# aliases.ps1 - 単純リネームのエイリアス
# 引数を変えるラッパー (ls/ll/la/less 等) は functions.ps1 を参照。
# 引数体系が大きく違うツール (bat/rg/fd/delta 等) は alias を張らず、実体名で使う。
# 短縮 `c`/`g` だけは bat/rg を直接指す (混乱しない範囲のショートカット)。
# fish/conf.d/10-aliases.fish と xonsh/rc.d/10-aliases.xsh と方針を揃えている。
# 注意: cat alias を外したので PowerShell builtin の cat=Get-Content が復活する。

# 既存の builtin alias (man=help) は -Force で上書き
Set-Alias -Force man tldr

# 短縮エイリアス
Set-Alias c bat
Set-Alias g rg

# エディタエイリアス
Set-Alias vim nvim
Set-Alias vi  nvim
