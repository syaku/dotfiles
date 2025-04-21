
let keybindings = [
  {
    name: "history-search"
    modifier: "control"
    keycode: "char_r"
    mode: "emacs"
    event: {
      edit: InsertString
      value: "atuin search --interactive\n"
    }
  }
]

$env.config.keybindings = ($env.config.keybindings | append $keybindings)