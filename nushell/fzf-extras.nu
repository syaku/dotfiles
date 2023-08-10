def-env __zd [
    -a
] {
    mut $args = []
    if $a {$args = ($args | append $'-H')}
    let path = fd $args --type d | fzf | decode utf-8 | str trim
    z $path
}

alias zd = __zd
