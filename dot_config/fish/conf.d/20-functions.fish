# 20-functions.fish - Unixコマンドの代替定義

# リポジトリ検索
function ghq-fzf
    if not command -v ghq >/dev/null 2>&1; or not command -v fzf >/dev/null 2>&1
        echo "ghqまたはfzfがインストールされていません"
        return 1
    end

    set -l ghq_root (ghq root)
    set -l selected (ghq list | fzf --preview "ls -la $ghq_root/{}")

    if test -n "$selected"
        cd "$ghq_root/$selected"
    end
end

# ブランチ検索
function fbr
    if not command -v git >/dev/null 2>&1; or not command -v fzf >/dev/null 2>&1
        echo "gitまたはfzfがインストールされていません"
        return 1
    end

    if not test -d .git
        echo "カレントディレクトリはgitリポジトリではありません"
        return 1
    end

    set -l selected (git branch -a | grep -v HEAD | sed 's/.* //' | sed 's/remotes\/origin\///' | sort -u | fzf)

    if test -n "$selected"
        git checkout $selected
    end
end
