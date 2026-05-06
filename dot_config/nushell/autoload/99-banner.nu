# 起動時バナー設定
# 対話モードでのみ fastfetch を表示する (fish の 99-banner.fish と同等)

if $nu.is-interactive and (which fastfetch | is-not-empty) {
    fastfetch
}
