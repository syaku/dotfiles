# 関数 (PowerShell functions.ps1 相当)
import subprocess

# fbr: ブランチを fzf で選んで checkout
def _fbr(args):
    r = subprocess.run(['git', 'branch', '-a', '--format=%(refname:short)'],
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    if r.returncode != 0:
        return
    cands = sorted({b.replace('origin/', '') for b in (x.strip() for x in r.stdout.splitlines())
                    if b and 'HEAD' not in b})
    if not cands:
        return
    f = subprocess.run(['fzf'], input='\n'.join(cands), stdout=subprocess.PIPE, text=True)
    sel = f.stdout.strip()
    if sel:
        subprocess.run(['git', 'checkout', sel])
aliases['fbr'] = _fbr

# ghq-fzf: ghq リポジトリを fzf で選んで移動
# fzf を Esc 等でキャンセルすると exit 130 を返す。xonsh の $(...) はこれを
# CalledProcessError にして ptk イベントループで未処理例外になるため、
# fbr と同様 subprocess.run で受けて returncode を無視する。
def ghq_fzf():
    root = $(ghq root).strip()
    repos = subprocess.run(['ghq', 'list'], stdout=subprocess.PIPE, text=True).stdout
    preview = 'bat --color=always --style=header,grid --line-range :80 ' + root + '/{}/README.*'
    f = subprocess.run(['fzf', '--preview', preview], input=repos, stdout=subprocess.PIPE, text=True)
    sel = f.stdout.strip()
    if sel:
        cd @(root + '/' + sel)
aliases['ghq-fzf'] = ghq_fzf
