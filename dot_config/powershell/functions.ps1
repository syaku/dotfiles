# functions.ps1 - Unixコマンドの代替定義

remove-item alias:ls
remove-item alias:cat
remove-item alias:man
remove-item alias:cp
remove-item alias:mv
remove-item alias:rm
remove-item alias:rmdir

remove-item function:mkdir

function ls     { & "$HOME\.cargo\bin\eza.exe" --group-directories-first --hyperlink --icons @args }    # exa: lsの代替（推奨）
function ll     { & "$HOME\.cargo\bin\eza.exe" -l --group-directories-first --hyperlink --icons @args }
function la     { & "$HOME\.cargo\bin\eza.exe" -a --group-directories-first --hyperlink --icons @args }
function cat    { & "$HOME\.cargo\bin\bat.exe" @args }    # bat: catの代替
function grep   { & "$HOME\.cargo\bin\rg.exe" @args }     # ripgrep: grepの代替
function find   { & "$HOME\.cargo\bin\fd.exe" @args }     # fd: findの代替
function less   { & "$HOME\.cargo\bin\less.exe" @args }   # Rust製 less
function man    { & "$HOME\.cargo\bin\tldr.exe" @args }   # tldr のRust実装（tealdeer）

# あいまい検索
function reverse
{ 
  $arr = @($input)
  [array]::reverse($arr)
  $arr
}

function ghq-fzf {
  $path = $(ghq list -p | fzf)
  Set-Location ($path)
}

function history-fzf {
  $command = Get-Content (Get-PSReadLineOption).HistorySavePath|reverse|awk '!a[$0]++'| fzf
  [Microsoft.PowerShell.PSConsoleReadLine]::Insert($command)
}

function _fd {
  $path = $(fd . -td | fzf)
  Set-Location $path
}

function _fda {
  $path = $(fd . -td -H | fzf)
  Set-Location $path
}

# その他
function which($arg) {
  if ($arg) {
    gcm $arg | fl
  }
}

function ..() {z ..}