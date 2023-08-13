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


