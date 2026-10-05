# herdr の plugin（syaku.claude-tab-title）が pane.agent_status_changed を受けるたびに呼ぶ。Windows 用。
# Mac では同じ処理を tab-title.sh が行う。
# イベントを出した pane が Claude で、タブの中で最初の Claude の pane なら、タブ名をその題名に付け直す。
$ErrorActionPreference = 'Stop'

# タブ名の上限の幅。半角を 1、全角を 2 と数え、超えたら末尾を … にする。0 なら切り詰めない。
$maxWidth = 10

# herdr の出力は UTF-8 なので、既定の OEM コードページのままだと日本語の題名が化ける。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$herdr = if ($env:HERDR_BIN_PATH) { $env:HERDR_BIN_PATH } else { 'herdr.exe' }

function Invoke-Herdr {
    $output = & $herdr @args
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    ($output -join "`n") | ConvertFrom-Json
}

# pane ID の末尾は、workspace ごとに作った順に増える番号を 32 文字で符号化したもの（herdr の encode_public_number）。
function Get-PaneNumber([string]$paneId) {
    $alphabet = '123456789ABCDEFGHJKMNPQRSTVWXYZ0'
    $number = 0
    foreach ($c in $paneId.Substring($paneId.LastIndexOf(':p') + 2).ToCharArray()) {
        $number = $number * 32 + $alphabet.IndexOf($c) + 1
    }
    $number
}

function Get-Width([char]$c) {
    if ([int]$c -lt 128) { 1 } else { 2 }
}

if (-not $env:HERDR_PLUGIN_EVENT_JSON) { exit 0 }
$paneId = ($env:HERDR_PLUGIN_EVENT_JSON | ConvertFrom-Json).data.pane_id
if (-not $paneId) { exit 0 }

$pane = (Invoke-Herdr pane get $paneId).result.pane
if ($pane.agent -ne 'claude') { exit 0 }
$tabId = $pane.tab_id

# タブに Claude の pane が 2 つ以上あるときは、最初の pane の題名を使う。
$first = (Invoke-Herdr pane list).result.panes |
    Where-Object { $_.tab_id -eq $tabId -and $_.agent -eq 'claude' } |
    Sort-Object { Get-PaneNumber $_.pane_id } |
    Select-Object -First 1
if ($first.pane_id -ne $paneId) { exit 0 }

$title = [string]$pane.terminal_title_stripped
if (-not $title) { exit 0 }

$total = 0
foreach ($c in $title.ToCharArray()) { $total += Get-Width $c }
$label = $title
if ($maxWidth -gt 0 -and $total -gt $maxWidth) {
    $width = 0
    $builder = New-Object System.Text.StringBuilder
    foreach ($c in $title.ToCharArray()) {
        $width += Get-Width $c
        if ($width -gt $maxWidth - 1) { break }
        [void]$builder.Append($c)
    }
    $label = $builder.ToString() + [char]0x2026
}

$current = (Invoke-Herdr tab get $tabId).result.tab.label
if ($label -ceq $current) { exit 0 }
& $herdr tab rename $tabId $label
exit $LASTEXITCODE
