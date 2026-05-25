# atuin (シェル履歴管理。Ctrl+R を担当)
# --disable-up-arrow: 上キーは atuin を起動せず通常の履歴ナビにする
# (数世代戻るだけの操作に atuin の全画面 UI は過剰なため)。Ctrl+R は維持。
execx($(atuin init xonsh --disable-up-arrow))
