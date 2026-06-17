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
  config.default_prog = { 'nu.exe' }
end
-- macOS/Linux では default_prog を設定せず、$SHELL → ログインシェルを自動採用
config.default_domain = 'local'
config.term = 'xterm-256color'

-- kitty keyboard protocol を有効化（Cmd/Super 等の修飾子を PTY 経由で TUI に届けるため）
config.enable_kitty_keyboard = true

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
config.scrollback_lines = 100000 -- デフォルト3500 → Claude Codeの長い出力に対応

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
  config.font_size = 11
end

if is_macos then
  config.font_size = 15
end

config.initial_cols = 200
config.initial_rows = 50

-- カラースキーム・ウィンドウデコレーション
config.color_scheme = 'Tender (Gogh)'
-- OS 標準のタイトルバーとリサイズ枠を表示（最小化/最大化/閉じるボタンを OS タイトルバーに戻す）。
-- 旧構成は INTEGRATED_BUTTONS でタブバー内に統合していたが、タブバー無効化で道連れになるためタイトルバー復帰。
config.window_decorations = "TITLE | RESIZE"

-- タブバー・マルチプレクサ機能は herdr に委譲。wezterm 自身のタブバーは描画しない。
config.enable_tab_bar = false

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
-- WezTerm のタブ機能は無効化済み。Cmd 系キーは「herdr に届ける」役割だけ残す。
if is_macos then
    local macos_keys = {
        -- Cmd 系タブショートカットの既定アサインを Disable して herdr に届かせる
        { key = 't', mods = 'CMD', action = act.DisableDefaultAssignment },
        { key = 'w', mods = 'CMD', action = act.DisableDefaultAssignment },
        -- Cmd+Shift+T: DisableDefaultAssignment はフォールバックで AppKit characters の t が漏れるため、
        -- 完全飲み込みは Nop で行う（Mapped/Shift 明示の両経路）
        { key = 't', mods = 'CMD|SHIFT', action = act.Nop },
        { key = 'T', mods = 'CMD', action = act.Nop },
        -- Cmd+Shift+<英字>/Enter は WezTerm の既定処理（SendKey 経由でも AppKit の文字変換）で
        -- 文字単独や大文字に潰されるため、kitty keyboard protocol の CSI u 形式を SendString で直送する。
        -- 書式: ESC[<codepoint>;<modifier+1>u  (Shift=1+Super=8 → modifier=9, +1=10)
        -- Mapped 解釈・Shift 明示・両者持ちの 3 経路で entry を並べる（取りこぼし防止）
        { key = '}', mods = 'CMD', action = act.SendString '\x1b[93;10u' },           -- Cmd+Shift+]
        { key = ']', mods = 'CMD|SHIFT', action = act.SendString '\x1b[93;10u' },
        { key = '}', mods = 'CMD|SHIFT', action = act.SendString '\x1b[93;10u' },
        { key = '{', mods = 'CMD', action = act.SendString '\x1b[91;10u' },           -- Cmd+Shift+[
        { key = '[', mods = 'CMD|SHIFT', action = act.SendString '\x1b[91;10u' },
        { key = '{', mods = 'CMD|SHIFT', action = act.SendString '\x1b[91;10u' },
        { key = 'd', mods = 'CMD|SHIFT', action = act.SendString '\x1b[100;10u' },
        { key = 'w', mods = 'CMD|SHIFT', action = act.SendString '\x1b[119;10u' },
        { key = 'Enter', mods = 'CMD|SHIFT', action = act.SendString '\x1b[13;10u' },
        -- Cmd+1〜9 の ActivateTab を Disable
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
