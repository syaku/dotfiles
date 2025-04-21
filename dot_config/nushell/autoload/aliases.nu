def ll [] {
  ls | sort-by type name | table
}

def la [] {
  ls -a | sort-by type name | table
}

alias ls = eza --icons --hyperlink --color=always --group-directories-first
alias cat = bat
alias grep = rg
alias find = fd
alias man = tldr
alias g = rg
alias c = bat