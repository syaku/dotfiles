# fortune設定ファイル
# このファイルは起動時のfortune表示を設定します
# 依存: 10-core.nu (check_commands関数)

# fortuneの表示
if (check_commands "fortune" "lolcat") {
    fortune .config\fortune\* | lolcat
} 