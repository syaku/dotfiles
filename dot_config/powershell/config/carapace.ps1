# carapace.ps1 - マルチシェル補完
# Tab で MenuComplete に切り替え、carapace のスペックを取り込む

if (Get-Command carapace -ErrorAction SilentlyContinue) {
    Set-PSReadLineOption -Colors @{ "Selection" = "`e[7m" }
    Set-PSReadLineKeyHandler -Key Tab -Function MenuComplete
    $env:CARAPACE_BRIDGES = 'zsh,fish,bash,inshellisense'
    carapace _carapace | Out-String | Invoke-Expression
} else {
    Write-Warning "carapace is not installed"
}
