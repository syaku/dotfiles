# エイリアス (PowerShell aliases.ps1 + functions.ps1 相当)
aliases['ls'] = 'lsd --group-dirs first --hyperlink auto --icon auto --color auto'
aliases['ll'] = 'lsd -l --group-dirs first --hyperlink auto --icon auto --color auto --git'
aliases['la'] = 'lsd -la --group-dirs first --hyperlink auto --icon auto --color auto --git'
# 引数体系が大きく違うツール (bat/rg/fd/delta 等) は alias を張らず、実体名で使う。
# 短縮 `c`/`g` だけは bat/rg を直接指す (混乱しない範囲のショートカット)。
aliases['c'] = 'bat'
aliases['g'] = 'rg'
aliases['man'] = 'tldr'
aliases['vim'] = 'nvim'
aliases['vi'] = 'nvim'
aliases['..'] = 'cd ..'
aliases['gs'] = 'git status'
aliases['ga'] = 'git add'
aliases['gc'] = 'git commit'
aliases['gp'] = 'git push'
aliases['gl'] = 'git pull'
