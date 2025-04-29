# functions.ps1 - Unixコマンドの代替定義

# 既存のエイリアスと関数を削除
remove-item alias:ls -ErrorAction SilentlyContinue
remove-item alias:cat -ErrorAction SilentlyContinue
remove-item alias:man -ErrorAction SilentlyContinue
remove-item alias:cp -ErrorAction SilentlyContinue
remove-item alias:mv -ErrorAction SilentlyContinue
remove-item alias:rm -ErrorAction SilentlyContinue
remove-item alias:rmdir -ErrorAction SilentlyContinue
remove-item function:mkdir -ErrorAction SilentlyContinue

# ディレクトリ表示の関数
function ls     { & "$HOME\.cargo\bin\eza.exe" --group-directories-first --hyperlink --icons --color=always @args }
function ll     { & "$HOME\.cargo\bin\eza.exe" -l --group-directories-first --hyperlink --icons --color=always @args }
function la     { & "$HOME\.cargo\bin\eza.exe" -a --group-directories-first --hyperlink --icons --color=always @args }

# ファイル操作の関数
function cat    { & "$HOME\.cargo\bin\bat.exe" @args }
function grep   { & "$HOME\.cargo\bin\rg.exe" @args }
function find   { & "$HOME\.cargo\bin\fd.exe" @args }
function man    { & "$HOME\.cargo\bin\tldr.exe" @args }

# lessの代替としてのbat
function less {
    param([Parameter(ValueFromPipeline=$true)]$InputObject)
    if ($InputObject) {
        $InputObject | & "$HOME\.cargo\bin\bat.exe" --paging=always
    } elseif ($args) {
        & "$HOME\.cargo\bin\bat.exe" --paging=always @args
    } else {
        Write-Error "使用方法: less <ファイル名> または パイプで入力"
    }
}

# あいまい検索
function reverse { 
    $arr = @($input)
    [array]::reverse($arr)
    $arr
}

# ghq + fzfでリポジトリをあいまい検索する関数
function ghq-fzf {
    if (-not (Get-Command ghq -ErrorAction SilentlyContinue) -or -not (Get-Command fzf -ErrorAction SilentlyContinue)) {
        Write-Error "ghqまたはfzfがインストールされていません"
        return
    }
    
    $ghq_root = & ghq root
    $selected = & ghq list | & fzf --preview "ls -la $ghq_root/{}"
    
    if ($selected) {
        Set-Location "$ghq_root/$selected"
    }
}

# ブランチをあいまい検索してcheckoutする関数
function fbr {
    if (-not (Get-Command git -ErrorAction SilentlyContinue) -or -not (Get-Command fzf -ErrorAction SilentlyContinue)) {
        Write-Error "gitまたはfzfがインストールされていません"
        return
    }
    
    if (-not (Test-Path .git)) {
        Write-Error "カレントディレクトリはgitリポジトリではありません"
        return
    }
    
    $selected = & git branch -a | Select-String -NotMatch "HEAD" | ForEach-Object { $_.Line.Trim() -replace ".* ", "" -replace "remotes/origin/", "" } | Sort-Object -Unique | & fzf
    
    if ($selected) {
        & git checkout $selected
    }
}

# その他
function which($arg) {
    if ($arg) {
        Get-Command $arg | Format-List
    }
}

function ..() { Set-Location .. }