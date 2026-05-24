# shell-integration.ps1 - OSC エスケープによるターミナル連携
# OSC2: ウィンドウタイトル更新 (動的)
# OSC7: 作業ディレクトリ通知 (wezterm 等で新規ペインを同じ cwd で開く)

# 既存の prompt 関数 (mise.ps1 が差し込んだものを含む) を保存
if (-not $Global:__shellint_previous_prompt_function) {
    $Global:__shellint_previous_prompt_function = $function:prompt
}

function global:prompt {
    # 元 prompt を先に実行 (starship 出力を取り出す)
    $rendered = & $__shellint_previous_prompt_function

    $cwd = (Get-Location).ProviderPath
    try {
        $uri = ([System.Uri]$cwd).AbsoluteUri
    } catch {
        $uri = $cwd
    }

    # タイトル表示用にホーム配下を ~ に置換
    if ($cwd.StartsWith($HOME, [System.StringComparison]::OrdinalIgnoreCase)) {
        $displayCwd = '~' + $cwd.Substring($HOME.Length)
    } else {
        $displayCwd = $cwd
    }

    # OSC2 (タイトル) + OSC7 (cwd) を ANSI シーケンスで送出
    $osc = "`e]2;pwsh: $displayCwd`e\`e]7;$uri`e\"

    if ($rendered -is [string]) {
        $osc + $rendered
    } else {
        $osc
    }
}
