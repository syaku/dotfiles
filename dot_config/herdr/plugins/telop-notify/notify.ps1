# herdr の plugin（syaku.telop-notify）が pane.agent_status_changed を受けるたびに呼ぶ。Windows 用。
# Mac では同じ処理を notify.sh が行う。
# 入力待ち（blocked）と完了（done）になったときだけ、pane の題名を送信元にして telop に送る。
$ErrorActionPreference = 'Stop'

# plugin は herdr のサーバーから起動され、PATH に telop があるとは限らないので、絶対パスで呼ぶ。
# cargo install の入れ先は ~/.cargo/config.toml の [install] root（.local）に従う。
$telop = if ($env:TELOP_BIN) { $env:TELOP_BIN } else { Join-Path $env:USERPROFILE '.local\bin\telop.exe' }

if (-not $env:HERDR_PLUGIN_EVENT_JSON) { exit 0 }
$data = ($env:HERDR_PLUGIN_EVENT_JSON | ConvertFrom-Json).data

switch ($data.agent_status) {
    'blocked' { $level = 'warn'; $text = '入力待ちになりました' }
    'done' { $level = 'info'; $text = '完了しました' }
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

& $telop send --source $name --level $level -- $text
exit $LASTEXITCODE
