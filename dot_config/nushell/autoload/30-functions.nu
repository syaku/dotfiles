# 関数定義ファイル
# このファイルはカスタム関数を定義します
# 依存: 10-core.nu (check_commands関数)

# ghq + fzfでリポジトリをあいまい検索する関数
def --env ghq-fzf [] {
    if not (check_commands "ghq" "fzf") { return }
    
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
    if not (check_commands "git" "fzf" "grep" "sed" "sort") { return }
    
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

# herdr の image protocol 対応は kitty_graphics experimental のみで、yazi が選ぶ
# iTerm2 inline images (OSC 1337) は herdr 層で吸われて画像が崩れる。
# HERDR_ENV=1 のときだけ WezTerm 由来の env を隠して Chafa fallback に落とす。
def --env --wrapped yazi [...args] {
    if ($env.HERDR_ENV? | default "") == "1" {
        do {
            hide-env --ignore-errors TERM_PROGRAM TERM_PROGRAM_VERSION WEZTERM_PANE WEZTERM_EXECUTABLE WEZTERM_CONFIG_FILE WEZTERM_UNIX_SOCKET
            ^yazi ...$args
        }
    } else {
        ^yazi ...$args
    }
}
