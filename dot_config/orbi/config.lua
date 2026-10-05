-- orbi の設定ファイル（Lua）。
-- 置き場所: ~/.config/orbi/config.lua
--
-- 書き換えたあとはメニューバーの「設定を再読み込み」で反映する（再起動は要らない）。
-- 書けるのは下の 4 項目だけで、どれも省略できる。
--
-- 最後に return { ... } で設定の table を返す。知らないキーを書いたときと、table を
-- 返さないとき（return の書き忘れ、空のファイル、全部をコメントにしたファイル）は
-- 読み込みが落ち、状態行が「設定ファイルを読み込めませんでした」になる。エラーの全文は
-- ~/Library/Logs/orbi.err.log に出る。
-- 使える Lua は string / table / math / utf8 / coroutine と基本関数だけ。io / os /
-- package と load / dofile は無い。
-- require("name") は、このファイルと同じディレクトリの name.lua を読んで戻り値を返す。

-- 呼び出しホットキー。修飾子は Option(Alt) / Ctrl / Shift / Super(Cmd) を + で繋ぐ。
-- 3 本とも常時登録するので、同じ組み合わせを 2 本以上に書くと 3 本とも登録されず、
-- 状態行が「ホットキー: 登録できませんでした」になる（常駐は続く）。
--
-- 3 本とも Option を含む組み合わせにすること。一覧が開いているのは Option を押している
-- 間だけで、Option が押されていない発火は捨てる作りなので、Option を含まない組み合わせ
-- は登録できても一度も反応しない。読み込みの段で弾いて、状態行が
-- 「設定ファイルを読み込めませんでした」になる（常駐は続き、前の設定のまま動く）。
--
--   hotkey_next    一覧を開く / 選択を 1 つ進める        既定 "Option+Tab"
--   hotkey_prev    選択を 1 つ戻す                       既定 "Option+Shift+Tab"
--   hotkey_cancel  フォーカスを移さずに一覧を閉じる      既定 "Option+Escape"
--
-- AltTab など他のアプリが Option+Tab を握っていると登録に失敗する。
-- そのときはメニューバーの状態行に出るので、ここを別の組み合わせに変えるか、
-- 相手のアプリを終了してから「設定を再読み込み」する。

-- 除外するアプリの並びは、同じディレクトリの exclude.lua に書く。exclude.lua は
-- マシンごとに置き、dotfiles では配らない。無いマシンでは除外なしで読むように
-- pcall で包む。包むと、exclude.lua の中身が誤っていても黙って除外なしになる。
--
-- exclude.lua は bundle ID の並びを返す。bundle ID は、アプリ名を渡して次を叩くと分かる。
-- 返ってきた文字列を、大文字小文字も含めてそのまま書く。
--
--   osascript -e 'id of app "TotalMix FX"'
--
-- 例（RME のオーディオインタフェースの常駐ウィンドウを外す exclude.lua）:
--   return { "de.rme-audio.TotalmixFX", "de.rme-audio.dkusbsettings" }
local ok, exclude = pcall(require, "exclude")

return {
  hotkey_next = "Option+Tab",
  hotkey_prev = "Option+Shift+Tab",
  hotkey_cancel = "Option+Escape",
  exclude_bundle_ids = ok and exclude or {},
}
