## cdr
autoload -Uz add-zsh-hock
autoload -Uz chpwd_recent_dirs cdr add-zsh-hook

autoload -U compinit
compinit -u
bindkey -e

autoload -Uz colors
colors

autoload -Uz vcs_info
zstyle ':vcs_info:*' enable git svn
zstyle ':vcs_info:*' max-exports 6 # formatに入る変数の最大数
zstyle ':vcs_info:git:*' check-for-changes true
zstyle ':vcs_info:git:*' formats '%b@%r' '%c' '%u'
zstyle ':vcs_info:git:*' actionformats '%b@%r|%a' '%c' '%u'
setopt prompt_subst
function vcs_echo {
    local st branch color
    STY= LANG=en_US.UTF-8 vcs_info
    st=`git status 2> /dev/null`
    if [[ -z "$st" ]]; then return; fi
    branch="$vcs_info_msg_0_"
    if   [[ -n "$vcs_info_msg_1_" ]]; then color=${fg[green]} #staged
    elif [[ -n "$vcs_info_msg_2_" ]]; then color=${fg[red]} #unstaged
    elif [[ -n `echo "$st" | grep "^Untracked"` ]]; then color=${fg[blue]} # untracked
    else color=${fg[cyan]}
    fi
    echo "%{$color%}(%{$branch%})%{$reset_color%}" | sed -e s/@/"%F{yellow}@%f%{$color%}"/
}
PROMPT='
%F{yellow}[%~]%f `vcs_echo`
%(?.$.%F{red}$%f) '

source ~/.zplug/zplug

zplug "chrissicool/zsh-256color", of:"zsh-256color.plugin.zsh"
zplug "zsh-users/zsh-completions"

zplug "mollifier/anyframe"
zplug "zsh-users/zsh-syntax-highlighting", nice:10

# check コマンドで未インストール項目があるかどうか verbose にチェックし
# false のとき（つまり未インストール項目がある）y/N プロンプトで
# インストールする
if ! zplug check --verbose; then
    printf "Install? [y/N]: "
    if read -q; then
       echo; zplug install
    fi
fi

# プラグインを読み込み、コマンドにパスを通す
zplug load --verbose

## よく移動するディレクトリ一覧をインクリメントサーチ & 移動
bindkey '^@' anyframe-widget-cdr

## bash history一覧インクリメントサーチ & 実行
bindkey '^r' anyframe-widget-execute-history

## branch一覧をインクリメントサーチ & checkout
bindkey '^b' anyframe-widget-checkout-git-branch
## gitリポジトリへ移動
bindkey '^]' anyframe-widget-cd-ghq-repository  

## プロセス一覧をインクリメントサーチ & kill
bindkey '^x^k' anyframe-widget-kill

export LSCOLORS=gxfxcxdxbxegedabagacad
alias ls='ls -G'
