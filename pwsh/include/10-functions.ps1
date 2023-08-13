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
