# term-integration (WezTerm 連携: OSC マーカー・cwd 通知)
# starship の後にロードして $PROMPT をラップさせる
xontrib load term_integration

# ウィンドウタイトル (term_integration が OSC で上書きする場合あり、実機で確認)
$TITLE = 'xonsh: {short_cwd}'
