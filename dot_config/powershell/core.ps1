# core.ps1 - 環境初期化

# TLS 1.2を強制（Install-Module系で必須になることがある）
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# PATH に Rust製ツールのディレクトリを追加
$env:PATH += ";$HOME\.cargo\bin"

# Starship プロンプトを初期化
Invoke-Expression (&starship init powershell)

# 文字コード関連
[System.Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding("utf-8")
[System.Console]::InputEncoding = [System.Text.Encoding]::GetEncoding("utf-8")
$env:LESSCHARSET = "utf-8"

$env:EDITOR = "code"

$Host.UI.RawUI.WindowTitle = " pwsh"
