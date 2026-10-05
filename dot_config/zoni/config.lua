-- zoni の設定ファイル（Lua）。
-- 置き場所:
--   macOS   ~/.config/zoni/config.lua
--   Windows %USERPROFILE%\.config\zoni\config.lua
--
-- 書き換えたあとはメニューバーの「設定を再読み込み」で反映する（再起動は要らない）。
--
-- 最後に return { ... } で設定の table を返す。知らないキーや型の違う値を書くと、
-- 読み込みが落ちて、どこのキーか（overlay.width、zone[3].foo）が状態行に出る。
-- 使える Lua は string / table / math / utf8 / coroutine と基本関数だけ。io / os /
-- package と load / dofile は無い。
-- require("name") は、このファイルと同じディレクトリの name.lua を読んで戻り値を返す。

-- ---------------------------------------------------------------------------
-- キー操作
-- ---------------------------------------------------------------------------
--
-- 修飾子は Option(Alt) / Ctrl / Shift / Cmd(Super) を + で繋ぎ、最後にキーを 1 つ置く。
-- 矢印は Left / Right / Up / Down（ArrowLeft 等でも可）、スラッシュは / と書く。
--
-- **既定の Option+矢印は macOS 標準のテキスト移動（単語単位のカーソル移動・段落頭末
-- への移動）と重なる。** 単語移動を使うなら Ctrl+Option+矢印 などに変える。
--
-- 同じ組み合わせを 2 つ以上に書くと、どれとどれが重複かを添えて読み込みが落ちる。
-- 他のアプリが先に握っている組み合わせは登録に失敗し、取れなかった組み合わせが
-- 状態行に出る。
--
-- 書ける 9 つと、書かなかったときの既定:
--   prev_zone          前の領域へ送る                     Ctrl+Left
--   next_zone          次の領域へ送る                     Ctrl+Right
--   focus_prev_zone    前の領域のウィンドウへフォーカス   Option+Left
--   focus_next_zone    次の領域のウィンドウへフォーカス   Option+Right
--   focus_prev_window  同じ領域の前のウィンドウへ         Option+Shift+Left
--   focus_next_window  同じ領域の次のウィンドウへ         Option+Shift+Right
--   maximize           作業領域いっぱいに広げる           Option+Up
--   minimize           最小化する                         Option+Down
--   overlay            領域のオーバーレイを出し入れする   Option+/

-- 領域へ送るキーだけ OS で書き分ける。macOS は Karabiner で修飾キーを入れ替えて
-- あるので、同じ綴りが両 OS で別の物理キーになる。
local send_modifier = host.os == "windows" and "Cmd" or "Ctrl"

return {
  hotkeys = {
    prev_zone = send_modifier .. "+Left",
    next_zone = send_modifier .. "+Right",
    -- focus_prev_zone = "Option+Left",
    -- focus_next_zone = "Option+Right",
    focus_prev_window = "Option+Up",
    focus_next_window = "Option+Down",
    maximize = "Option+x",
    minimize = "Option+Shift+x",
    overlay = "Option+/",
  },

  -- -------------------------------------------------------------------------
  -- 除外
  -- -------------------------------------------------------------------------
  --
  -- 除外するアプリの並びは、同じディレクトリの exclude.lua に書く。exclude.lua は
  -- マシンごとに置き、dotfiles では配らない。無いマシンでは除外なしで読むように
  -- pcall で包む。包むと、exclude.lua の中身が誤っていても黙って除外なしになる。
  exclude = (function()
    local ok, exclude = pcall(require, "exclude")
    if ok then
      return exclude
    end
  end)(),

  -- -------------------------------------------------------------------------
  -- 領域
  -- -------------------------------------------------------------------------
  --
  -- 画面の作業領域（メニューバーと Dock を除いた範囲）に対する**割合**で書く。
  -- 0.0 が左端・上端、1.0 が右端・下端。解像度を変えても同じ位置関係になる。
  --
  --   left    左端の位置
  --   top     上端の位置
  --   right   右端の位置
  --   bottom  下端の位置
  --   name    オーバーレイに出す名前（省略可）
  --
  -- 幅ではなく**端の位置**で書くのは、隣り合う領域の境目が両方に同じ数として現れる
  -- ため。手で書き換えたときの隙間や重なりを目で見つけられる。
  --
  -- **領域どうしは重なってよい。** 「次の領域」はこの**並びの順**をそのまま辿る
  -- （画面上の位置の順ではない）。
  --
  -- 値が 0.0〜1.0 の外にあるか、right が left 以下（幅が 0 以下）だと、その設定は
  -- 読み込まれない。常駐は止まらず、メニューバーの状態行とログに理由が出る。
  zone = {
    { name = "全体", left = 0.0, top = 0.0, right = 1.0, bottom = 1.0 },
    { name = "左半分", left = 0.0, top = 0.0, right = 0.5, bottom = 1.0 },
    { name = "右半分", left = 0.5, top = 0.0, right = 1.0, bottom = 1.0 },
    { name = "右上", left = 0.5, top = 0.0, right = 1.0, bottom = 0.5 },
    { name = "右下", left = 0.5, top = 0.5, right = 1.0, bottom = 1.0 },
    { name = "右下左", left = 0.5, top = 0.5, right = 0.75, bottom = 1.0 },
    { name = "右下右", left = 0.75, top = 0.5, right = 1.0, bottom = 1.0 },
    { name = "右下右上", left = 0.75, top = 0.5, right = 1.0, bottom = 0.75 },
    { name = "右下右下", left = 0.75, top = 0.75, right = 1.0, bottom = 1.0 },
  },

  -- -------------------------------------------------------------------------
  -- 余白
  -- -------------------------------------------------------------------------
  --
  -- gap は隣り合う領域どうしの隙間、edge は画面の端に残す隙間（どちらも px。既定 0）。
  -- 負の値を書くと読み込みが落ちる。edge は maximize にも効く。
  layout = {
    gap = 8.0,
    edge = 8.0,
  },

  -- -------------------------------------------------------------------------
  -- オーバーレイ
  -- -------------------------------------------------------------------------
  --
  -- border_width  領域の枠の太さ（px。既定 2）
  -- label         各領域に出す文字。"number" / "name" / "both"（既定 "name"）
  -- border_color  枠の色。"#RRGGBB" か "#RRGGBBAA"（既定はシステムの青）
  -- fill_color    ドラッグの落とし先を塗る色（既定はシステムの青。不透明度を書かないと 0.5）
  -- text_color    文字の色（既定は白）
  -- 読めない label や色は、そのキーだけ既定に戻り、理由が状態行に出る。
  overlay = {
    border_width = 1.0,
    -- label = "both",
    -- border_color = "#4A90D9",
    -- fill_color = "#4A90D940",
    -- text_color = "#FFFFFF",
  },

  -- -------------------------------------------------------------------------
  -- 自動配置
  -- -------------------------------------------------------------------------
  --
  -- enabled を true にすると、新しく開いたウィンドウを最も近い領域へ送る。既定は false。
  placement = {
    enabled = true,
  },

  -- -------------------------------------------------------------------------
  -- ドラッグ
  -- -------------------------------------------------------------------------
  --
  -- enabled を true にすると、ドラッグしたウィンドウを離した位置の領域へ収める。既定は false。
  -- escape_modifier を押している間は収めない。Shift / Ctrl / Option / Cmd のどれか 1 つ
  -- （既定 "Shift"）。
  drag = {
    enabled = true,
    escape_modifier = "Shift",
  },

  -- -------------------------------------------------------------------------
  -- フォーカスの枠
  -- -------------------------------------------------------------------------
  --
  -- enabled を true にすると、いま操作しているウィンドウの外側に枠を出し続ける。
  -- 書かなければ false。フォーカスが移れば枠も移り、ウィンドウを動かしている最中も
  -- 大きさを変えている最中も追随する。枠の上のクリックは下のウィンドウへ通る。
  --
  -- border_width は枠の太さ（px。既定 2）、corner_radius はウィンドウの角の丸みに
  -- 合わせる半径（px。既定 10）、border_color は枠の色（既定はシステムのオレンジ）。
  --
  -- この機能だけ非公開の API（SkyLight）を使う。引けない環境では枠が出ず、状態行に出る。
  focus = {
    enabled = true,
    -- border_width = 2.0,
    -- corner_radius = 10.0,
    -- border_color = "#FF9500",
  },
}
