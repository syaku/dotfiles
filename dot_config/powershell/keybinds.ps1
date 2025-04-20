# keybinds.ps1 - Unixライクなキー操作

Import-Module PSReadLine

Set-PSReadLineKeyHandler -Chord Ctrl+L -Function ClearScreen
Set-PSReadLineKeyHandler -Chord Ctrl+A -Function BeginningOfLine
Set-PSReadLineKeyHandler -Chord Ctrl+E -Function EndOfLine
Set-PSReadLineKeyHandler -Chord Ctrl+U -Function BackwardDeleteLine
Set-PSReadLineKeyHandler -Chord Ctrl+K -Function ForwardDeleteLine

# ショートカットキーをEmacs風に
Set-PSReadLineOption -EditMode Emacs -BellStyle None

# リポジトリ検索
Set-PSReadLineKeyHandler -Chord Ctrl+g -ScriptBlock {
  ghq-fzf
  [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
}

# History検索
Set-PSReadLineKeyHandler -Chord Ctrl+r -ScriptBlock {
  history-fzf
}

Set-PSReadLineKeyHandler -Key "Ctrl+j" -ScriptBlock {}
