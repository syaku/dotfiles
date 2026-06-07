# 環境変数・PATH (PowerShell core.ps1 相当)
import os

# プロンプトをスレッドで非同期描画する（git status 等が遅くても入力が即座に出る）
$ENABLE_ASYNC_PROMPT = True

# 補完候補の表示形式（multi=複数列。既定値だが意図を明示して固定）
$COMPLETIONS_DISPLAY = 'multi'

# 補完の生成をバックグラウンドスレッドで行い、タイピングの引っかかりを防ぐ
$COMPLETION_IN_THREAD = True

# キー入力ごとに補完候補を再評価して表示する（fish 風のライブ補完）
# $UPDATE_COMPLETIONS_ON_KEYPRESS = True

# コマンドキャッシュをセッション間で保存して起動を速くする
$COMMANDS_CACHE_SAVE_INTERMEDIATE = True

# 履歴
$XONSH_HISTORY_FILE = os.path.expanduser('~/.xonsh_history.json')
$XONSH_HISTORY_SIZE = (3000, 'commands')
$XONSH_HISTORY_TAIL_SIZE = (3000, 'commands')

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
