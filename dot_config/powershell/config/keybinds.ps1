# keybinds.ps1 - Unixライクなキー操作

Import-Module PSReadLine

# ショートカットキーをEmacs風に
Set-PSReadLineOption -EditMode Emacs -BellStyle None

# Tender (Gogh) 用の色補正: 既定の Parameter/Operator は color8 (#4a4a4a) で背景に埋もれるため上書き
Set-PSReadLineOption -Colors @{
    Parameter = "#d3b987"
    Operator  = "#b3deef"
}

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

# 履歴検索は atuin が Ctrl+R を担当 (config/atuin.ps1 を参照)

# ブランチ検索
Set-PSReadLineKeyHandler -Chord Ctrl+b -ScriptBlock {
    fbr
    [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
}

# 空のキーバインド（必要に応じて追加）
Set-PSReadLineKeyHandler -Key "Ctrl+j" -ScriptBlock {}
