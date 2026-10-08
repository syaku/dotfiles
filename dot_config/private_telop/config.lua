-- telop の設定ファイル（Lua）。
-- 置き場所: ~/.config/telop/config.lua
--           Windows では %USERPROFILE%\.config\telop\config.lua（HOME が立っていればその下）
--
-- 初回起動時に、この内容と同じ雛形が書き出される。書き換えたあとは
-- メニューの「設定を再読み込み」で反映する（再起動は要らない）。
-- 読み込みに失敗したときは、前に読めた設定のまま動き、理由がメニューの状態行に出る。
--
-- 最後に return { ... } で設定の table を返す。知らないキーや型の誤り
-- （数の所に "700" と文字列で書いた、など）は、どこのキーかを付けて読み込みが落ちる。
-- 書かなかったキーは既定値になる。
--
-- host.os に "macos" か "windows" が入っている。OS ごとに値を変えるときに使う。
--
--   local font = nil
--   if host.os == "windows" then font = "Meiryo UI" end
--
-- 長さの単位は pt（画面の倍率を掛ける前の大きさ）。

return {
  band = {
    screen = 0,        -- 0 は主画面。1 から始まる番号で画面を選ぶ
    edge = "top",      -- "top" か "bottom"（作業領域のどちらの端に付けるか）
    offset_x = 8,      -- 作業領域の左端からの距離（pt）
    offset_y = host.os == "windows" and -8 or 8,  -- 付けた端からの距離（pt）
    width = 0,      -- 0 なら作業領域の幅いっぱい
    height = 0,        -- 0 ならカードの最大の高さから決める。正の値ならその高さ（pt）
  },
  motion = {
    speed = 350,      -- 流れる速さ（pt/秒）
    hold = 4,          -- 先頭のカードが左端で止まる秒数
    gap = 8,           -- カードとカードの間隔（pt）
  },
  card = {
    lines = 3,             -- カード全体の行数の上限（送信元の行を含む）
    fixed_height = false,  -- true ならカードの高さを上限の行数に固定する
    body_width = 320,      -- 本文を折り返す幅（pt）
    font_size = 14,        -- 本文の文字の大きさ（pt）
    font_family = nil,     -- 書体の名前。nil なら macOS は "Hiragino Sans"、Windows は "Yu Gothic UI"
  },
  colors = {               -- 重要度ごとのカードの地の色（"#rrggbb"）
    info = "#3a6ec4",
    warn = "#e0932a",
    error = "#d94848",
  },
}
