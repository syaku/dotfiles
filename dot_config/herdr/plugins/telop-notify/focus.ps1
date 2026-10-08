# telop のカードをクリックしたときに telop-app から起動される。Windows 用。Mac では focus.sh が同じことをする。
# 使い方: focus.ps1 <herdr の絶対パス> <pane_id> [<herdr の socket>]
# herdr の中のフォーカスをその pane に移し、WezTerm を前に出す。
# telop-app は herdr の環境を持たないので、herdr の場所と繋ぐ server（メインか下パネルか）は notify.ps1 が引数で渡す。
param(
    [Parameter(Mandatory)] [string] $Herdr,
    [Parameter(Mandatory)] [string] $PaneId,
    [string] $Socket = ''
)
$ErrorActionPreference = 'Stop'

if ($Socket) { $env:HERDR_SOCKET_PATH = $Socket }
& $Herdr agent focus $PaneId | Out-Null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# telop-app が起動の直前に前面に出す権利を開放している（AllowSetForegroundWindow）ので、ここから前に出せる。
$wezterm = Get-Process -Name 'wezterm-gui' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($wezterm) {
    (New-Object -ComObject WScript.Shell).AppActivate($wezterm.Id) | Out-Null
}
