# ghq-fzf: ghq のリポジトリを fzf で選択して移動
def ghq-fzf [] {
  let repo = (ghq list --full-path | fzf)
  if ($repo != "") { cd $repo }
}

# git-branch-fzf: ブランチを選択して checkout
def git-branch-fzf [] {
  let branch = (git for-each-ref --format="%(refname:short)" refs/heads/ | fzf)
  if ($branch != "") { git checkout $branch }
}

# git-add-fzf: ファイルを選んで add
def git-add-fzf [] {
  let file = (git status --short | fzf | split row ' ' | last)
  if ($file != "") { git add $file }
}