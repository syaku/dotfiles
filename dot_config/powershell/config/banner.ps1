# banner.ps1 - 対話起動時のバナー (fish の 99-banner.fish / nu の 99-banner.nu と同等)

if ($Host.Name -eq 'ConsoleHost' -and (Get-Command fastfetch -ErrorAction SilentlyContinue)) {
    fastfetch
}
