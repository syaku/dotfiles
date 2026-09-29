-- ── 基本 ───────────────────────────────────────────

local wezterm = require 'wezterm'
local act     = wezterm.action

-- プラットフォーム判定
local is_windows = wezterm.target_triple:find("windows") ~= nil
local is_macos = wezterm.target_triple:find("apple") ~= nil

-- メイン設定テーブル
local config = {}

-- ── ドメイン ───────────────────────────────────────
config.wsl_domains = wezterm.default_wsl_domains()
if is_windows then
  -- wezterm 起動と同時に herdr に入る。herdr 内のシェルは ~/.config/herdr/config.toml の
  -- [terminal] default_shell で指定する（既存 nu 運用を維持したい場合はそちらに移す）。
  config.default_prog = { 'herdr.exe' }
end
-- macOS/Linux では default_prog を設定せず、$SHELL → ログインシェルを自動採用
config.default_domain = 'local'
config.term = 'xterm-256color'

-- kitty keyboard protocol を有効化（Cmd/Super 等の修飾子を PTY 経由で TUI に届けるため）
config.enable_kitty_keyboard = true

-- kitty graphics protocol を有効化（既定は無効）。herdr は pane の画像を kitty graphics で外側の
-- 端末へ描くので、これが無いと herdr 内の yazi 等の画像プレビューが出ない。
config.enable_kitty_graphics = true

-- ── ランチャーメニュー ─────────────────────────────
if is_windows then
  config.launch_menu = {
      { label = 'Ubuntu‑24.04', domain = { DomainName = 'WSL:Ubuntu-24.04' } },
      { label = 'PowerShell 7', args = {'pwsh.exe', '-NoLogo'}, domain = { DomainName = 'local' } },
  }
end

-- ── 外観 ───────────────────────────────────────────

-- ── GPU設定 ───────────────────────────────────────────

config.front_end = "WebGpu"  -- 最新のWebGPUレンダラーを使用（推奨）
-- config.front_end = "OpenGL" -- OpenGLを使用する場合（互換性が必要な場合）

-- GPU機能設定
config.webgpu_power_preference = "HighPerformance" -- 高性能GPUを優先使用
-- config.webgpu_power_preference = "LowPower" -- バッテリー寿命を優先する場合

-- アニメーション設定（GPU使用時のパフォーマンスに影響）
config.animation_fps = 60 -- アニメーション更新レート
config.cursor_blink_rate = 0 -- カーソル点滅速度（ミリ秒）。0 で点滅を無効化

-- スクロール設定
config.max_fps = 120 -- 最大フレームレート
config.scrollback_lines = 100000 -- デフォルト3500 → Claude Codeの長い出力に対応

if is_windows then
  -- Windows専用の設定
  config.front_end = "WebGpu" -- 最新のWindowsではWebGPUが最適
  -- config.enable_wayland = false -- Windowsでは無効
  -- 透明度
  config.window_background_opacity = 0.8

  -- コンポジターの透明効果に対する最適化
  config.win32_system_backdrop = "Acrylic" -- Windows 11でのMica/アクリル効果
end

if is_macos then
  -- macOS専用の設定
  config.front_end = "WebGpu" -- 最新のmacOSではWebGPUが最適
  -- 透明度
  config.window_background_opacity = 0.8

  -- MacのGPUパフォーマンス設定
  config.macos_window_background_blur = 20 -- 背景ブラー効果の強度
  config.native_macos_fullscreen_mode = true -- ネイティブのフルスクリーンモード
end

if not is_windows and not is_macos then
  -- WSL/Linux専用の設定
  config.enable_wayland = true -- Waylandサポートを有効（対応環境の場合）
  config.front_end = "WebGpu" -- 最新のLinuxではWebGPUが最適
  -- config.front_end = "OpenGL" -- より広い互換性が必要な場合はOpenGL
end

-- ── フォント設定 ───────────────────────────────────────────

-- 使用フォント：UDEV Gothic Nerd Font
config.font = wezterm.font_with_fallback({
  { family = 'UDEV Gothic 35NFLG' }
})

if is_windows then
  config.font_size = 11
end

if is_macos then
  config.font_size = 15
end

config.initial_cols = 200
config.initial_rows = 50

-- カラースキーム・ウィンドウデコレーション
config.color_scheme = 'Catppuccin Mocha (Gogh)'
-- OS 標準のタイトルバーとリサイズ枠を表示（最小化/最大化/閉じるボタンを OS タイトルバーに戻す）。
-- 旧構成は INTEGRATED_BUTTONS でタブバー内に統合していたが、タブバー無効化で道連れになるためタイトルバー復帰。
-- macOS だけは下でタブを描画しないタブバーを出し、INTEGRATED_BUTTONS に戻している。
config.window_decorations = "TITLE | RESIZE"

-- タブバー・マルチプレクサ機能は herdr に委譲。wezterm 自身のタブバーは描画しない。
config.enable_tab_bar = false

if is_macos then
  -- macOS の標準タイトルバーは色を変えられないので、タブバーをタイトルバーの代わりにする。
  -- タブと新規タブボタンは描画せず、信号機ボタンと色付きの帯だけを残す。
  -- タブが見えないので、パネルの退避先のタブも画面に出ない。
  config.window_decorations = "INTEGRATED_BUTTONS | RESIZE"
  config.enable_tab_bar = true
  config.hide_tab_bar_if_only_one_tab = false -- true にすると信号機ボタンごと消える
  config.show_tabs_in_tab_bar = false
  config.show_new_tab_button_in_tab_bar = false
  -- fancy tab bar を半透明にすると信号機ボタンの裏に不透明な四角が出る (wezterm/wezterm#5239) ので、
  -- retro tab bar を使う。色はカラースキームの背景色 #1e1e2e に、メイン領域と同じ透明度 0.8 を付ける。
  config.use_fancy_tab_bar = false
  config.colors = {
    tab_bar = {
      background = 'rgba(30, 30, 46, 0.8)',
    },
  }
end

-- ── キーバインド ───────────────────────────────────
-- タブ・ペイン・ワークスペース・LEADER 系は全て herdr に委譲し、ここからは外した。
-- wezterm に残すのはターミナルエミュレータとして最低限の操作キーのみ。
-- デフォルトキーバインドも off にして、明示したキーだけ有効化する。

config.disable_default_key_bindings = true

config.keys = {
    -- ---------- クリップボード ----------
    { key = 'c', mods = 'CTRL|SHIFT', action = act.CopyTo 'Clipboard'  },
    { key = 'v', mods = 'CTRL|SHIFT', action = act.PasteFrom 'Clipboard' },

    -- ---------- フォントサイズの調整 ----------
    { key = '=', mods = 'CTRL', action = act.IncreaseFontSize },
    { key = '-', mods = 'CTRL', action = act.DecreaseFontSize },
    { key = '0', mods = 'CTRL', action = act.ResetFontSize },

    -- ---------- デバッグ ----------
    -- Ctrl+Shift+D でデバッグオーバレイ
    { key = 'D', mods = 'CTRL|SHIFT', action = act.ShowDebugOverlay },
}

-- ── macOS 専用キーバインド ────────────────────────
-- herdr の prefix-less タブ操作（Ctrl+T/W/Shift+]/Shift+[/1〜9 を Cmd 系に読み替え）を
-- WezTerm 既定で潰さないように Disable / SendString で素通しさせる。
-- ペイン操作は prefix（Ctrl+b）経由なので WezTerm 側で何もしなくて herdr に届く。
if is_macos then
    local macos_keys = {
        -- Cmd+C / Cmd+V: Mac 標準のコピー・ペースト（disable_default_key_bindings=true で
        -- 既定アサインが消えるため明示再定義する）
        { key = 'c', mods = 'CMD', action = act.CopyTo 'Clipboard' },
        { key = 'v', mods = 'CMD', action = act.PasteFrom 'Clipboard' },
        -- Cmd+T / Cmd+W: WezTerm 既定（新規タブ・タブ閉じ）を Disable し herdr の Ctrl+T/W へ
        { key = 't', mods = 'CMD', action = act.DisableDefaultAssignment },
        { key = 'w', mods = 'CMD', action = act.DisableDefaultAssignment },
        -- Cmd+Shift+T: DisableDefaultAssignment ではフォールバックで AppKit characters の t が漏れるため、
        -- 完全飲み込みは Nop で行う（Mapped/Shift 明示の両経路）。チートシートには無いが防御として残す。
        { key = 't', mods = 'CMD|SHIFT', action = act.Nop },
        { key = 'T', mods = 'CMD', action = act.Nop },
        -- Cmd+Shift+] / Cmd+Shift+[: WezTerm の既定処理（SendKey 経由でも AppKit の文字変換）で
        -- 単独文字や大文字に潰されるため、kitty keyboard protocol の CSI u 形式を SendString で直送する。
        -- 書式: ESC[<codepoint>;<modifier+1>u  (Shift=1+Super=8 → modifier=9, +1=10)
        -- Mapped 解釈・Shift 明示・両者持ちの 3 経路で entry を並べる（取りこぼし防止）
        { key = '}', mods = 'CMD', action = act.SendString '\x1b[93;10u' },           -- Cmd+Shift+] → 次タブ
        { key = ']', mods = 'CMD|SHIFT', action = act.SendString '\x1b[93;10u' },
        { key = '}', mods = 'CMD|SHIFT', action = act.SendString '\x1b[93;10u' },
        { key = '{', mods = 'CMD', action = act.SendString '\x1b[91;10u' },           -- Cmd+Shift+[ → 前タブ
        { key = '[', mods = 'CMD|SHIFT', action = act.SendString '\x1b[91;10u' },
        { key = '{', mods = 'CMD|SHIFT', action = act.SendString '\x1b[91;10u' },
        -- Cmd+1〜9: WezTerm 既定の ActivateTab を Disable し herdr の Ctrl+1〜9 へ
        { key = '1', mods = 'CMD', action = act.DisableDefaultAssignment },
        { key = '2', mods = 'CMD', action = act.DisableDefaultAssignment },
        { key = '3', mods = 'CMD', action = act.DisableDefaultAssignment },
        { key = '4', mods = 'CMD', action = act.DisableDefaultAssignment },
        { key = '5', mods = 'CMD', action = act.DisableDefaultAssignment },
        { key = '6', mods = 'CMD', action = act.DisableDefaultAssignment },
        { key = '7', mods = 'CMD', action = act.DisableDefaultAssignment },
        { key = '8', mods = 'CMD', action = act.DisableDefaultAssignment },
        { key = '9', mods = 'CMD', action = act.DisableDefaultAssignment },
    }
    for _, k in ipairs(macos_keys) do
        table.insert(config.keys, k)
    end
end

-- ── パネル（macOS / Windows） ─────────────────────
-- 左に作業用の herdr、右端に固定幅のパネルを置く（Vivaldi のパネルと同じ使い方）。
-- 分割を herdr の外（WezTerm 側）に置くので、herdr でタブやワークスペースを切り替えてもパネルは残る。
-- しまうときはパネルのペインを別タブへ退避させる。タブバーを消していてタブ切り替えキーも herdr に
-- 渡しているので退避先は画面に出ず、プロセスは動き続ける。出すときは退避先から右端へ戻す。
if is_macos or is_windows then
    local home = wezterm.home_dir
    -- macOS の GUI 起動経路では PATH に /opt/homebrew/bin 等が入らないため絶対パスで指定する
    local herdr = is_windows and 'herdr.exe' or '/opt/homebrew/bin/herdr'
    local exe = is_windows and '.exe' or ''

    -- パネルの一覧。増やすときはここに足し、下の panel_keys に切り替えキーを足す。
    -- width はパネルの列数。ウィンドウの大きさが変わってもこの幅に戻す。
    local panels = {
        tasks = { args = { home .. '/.local/bin/pit-task' .. exe }, width = 60 },
    }

    -- 退避したペインを戻す操作は Lua API に無く `wezterm cli split-pane --move-pane-id` を使う。
    -- GUI 自身の env には WEZTERM_UNIX_SOCKET が無く、既定の symlink は古い GUI を指すことがあるので、
    -- この GUI プロセスのソケットを明示する。置き場所は macOS / Windows とも ~/.local/share/wezterm
    -- （XDG_RUNTIME_DIR を使うのは Linux だけ）。
    local wezterm_bin = wezterm.executable_dir .. '/wezterm' .. exe
    local gui_socket = home .. '/.local/share/wezterm/gui-sock-' .. wezterm.procinfo.pid()

    -- Windows には /usr/bin/env が無いので cmd.exe の set で環境変数を渡す
    local function with_gui_socket(argv)
        local prefix
        if is_windows then
            prefix = { 'cmd.exe', '/c', 'set', 'WEZTERM_UNIX_SOCKET=' .. gui_socket .. '&&' }
        else
            prefix = { '/usr/bin/env', 'WEZTERM_UNIX_SOCKET=' .. gui_socket }
        end
        for _, a in ipairs(argv) do
            table.insert(prefix, a)
        end
        return prefix
    end

    -- パネルのペイン ID は設定の再読み込みをまたいで残すため wezterm.GLOBAL に置く
    local function panel_pane(name)
        local id = wezterm.GLOBAL['panel_' .. name]
        if not id then
            return nil
        end
        -- パネルのプロセスが終了していれば get_pane は失敗する
        local ok, p = pcall(wezterm.mux.get_pane, id)
        if ok then
            return p
        end
        return nil
    end

    local function in_tab(tab, pane)
        for _, p in ipairs(tab:panes()) do
            if p:pane_id() == pane:pane_id() then
                return true
            end
        end
        return false
    end

    local function spawn_panel(main, name)
        local def = panels[name]
        local p = main:split { direction = 'Right', size = def.width, top_level = true, args = def.args }
        wezterm.GLOBAL['panel_' .. name] = p:pane_id()
        return p
    end

    local function stash(tab, pane)
        pane:move_to_new_tab()
        tab:activate()
    end

    -- mux の window を受け取るので、キー操作以外（wezterm.emit）からも呼べる
    wezterm.on('toggle-panel', function(mux_window, name)
        local tab = mux_window:active_tab()
        local p = panel_pane(name)
        if p and in_tab(tab, p) then
            stash(tab, p)
            return
        end
        -- 別のパネルが出ていたらしまってから出す
        for other in pairs(panels) do
            local o = panel_pane(other)
            if other ~= name and o and in_tab(tab, o) then
                stash(tab, o)
            end
        end
        local main = tab:active_pane()
        if p then
            wezterm.background_child_process(with_gui_socket {
                wezterm_bin, 'cli', 'split-pane',
                '--pane-id', tostring(main:pane_id()), '--top-level', '--right',
                '--cells', tostring(panels[name].width), '--move-pane-id', tostring(p:pane_id()),
            })
        else
            spawn_panel(main, name)
        end
    end)

    -- ウィンドウの大きさが変わると WezTerm は各ペインの幅を配り直すので、パネルの幅を戻す
    wezterm.on('window-resized', function(window, _)
        local tab = window:active_tab()
        for name, def in pairs(panels) do
            local p = panel_pane(name)
            if p then
                for _, info in ipairs(tab:panes_with_info()) do
                    if info.pane:pane_id() == p:pane_id() then
                        local delta = info.width - def.width
                        if delta > 0 then
                            window:perform_action(act.AdjustPaneSize { 'Right', delta }, p)
                        elseif delta < 0 then
                            window:perform_action(act.AdjustPaneSize { 'Left', -delta }, p)
                        end
                    end
                end
            end
        end
    end)

    wezterm.on('gui-startup', function(cmd)
        -- `wezterm start -- <prog>` のように起動コマンドが明示されたときはレイアウトを作らない
        if cmd and cmd.args then
            wezterm.mux.spawn_window(cmd)
            return
        end
        local _, main, _ = wezterm.mux.spawn_window { args = { herdr } }
        spawn_panel(main, 'tasks')
        main:activate()
    end)

    local function toggle(name)
        return wezterm.action_callback(function(window, _)
            wezterm.emit('toggle-panel', window:mux_window(), name)
        end)
    end

    -- Windows の Win キー（CMD）+ 文字は OS のショートカットに取られるので、Windows では CTRL を使う
    local mod = is_windows and 'CTRL' or 'CMD'
    local panel_keys = {
        -- Cmd+Shift+P（Windows: Ctrl+Shift+P）: pit-task のパネルを出し入れする（Mapped/Shift 明示の両経路）
        { key = 'p', mods = mod .. '|SHIFT', action = toggle 'tasks' },
        { key = 'P', mods = mod, action = toggle 'tasks' },
        -- Cmd+Option+←/→（Windows: Ctrl+Alt+←/→）: 左右のペインへフォーカス移動
        { key = 'LeftArrow', mods = mod .. '|ALT', action = act.ActivatePaneDirection 'Left' },
        { key = 'RightArrow', mods = mod .. '|ALT', action = act.ActivatePaneDirection 'Right' },
    }
    for _, k in ipairs(panel_keys) do
        table.insert(config.keys, k)
    end
end

-- ── マウス ───────────────────────────────────

config.mouse_bindings = {
    {
      event = { Down = { streak = 1, button = 'Right' } },
      mods = 'NONE',
      action = wezterm.action_callback(function(window, pane)
        local has_selection = window:get_selection_text_for_pane(pane) ~= ''
        if has_selection then
          window:perform_action(act.CopyTo 'ClipboardAndPrimarySelection', pane)
          window:perform_action(act.ClearSelection, pane)
        else
          window:perform_action(act.PasteFrom 'Clipboard', pane)
        end
      end),
    },
}

-- ── クイックセレクト ───────────────────────────────
-- file:line 形式（Claude Codeが出力する形式）を追加
config.quick_select_patterns = {
    "[\\w./\\\\-]+:\\d+",
}

-- ── 通知（bell → トースト） ────────────────────────
-- Claude Code の preferredNotifChannel = "terminal_bell" が
-- タスク完了時・権限プロンプト時に BEL を送る。それを捕まえて
-- OS ネイティブ通知に変換する（OS 別の通知 API は WezTerm が内部吸収）。
-- これにより settings.json から OS 別の通知 hook を排除できる。
-- config.audible_bell = "Disabled" -- システムビープを止めトーストのみにする（音も欲しければこの行を削除）
wezterm.on('bell', function(window, pane)
    window:toast_notification('Claude Code', '確認待ち / 応答完了', nil, 4000)
end)

-- 設定を返す
return config
