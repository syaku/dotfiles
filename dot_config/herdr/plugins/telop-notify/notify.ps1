# herdr の plugin（syaku.telop-notify）が pane.agent_status_changed を受けるたびに呼ぶ。Windows 用。
# Mac では同じ処理を notify.sh が行う。
# 入力待ち（blocked）と完了（done）になったときだけ、pane の題名を送信元にして telop に送る。
$ErrorActionPreference = 'Stop'

# herdr のカードは紫の地にし、入力待ちと完了をアイコンでも分ける。重要度は telop が丸の色で出す。
$color = '#4b2a8a'

if (-not $env:HERDR_PLUGIN_EVENT_JSON) { exit 0 }
$data = ($env:HERDR_PLUGIN_EVENT_JSON | ConvertFrom-Json).data

switch ($data.agent_status) {
    'blocked' { $level = 'warn'; $icon = [char]::ConvertFromUtf32(0x270B); $text = '入力待ちになりました' }
    'done' { $level = 'info'; $icon = [char]::ConvertFromUtf32(0x2705); $text = '完了しました' }
    default { exit 0 }
}

# herdr の出力は UTF-8 なので、既定の OEM コードページのままだと日本語の題名が化ける。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$herdr = if ($env:HERDR_BIN_PATH) { $env:HERDR_BIN_PATH } else { 'herdr.exe' }

# 出来事の title は schema にはあるが、実際の pane.agent_status_changed には入っていないことがあるので、
# 無ければ pane の題名を取り直す。取れなくても送る（送信元は pane ID になる）。
$title = if ($data.title) { [string]$data.title } else { '' }
if (-not $title -and $data.pane_id) {
    try {
        $output = & $herdr pane get $data.pane_id 2>$null
        if ($LASTEXITCODE -eq 0) {
            $pane = (($output -join "`n") | ConvertFrom-Json).result.pane
            $title = if ($pane.terminal_title_stripped) { [string]$pane.terminal_title_stripped } elseif ($pane.terminal_title) { [string]$pane.terminal_title } else { '' }
        }
    } catch {
        $title = ''
    }
}

# 題名の先頭の回転スピナーを落とし、空白をまとめる（agentbar のメニューの名前と同じ）。
# 落とすのは既知のグリフだけにする。非英数字を一律に落とすと、`~/workspace> …` や `【調査】…` の先頭まで削る。
$spinners = '◐◑◒◓✳✽⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
$title = $title.Trim()
for ($i = 0; $i -lt 4; $i++) {
    if ($title.Length -gt 0 -and $spinners.Contains($title.Substring(0, 1))) {
        $title = $title.Substring(1).TrimStart()
    } else {
        break
    }
}
$title = ($title -split '\s+' | Where-Object { $_ }) -join ' '
$name = if ($title) { $title } else { [string]$data.pane_id }

# カードのクリックで focus.ps1 がその pane に飛ぶ。telop-app の PATH で探さずに済むよう pwsh と herdr は
# 絶対パスにし、下パネルのような別のセッションの pane にも飛べるよう、この出来事を出した server の socket も渡す。
# pane ID が無ければ飛ぶ先が無いので、action を付けない。
$message = [ordered]@{ text = $text; level = $level; color = $color; icon = $icon }
if ($name) { $message.source = $name }
if ($data.pane_id) {
    $herdrPath = (Get-Command $herdr -ErrorAction SilentlyContinue).Source
    if (-not $herdrPath) { $herdrPath = $herdr }
    $action = @(
        (Get-Process -Id $PID).Path, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', (Join-Path $PSScriptRoot 'focus.ps1'), $herdrPath, [string]$data.pane_id
    )
    if ($env:HERDR_SOCKET_PATH) { $action += $env:HERDR_SOCKET_PATH }
    $message.action = $action
}

# telop send を通さず、受け口（名前付きパイプ）へ 1 行の JSON を直接書く。telop send に --color と --icon を
# 渡すと、古い telop が知らないオプションとして本文ごと拒むので、telop を先に更新するまでカードが出なくなる。
# 受け口の名前は telop の README の取り決め（TELOP_PIPE で上書き、空なら決まらない）に合わせる。
# ユーザ名は telop と同じく GetUserNameW の値を使う（[Environment]::UserName がそれを返す）。
if (Test-Path Env:TELOP_PIPE) {
    $pipe = $env:TELOP_PIPE
} else {
    $pipe = "\\.\pipe\telop-$([Environment]::UserName)"
}
if (-not $pipe) {
    [Console]::Error.WriteLine('telop の受け口の場所が決まりません（TELOP_PIPE が空）')
    exit 1
}
$pipeName = $pipe -replace '^\\\\\.\\pipe\\', ''

# 受け口は改行で行を区切るので -Compress で 1 行にする。BOM を付けると JSON として読めないので、
# BOM の無い UTF-8 のバイト列にして書く。
$line = (ConvertTo-Json -Compress -Depth 3 -InputObject $message) + "`n"
$bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($line)

# Identification で開き、受け口になりすましたパイプのサーバに、この plugin の権限を使わせない
# （telop の lib が SECURITY_IDENTIFICATION で開くのと同じ）。締切は telop send と同じ 2 秒。
$stream = [System.IO.Pipes.NamedPipeClientStream]::new(
    '.', $pipeName, [System.IO.Pipes.PipeDirection]::Out,
    [System.IO.Pipes.PipeOptions]::None, [System.Security.Principal.TokenImpersonationLevel]::Identification)
try {
    $stream.Connect(2000)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
} finally {
    $stream.Dispose()
}
