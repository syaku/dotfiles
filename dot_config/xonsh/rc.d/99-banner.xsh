# 対話起動時のバナー (fish の 99-banner.fish / nu の 99-banner.nu と同等)
# PowerShell の $Host.Name -eq 'ConsoleHost' 判定は $XONSH_INTERACTIVE に対応。
# スクリプト実行 (-c やファイル) 時は表示しない。
import shutil
if $XONSH_INTERACTIVE and shutil.which('fastfetch'):
    fastfetch
