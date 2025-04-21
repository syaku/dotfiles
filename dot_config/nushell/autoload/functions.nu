# ghq-fzf: ghq のリポジトリを fzf で選択して移動
def ghq-fzf [] {
    # ghqとfzfコマンドが存在するか確認
    if (which ghq | is-empty) or (which fzf | is-empty) {
        print "Error: ghq または fzf コマンドが見つかりません。両方インストールしてください。"
        return
    }
    
    # ghqでリポジトリ一覧を取得し、fzfで選択
    let selected = (do {
        ^ghq list | ^fzf --preview "ls -la (^ghq root)/{}";
    } | complete)
    
    # 選択されたリポジトリが存在する場合、そのディレクトリに移動
    if $selected.exit_code == 0 and ($selected.stdout | str trim | is-empty) == false {
        let repo_path = (^ghq root | str trim)
        cd $"($repo_path)/($selected.stdout | str trim)"
    }
}

# fbr: ブランチを検索してcheckout
def fbr [] {
    # gitコマンドとfzfコマンドが存在するか確認
    if (which git | is-empty) or (which fzf | is-empty) {
        print "Error: git または fzf コマンドが見つかりません。両方インストールしてください。"
        return
    }
    
    # カレントディレクトリがgitリポジトリかどうか確認
    let git_check = do { ^git rev-parse --is-inside-work-tree } | complete
    if $git_check.exit_code != 0 {
        print "Error: カレントディレクトリはgitリポジトリではありません。"
        return
    }
    
    # ローカルとリモートの全ブランチを取得し、fzfで選択
    let selected = do {
        ^git branch -a | ^rg -v HEAD | ^sed "s/.* //" | ^sed "s#remotes/origin/##" | ^sort -u | ^fzf
    } | complete
    
    # 選択されたブランチが存在する場合、そのブランチをcheckout
    if $selected.exit_code == 0 and not ($selected.stdout | str trim | is-empty) {
        let branch = $selected.stdout | str trim
        ^git checkout $branch
        print $"ブランチ '($branch)' をチェックアウトしました。"
    }
}

# git-add-fzf: ファイルを選んで add
def git-add-fzf [] {
  let file = (git status --short | fzf | split row ' ' | last)
  if ($file != "") { git add $file }
}