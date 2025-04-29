# keybinds.ps1 - Unixライクなキー操作

Import-Module PSReadLine

# ショートカットキーをEmacs風に
Set-PSReadLineOption -EditMode Emacs -BellStyle None

# 基本的なキーバインド
Set-PSReadLineKeyHandler -Chord Ctrl+L -Function ClearScreen
Set-PSReadLineKeyHandler -Chord Ctrl+A -Function BeginningOfLine
Set-PSReadLineKeyHandler -Chord Ctrl+E -Function EndOfLine
Set-PSReadLineKeyHandler -Chord Ctrl+U -Function BackwardDeleteLine
Set-PSReadLineKeyHandler -Chord Ctrl+K -Function ForwardDeleteLine

# リポジトリ検索
Set-PSReadLineKeyHandler -Chord Ctrl+g -ScriptBlock {
    ghq-fzf
    [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
}

# 履歴検索
Set-PSReadLineKeyHandler -Chord Ctrl+r -ScriptBlock {
    $command = Get-Content (Get-PSReadLineOption).HistorySavePath | reverse | Select-Object -Unique | & fzf
    if ($command) {
        [Microsoft.PowerShell.PSConsoleReadLine]::Insert($command)
    }
}

# ブランチ検索
Set-PSReadLineKeyHandler -Chord Ctrl+b -ScriptBlock {
    fbr
    [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
}

# 空のキーバインド（必要に応じて追加）
Set-PSReadLineKeyHandler -Key "Ctrl+j" -ScriptBlock {}
