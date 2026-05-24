# zoxide.ps1 - ディレクトリジャンプ

if (Get-Command zoxide -ErrorAction SilentlyContinue) {
    Invoke-Expression (& zoxide init powershell | Out-String)
} else {
    Write-Warning "zoxide is not installed"
}
