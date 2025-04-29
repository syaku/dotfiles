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
config.default_prog = is_windows and { 'nu.exe', '-l' } or { '/bin/zsh', '-l' }
config.default_domain = 'local'

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
config.cursor_blink_rate = 800 -- カーソル点滅速度（ミリ秒）

-- スクロール設定
config.max_fps = 120 -- 最大フレームレート

if is_windows then
  -- Windows専用の設定
  config.front_end = "OpenGL" -- 最新のWindowsではWebGPUが最適
  -- config.enable_wayland = false -- Windowsでは無効
  -- 透明度
  config.window_background_opacity = 0.95
  
  -- コンポジターの透明効果に対する最適化
  -- config.win32_system_backdrop = "Acrylic" -- Windows 11でのMica/アクリル効果
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
  config.font_size = 10.5
end

if is_macos then
  config.font_size = 12
end

config.initial_cols = 200
config.initial_rows = 50

-- タブ＆タイトルバーの構成
config.color_scheme = 'Tender (Gogh)'
config.window_decorations = "INTEGRATED_BUTTONS|RESIZE" -- 見た目をスッキリ＆最小限に
config.integrated_title_button_style = "Windows"        -- ボタンはWin風で統一感
-- タブバーを下部に配置
config.tab_bar_at_bottom = true
-- ファンシータブバーを無効化（レトロスタイルを使用）
config.use_fancy_tab_bar = false
-- タブバーの最大幅を設定（レトロスタイルで有効）
config.tab_max_width = 24 

config.hide_tab_bar_if_only_one_tab = false
config.show_new_tab_button_in_tab_bar=false
config.colors = {
  tab_bar = {
    background = '#4c4c4c',
    inactive_tab_hover = {
        bg_color = '#4c4c4c',
        fg_color = '#282828',
        italic   = false,
    },
  },
}

local TAB_LEFT =  wezterm.nerdfonts.ple_upper_right_triangle
local TAB_RIGHT = wezterm.nerdfonts.ple_upper_left_triangle
wezterm.on("format-tab-title", function(tab, tabs, panes, config, hover, max_width)
    local background = "#4c4c4c"
    local foreground = "#282828"
    local edge_background = "#4c4c4c"
    if tab.is_active then
        background = "#282828"
        foreground = "#eeeeee"
    end
    local edge_foreground = background
    local title = tab.active_pane.title
    if wezterm.column_width(title) > max_width then
        title = wezterm.truncate_right(title, max_width-5) .. '…'
    end
    local title = " " .. title .. " "
    return {
        { Background = { Color = edge_background } },
        { Foreground = { Color = edge_foreground } },
        { Text = TAB_LEFT },
        { Background = { Color = background } },
        { Foreground = { Color = foreground } },
        { Text = title },
        { Background = { Color = edge_background } },
        { Foreground = { Color = edge_foreground } },
        { Text = TAB_RIGHT },
    }
end)

local background = "#282828"
local foreground = "#eeeeee"
local edge_background = "#282828"
local edge_foreground = "#4c4c4c"

local WINDOW_BUTTON_LEFT = wezterm.nerdfonts.ple_lower_right_triangle
local WINDOW_BUTTON_RIGHT = wezterm.nerdfonts.ple_lower_right_triangle

config.tab_bar_style = {
    window_hide = wezterm.format {
        { Attribute = { Italic = false } },          -- ←★ここでオフ
        { Background = { Color = edge_foreground } },
        { Foreground = { Color = edge_foreground } }, { Text = WINDOW_BUTTON_LEFT },
        { Background = { Color = edge_foreground } },
        { Foreground = { Color = edge_background } }, { Text = ' ' .. wezterm.nerdfonts.md_window_minimize .. ' ' },
        { Background = { Color = edge_foreground } },
        { Foreground = { Color = edge_foreground } }, { Text = WINDOW_BUTTON_RIGHT },
    },
    window_hide_hover = wezterm.format {
        { Attribute = { Italic = false } },          -- ←★hover も同様
        { Background = { Color = edge_foreground } },
        { Foreground = { Color = edge_background } }, { Text = WINDOW_BUTTON_LEFT },
        { Background = { Color = background } },
        { Foreground = { Color = foreground } }, { Text = ' ' .. wezterm.nerdfonts.md_window_minimize .. ' ' },
        { Background = { Color = edge_background } },
        { Foreground = { Color = edge_foreground } }, { Text = WINDOW_BUTTON_RIGHT },
    },
    window_maximize = wezterm.format {
        { Attribute = { Italic = false } },          -- ←★ここでオフ
        { Background = { Color = edge_foreground } },
        { Foreground = { Color = edge_foreground } }, { Text = WINDOW_BUTTON_LEFT },
        { Background = { Color = edge_foreground } },
        { Foreground = { Color = edge_background } }, { Text = ' ' .. wezterm.nerdfonts.md_window_maximize .. ' ' },
        { Background = { Color = edge_foreground } },
        { Foreground = { Color = edge_foreground } }, { Text = WINDOW_BUTTON_RIGHT },
    },
    window_maximize_hover = wezterm.format {
        { Attribute = { Italic = false } },          -- ←★hover も同様
        { Background = { Color = edge_foreground } },
        { Foreground = { Color = edge_background } }, { Text = WINDOW_BUTTON_LEFT },
        { Background = { Color = background } },
        { Foreground = { Color = foreground } }, { Text = ' ' .. wezterm.nerdfonts.md_window_maximize .. ' ' },
        { Background = { Color = edge_background } },
        { Foreground = { Color = edge_foreground } }, { Text = WINDOW_BUTTON_RIGHT },
    },
    window_close = wezterm.format {
        { Attribute = { Italic = false } },          -- ←★ここでオフ
        { Background = { Color = edge_foreground } },
        { Foreground = { Color = edge_foreground } }, { Text = WINDOW_BUTTON_LEFT },
        { Background = { Color = edge_foreground } },
        { Foreground = { Color = edge_background } }, { Text = ' ' .. wezterm.nerdfonts.md_window_close .. ' ' },
        { Background = { Color = edge_foreground } },
        { Foreground = { Color = edge_foreground } }, { Text = WINDOW_BUTTON_RIGHT },
    },
    window_close_hover = wezterm.format {
        { Attribute = { Italic = false } },          -- ←★hover も同様
        { Background = { Color = edge_foreground } },
        { Foreground = { Color = "#f43753" } }, { Text = WINDOW_BUTTON_LEFT },
        { Background = { Color = "#f43753" } },
        { Foreground = { Color = foreground } }, { Text = ' ' .. wezterm.nerdfonts.md_window_close .. ' ' },
        { Background = { Color = "#f43753" } },
        { Foreground = { Color = "#f43753" } }, { Text = WINDOW_BUTTON_RIGHT },
    },
}

-- ── キーバインド ───────────────────────────────────

local leader_key = { key = 'q', mods = 'CTRL', timeout_milliseconds = 1000 }

config.leader = leader_key
config.disable_default_key_bindings = false

-- カスタムキーバインド（画面分割・タブ移動）
config.keys = {
    -- ---------- クリップボード ----------
    { key = 'c', mods = 'CTRL|SHIFT', action = act.CopyTo 'Clipboard'  },
    { key = 'v', mods = 'CTRL|SHIFT', action = act.PasteFrom 'Clipboard' },

    -- ---------- フォントサイズの調整 ----------
    { key = '=', mods = 'CTRL', action = act.IncreaseFontSize },
    { key = '-', mods = 'CTRL', action = act.DecreaseFontSize },
    { key = '0', mods = 'CTRL', action = act.ResetFontSize },

    -- ---------- ペイン分割 ----------
    { key = '\\', mods = 'LEADER',
      action = act.SplitPane{ direction = 'Right', size = { Percent = 50 } } },
    { key = '-',  mods = 'LEADER',
      action = act.SplitPane{ direction = 'Down',  size = { Percent = 50 } } },

    -- ---------- ペイン移動 ----------
    { key = 'LeftArrow',  mods = 'LEADER', action = act.ActivatePaneDirection 'Left'  },
    { key = 'RightArrow', mods = 'LEADER', action = act.ActivatePaneDirection 'Right' },
    { key = 'UpArrow',    mods = 'LEADER', action = act.ActivatePaneDirection 'Up'    },
    { key = 'DownArrow',  mods = 'LEADER', action = act.ActivatePaneDirection 'Down'  },

    -- ---------- ペインリサイズ ----------
    { key = 'LeftArrow',  mods = 'LEADER|SHIFT', action = act.AdjustPaneSize{ 'Left',  5 } },
    { key = 'RightArrow', mods = 'LEADER|SHIFT', action = act.AdjustPaneSize{ 'Right', 5 } },
    { key = 'UpArrow',    mods = 'LEADER|SHIFT', action = act.AdjustPaneSize{ 'Up',    3 } },
    { key = 'DownArrow',  mods = 'LEADER|SHIFT', action = act.AdjustPaneSize{ 'Down',  3 } },

    -- ---------- タブ操作 ----------
    { key = 't', mods = 'CTRL', action = act.SpawnTab 'DefaultDomain' },
    { key = 'w', mods = 'CTRL', action = act.CloseCurrentTab{ confirm = true } },

    -- ---------- デバッグ & ランチャー ----------

    -- Ctrl+Shift+D でデバッグオーバレイ
    { key = 'D', mods = 'CTRL|SHIFT', action = act.ShowDebugOverlay },                             -- :contentReference[oaicite:0]{index=0}
    -- Ctrl+Shift+L でランチャー（タブ・ドメイン・ワークスペース・メニュー項目を表示）
    { key = 'L', mods = 'CTRL|SHIFT', action = act.ShowLauncherArgs {
            flags = 'FUZZY|LAUNCH_MENU_ITEMS|TABS',
        }
    },        

    -- ---------- その他 ----------
    { key = 'r', mods = 'LEADER', action = act.ReloadConfiguration },
    { key = 'f', mods = 'LEADER', action = act.Search{ CaseSensitiveString = '' } },
}

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

config.unzoom_on_switch_pane = true

-- 設定を返す
return config
