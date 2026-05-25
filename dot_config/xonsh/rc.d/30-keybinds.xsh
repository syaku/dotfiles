# キーバインド (PowerShell keybinds.ps1 相当)
# Ctrl+b = fbr / Ctrl+g = ghq-list (どちらも 20-functions.xsh で定義)
# Ctrl+A/E/U/K/L は prompt-toolkit の emacs 既定で効くため未定義
@events.on_ptk_create
def _custom_keybindings(bindings, **kw):
    @bindings.add('c-b')
    def _run_fbr(event):
        _fbr([])
        event.current_buffer.validate_and_handle()

    @bindings.add('c-g')
    def _run_ghq(event):
        ghq_list()
        event.current_buffer.validate_and_handle()
