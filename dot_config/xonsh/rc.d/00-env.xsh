# 環境変数・PATH (PowerShell core.ps1 相当)
import os

# 履歴
$XONSH_HISTORY_FILE = os.path.expanduser('~/.xonsh_history.json')
$XONSH_HISTORY_SIZE = (1000, 'commands')
$XONSH_HISTORY_TAIL_SIZE = (1000, 'commands')

# エディタ・ページャ
$EDITOR = 'nvim'
$VISUAL = 'code --wait'
$GIT_EDITOR = 'code --wait'
$GIT_PAGER = 'delta'
$LESSCHARSET = 'utf-8'

# PATH 先頭追加 (scoop / cargo / .local)。既にあれば挿入しない
for _p in (os.path.expanduser(p) for p in ('~/scoop/shims', '~/.cargo/bin', '~/.local/bin')):
    if _p not in $PATH:
        $PATH.insert(0, _p)
