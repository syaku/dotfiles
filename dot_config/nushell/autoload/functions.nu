# ghq + fzfでリポジトリをあいまい検索する関数
def --env ghq-fzf [] {
    # ghqとfzfコマンドが存在するか確認
    if (which ghq | is-empty) or (which fzf | is-empty) {
        print "Error: ghq または fzf コマンドが見つかりません。両方インストールしてください。"
        return
    }
    
    # ghqのルートパスを先に取得
    let ghq_root = do { ^ghq root } | complete | get stdout | str trim
    
    # ghqでリポジトリ一覧を取得し、fzfで選択
    let selected = do { 
        ^ghq list | ^fzf --preview $"ls -la ($ghq_root)/{}"
    } | complete
    
    # 選択されたリポジトリが存在する場合、そのディレクトリに移動
    if $selected.exit_code == 0 and not ($selected.stdout | str trim | is-empty) {
        let repo_path = $selected.stdout | str trim
        cd $"($ghq_root)/($repo_path)"
    }
}

# ブランチをあいまい検索してcheckoutする関数
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
        # ローカルとリモートのブランチを取得して加工
        ^git branch -a | ^grep -v HEAD | ^sed "s/.* //" | ^sed "s#remotes/origin/##" | ^sort -u | ^fzf
    } | complete
    
    # 選択されたブランチが存在する場合、そのブランチをcheckout
    if $selected.exit_code == 0 and not ($selected.stdout | str trim | is-empty) {
        let branch = $selected.stdout | str trim
        ^git checkout $branch
    }
}
