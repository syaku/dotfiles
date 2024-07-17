import os

# Set history options
__xonsh__.env['XONSH_HISTORY_FILE'] = os.path.expanduser('~/.xonsh_history.json')
__xonsh__.env['XONSH_HISTORY_SIZE'] = (1000, 'commands')
__xonsh__.env['XONSH_HISTORY_TAIL_SIZE'] = (1000, 'commands')

# Set prompt (customize as needed)
$PROMPT = '{user}@{hostname}:{cwd} $ '

# Alias definitions
aliases['ls'] = 'eza --icons --hyperlink'
aliases['ll'] = 'ls -lah'
aliases['la'] = 'ls -A'
aliases['l'] = 'ls -CF'
aliases['gs'] = 'git status'
aliases['ga'] = 'git add'
aliases['gc'] = 'git commit'
aliases['gp'] = 'git push'
aliases['gl'] = 'git pull'
aliases['vim'] = 'nvim'
aliases['vi'] = 'vim'

# Set editor
$EDITOR = 'nvim'

# Function to load custom scripts
def load_custom_scripts():
    script_dir = os.path.expanduser('~/.config/xonsh/scripts/')
    if os.path.isdir(script_dir):
        for script in os.listdir(script_dir):
            script_path = os.path.join(script_dir, script)
            if os.path.isfile(script_path) and script_path.endswith('.xsh'):
                with open(script_path, 'r') as f:
                    script_content = f.read()
                    execx(script_content) 

# Load custom scripts
load_custom_scripts()

$TITLE = "{user}@{hostname}:{short_cwd} | xonsh"

xontrib load term_integration
xontrib load fzf-widgets
xontrib load zoxide
xontrib load vox

$fzf_history_binding = "c-r"
$fzf_ssh_binding = "c-s"

