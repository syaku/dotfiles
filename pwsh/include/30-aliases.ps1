function which($arg) {
  if ($arg) {
    gcm $arg | fl
  }
}

function ..() {z ..}

Set-Alias ls lsd
function ll() {ls -l}
function la() {ls -la}

Set-Alias vim nvim
Set-Alias vi nvim

function less($arg) {
  if ($arg) {
    bat $arg --paging always
  }
}
function cat() {bat -pP}

