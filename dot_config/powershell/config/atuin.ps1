# atuin.ps1 - シェル履歴管理
# Ctrl+R は atuin が引き取る (旧手書きの履歴fzfは廃止)

if (Get-Command atuin -ErrorAction SilentlyContinue) {
    Invoke-Expression (& atuin init powershell --disable-up-arrow | Out-String)
} else {
    Write-Warning "atuin is not installed"
}
