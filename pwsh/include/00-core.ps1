# 文字コード関連
[System.Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding("utf-8")
[System.Console]::InputEncoding = [System.Text.Encoding]::GetEncoding("utf-8")
$env:LESSCHARSET = "utf-8"

# zoxide
Invoke-Expression (& {
    $hook = if ($PSVersionTable.PSVersion.Major -lt 6) { 'prompt' } else { 'pwd' }
    (zoxide init --hook $hook powershell | Out-String)
})

# starship
$ENV:STARSHIP_CACHE = "$HOME\AppData\Local\Temp"
Invoke-Expression (&starship init powershell)

$Host.UI.RawUI.WindowTitle = "PowerShell"
