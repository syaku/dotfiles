def ghq_list():
    repository  = $(ghq root) + "/" + $(ghq list | fzf --preview @("bat --color=always --style=header,grid --line-range :80 " + $(ghq root)  +"/{}/README.*")).strip()
    if repository:
        cd @(repository)
    pass

aliases["ghq-list"] = ghq_list

@events.on_ptk_create
def custom_keybindings(bindings, **kw):
    @bindings.add('c-g')
    def fzf_git_repository(event):
        ghq_list()
        event.current_buffer.validate_and_handle()

