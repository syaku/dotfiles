# functions.ps1 - 引数を変えるラッパー
# 単純リネーム (cat/man/vim/vi/g/c) は aliases.ps1 にある。
# xonsh/rc.d/10-aliases.xsh + 20-functions.xsh を正本として揃えている。

# function で上書きする builtin alias を削除
remove-item alias:ls -ErrorAction SilentlyContinue
remove-item alias:cp -ErrorAction SilentlyContinue
remove-item alias:mv -ErrorAction SilentlyContinue
remove-item alias:rm -ErrorAction SilentlyContinue
remove-item alias:rmdir -ErrorAction SilentlyContinue
# git 短縮 (gc/gp/gl) は PowerShell builtin alias (Get-Content/Get-ItemProperty/Get-Location) と衝突するので外す
remove-item alias:gc -ErrorAction SilentlyContinue
remove-item alias:gp -ErrorAction SilentlyContinue
remove-item alias:gl -ErrorAction SilentlyContinue
remove-item function:mkdir -ErrorAction SilentlyContinue

# Unix代替コマンド (lsd/bat) は scoop/shims に集約済み。
# core.ps1 が $HOME\scoop\shims を PATH 先頭に入れるので、コマンド名で解決する。

# ディレクトリ表示の関数
function ls     { & lsd --group-dirs first --hyperlink auto --icon auto --color auto @args }
function ll     { & lsd -l --group-dirs first --hyperlink auto --icon auto --color auto --git @args }
function la     { ll -a @args }

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

# git 短縮 (alias は引数を渡せないので function で実装)
function gs { & git status @args }
function ga { & git add @args }
function gc { & git commit @args }
function gp { & git push @args }
function gl { & git pull @args }
