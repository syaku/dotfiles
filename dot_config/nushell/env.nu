# 環境変数設定ファイル
# 各ツールの init 出力を vendor/autoload に書き出し、
# autoload フェーズで source させる (nushell には stdin を eval する手段がないため、
# xonsh の execx / pwsh の Invoke-Expression に相当する位置に置く)。

let vendor_autoload = ($nu.data-dir | path join "vendor/autoload")
mkdir $vendor_autoload

# starship (プロンプト)
if (which starship | is-not-empty) {
    starship init nu | save -f ($vendor_autoload | path join "starship.nu")
} else {
    print "Warning: starship is not installed"
}

# atuin (履歴管理。Ctrl+R を担当)
# --disable-up-arrow: 上キーは atuin を起動せず通常の履歴ナビにする
if (which atuin | is-not-empty) {
    atuin init nu --disable-up-arrow | save -f ($vendor_autoload | path join "atuin.nu")
} else {
    print "Warning: atuin is not installed"
}

# mise (ランタイム版管理)
if (which mise | is-not-empty) {
    mise activate nu | save -f ($vendor_autoload | path join "mise.nu")
} else {
    print "Warning: mise is not installed"
}

# zoxide (ディレクトリジャンプ): cd を zoxide で置き換え
if (which zoxide | is-not-empty) {
    zoxide init nushell --cmd cd | save -f ($vendor_autoload | path join "zoxide.nu")
} else {
    print "Warning: zoxide is not installed"
}

# carapace (マルチシェル補完)
if (which carapace | is-not-empty) {
    carapace _carapace nushell | save -f ($vendor_autoload | path join "carapace.nu")
} else {
    print "Warning: carapace is not installed"
}
