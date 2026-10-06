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

-- macOS で Ctrl 付きのキーも IME に回す（既定 SHIFT のままだと SKK に Ctrl+G などが届かない）。
-- IME が使わないキーは素通しされるが、SKK が取る Ctrl の組み合わせは端末のプログラムに届かなくなる。
config.macos_forward_to_ime_modifier_mask = 'SHIFT|CTRL'

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
-- ペインの区切り線はスキームの既定だと背景に沈むので、Catppuccin Mocha の Overlay0 のグレーにする。
config.colors = {
  split = '#6c7086',
}
-- OS 標準のタイトルバーとリサイズ枠を表示（最小化/最大化/閉じるボタンを OS タイトルバーに戻す）。
-- 旧構成は INTEGRATED_BUTTONS でタブバー内に統合していたが、タブバー無効化で道連れになるためタイトルバー復帰。
-- macOS と Windows は下でタブを描画しないタブバーを出し、INTEGRATED_BUTTONS に戻している。
config.window_decorations = "TITLE | RESIZE"

-- タブバー・マルチプレクサ機能は herdr に委譲。wezterm 自身のタブバーは描画しない。
config.enable_tab_bar = false

if is_macos or is_windows then
  -- OS 標準のタイトルバーは色を変えられないので、タブバーをタイトルバーの代わりにする。
  -- タブと新規タブボタンは描画せず、ウィンドウ操作のボタンと色付きの帯だけを残す。
  -- ボタンは macOS では信号機ボタン、Windows では Windows 風の描画になる（integrated_title_button_style の既定）。
  -- タブが見えないので、パネルの退避先のタブも画面に出ない。
  config.window_decorations = "INTEGRATED_BUTTONS | RESIZE"
  config.enable_tab_bar = true
  config.hide_tab_bar_if_only_one_tab = false -- true にするとボタンごと消える
  config.show_tabs_in_tab_bar = false
  config.show_new_tab_button_in_tab_bar = false
  -- fancy tab bar を半透明にすると macOS で信号機ボタンの裏に不透明な四角が出る (wezterm/wezterm#5239) ので、
  -- retro tab bar を使う。色はカラースキームの背景色 #1e1e2e に、メイン領域と同じ透明度 0.8 を付ける。
  config.use_fancy_tab_bar = false
  config.colors.tab_bar = {
    background = 'rgba(30, 30, 46, 0.8)',
  }
  if is_windows then
    -- retro tab bar は Windows のボタンを文字で描くので、Nerd Font の Codicons に差し替える。
    -- fancy tab bar ならボタンを図形で描くが、ボタンの背景が半透明にならない（button_bg も効かない）。
    -- 背景を指定しないとボタンは不透明な #333333 で塗られるので、通常時も帯と同じ半透明の色を明示する。
    local nf = wezterm.nerdfonts
    local function button(icon, hover_bg, hover_fg)
      local text = '  ' .. icon .. '  '
      return {
        normal = wezterm.format({
          { Background = { Color = 'rgba(30, 30, 46, 0.8)' } },
          { Foreground = { Color = '#cdd6f4' } },
          { Text = text },
        }),
        hover = wezterm.format({
          { Background = { Color = hover_bg } },
          { Foreground = { Color = hover_fg } },
          { Text = text },
        }),
      }
    end
    local hide = button(nf.cod_chrome_minimize, '#45475a', '#cdd6f4')
    local maximize = button(nf.cod_chrome_maximize, '#45475a', '#cdd6f4')
    -- 閉じるボタンのホバーは Windows 標準の閉じるボタンと同じ濃い赤にする
    local close = button(nf.cod_chrome_close, '#c42b1c', '#ffffff')
    config.tab_bar_style = {
      window_hide = hide.normal,
      window_hide_hover = hide.hover,
      window_maximize = maximize.normal,
      window_maximize_hover = maximize.hover,
      window_close = close.normal,
      window_close_hover = close.hover,
    }
  end
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
-- 左に作業用の herdr、右端と下に固定サイズのパネルを置く（Vivaldi のパネルと同じ使い方）。
-- 分割を herdr の外（WezTerm 側）に置くので、herdr でタブやワークスペースを切り替えてもパネルは残る。
-- しまうときはパネルのペインを別タブへ退避させる。タブバーを消していてタブ切り替えキーも herdr に
-- 渡しているので退避先は画面に出ず、プロセスは動き続ける。出すときは退避先から元の位置へ戻す。
-- 下のパネルはウィンドウの幅いっぱいに、右のパネルは herdr のペインの横だけに置く。
-- 右もウィンドウ全体で分割すると、出した順番でどちらが端から端まで伸びるかが変わるため。
if is_macos or is_windows then
    local home = wezterm.home_dir
    -- macOS の GUI 起動経路では PATH に /opt/homebrew/bin 等が入らないため絶対パスで指定する
    local herdr = is_windows and 'herdr.exe' or '/opt/homebrew/bin/herdr'

    -- herdr を起動する args。extra は herdr に渡す引数の文字列。
    -- WezTerm はペインを閉じるとき、pty の VEOF が 0 でなければ raw モードかどうかに関係なく
    -- 改行と EOF を書き込む（pty/src/unix.rs の UnixMasterWriter::drop）。herdr はそれを
    -- フォーカス中のペインへの Enter として渡すので、VEOF を 0 にしてから herdr を起動する。
    -- stty eof undef は macOS では 0xff になり、改行が送られるので使わない。
    local function herdr_args(extra)
        if is_windows then
            return { herdr }
        end
        return { '/bin/sh', '-c', "stty eof '^@'; exec " .. herdr .. extra }
    end

    -- 下のパネル。herdr の名前付きセッション panel を、サイドバーを隠した設定
    -- （~/.config/herdr/panel-config.toml）で動かす。シェルは herdr のサーバに残るので、
    -- WezTerm を終了しても消えず、タブも使える。
    local term_args = is_windows and { herdr, '--session', 'panel' } or herdr_args ' --session panel'
    local term_env = { HERDR_CONFIG_PATH = home .. '/.config/herdr/panel-config.toml' }
    local exe = is_windows and '.exe' or ''

    -- pit-task は gh を子プロセスで呼ぶ。GUI から起動したパネルは PATH が /usr/bin:/bin:/usr/sbin:/sbin
    -- だけで gh（/opt/homebrew/bin）が見つからないので、macOS では PATH を渡す。
    local tasks_env = is_macos and { PATH = '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin' } or nil

    -- パネルの一覧。増やすときはここに足し、下の panel_keys に切り替えキーを足す。
    -- side は出す位置（'Right' か 'Bottom'）。同じ side のパネルは同時に 1 つだけ出す。
    -- size は Right なら列数、Bottom なら行数。ウィンドウの大きさが変わってもこの大きさに戻す。
    -- env はそのパネルのプロセスに足す環境変数。
    local panels = {
        tasks = { args = { home .. '/.local/bin/pit-task' .. exe }, env = tasks_env, side = 'Right', size = 60 },
        term = { args = term_args, env = term_env, side = 'Bottom', size = 16 },
    }

    -- 退避したペインを戻す操作は Lua API に無く `wezterm cli split-pane --move-pane-id` を使う。
    -- GUI 自身の env には WEZTERM_UNIX_SOCKET が無く、既定の symlink は古い GUI を指すことがあるので、
    -- この GUI プロセスのソケットを明示する。置き場所は macOS / Windows とも ~/.local/share/wezterm
    -- （XDG_RUNTIME_DIR を使うのは Linux だけ）。
    local wezterm_bin = wezterm.executable_dir .. '/wezterm' .. exe
    local gui_socket = home .. '/.local/share/wezterm/gui-sock-' .. wezterm.procinfo.pid()

    -- `wezterm cli` の呼び出しを 1 つのプロセスで順に実行する。前の呼び出しで配置が変わってから
    -- 次を実行させたいので、呼び出しごとに別のプロセスにはしない。前が失敗しても次は実行する。
    -- Windows には sh が無いので cmd.exe の set で環境変数を渡し、& でつなぐ。
    local function run_cli(cmds)
        local argv
        if is_windows then
            argv = { 'cmd.exe', '/c', 'set', 'WEZTERM_UNIX_SOCKET=' .. gui_socket .. '&&' }
            for i, cmd in ipairs(cmds) do
                if i > 1 then
                    table.insert(argv, '&')
                end
                table.insert(argv, wezterm_bin)
                table.insert(argv, 'cli')
                for _, a in ipairs(cmd) do
                    table.insert(argv, a)
                end
            end
        else
            local function quote(s)
                return "'" .. s:gsub("'", "'\\''") .. "'"
            end
            local lines = { 'export WEZTERM_UNIX_SOCKET=' .. quote(gui_socket) }
            for _, cmd in ipairs(cmds) do
                local words = { quote(wezterm_bin), 'cli' }
                for _, a in ipairs(cmd) do
                    table.insert(words, quote(a))
                end
                table.insert(lines, table.concat(words, ' '))
            end
            argv = { '/bin/sh', '-c', table.concat(lines, '\n') }
        end
        wezterm.background_child_process(argv)
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

    -- フォーカスがパネルにあっても分割の基準にできるよう、パネルでないペイン（herdr）を探す
    local function main_pane(tab)
        for _, p in ipairs(tab:panes()) do
            local is_panel = false
            for name in pairs(panels) do
                local q = panel_pane(name)
                if q and q:pane_id() == p:pane_id() then
                    is_panel = true
                end
            end
            if not is_panel then
                return p
            end
        end
        return tab:active_pane()
    end

    local function spawn_panel(main, name)
        local def = panels[name]
        local p = main:split {
            direction = def.side, size = def.size, top_level = def.side == 'Bottom', args = def.args,
            set_environment_variables = def.env,
        }
        wezterm.GLOBAL['panel_' .. name] = p:pane_id()
        return p
    end

    local function stash(tab, pane)
        pane:move_to_new_tab()
        tab:activate()
    end

    -- 退避したパネル p を main の隣へ戻す cli の引数
    local function restore_cmd(main, name, p)
        local def = panels[name]
        local cmd = { 'split-pane', '--pane-id', tostring(main:pane_id()) }
        if def.side == 'Bottom' then
            table.insert(cmd, '--top-level')
        end
        for _, a in ipairs {
            '--' .. def.side:lower(), '--cells', tostring(def.size), '--move-pane-id', tostring(p:pane_id()),
        } do
            table.insert(cmd, a)
        end
        return cmd
    end

    -- mux の window を受け取るので、キー操作以外（wezterm.emit）からも呼べる
    wezterm.on('toggle-panel', function(mux_window, name)
        local tab = mux_window:active_tab()
        local p = panel_pane(name)
        if p and in_tab(tab, p) then
            stash(tab, p)
            return
        end
        -- 同じ位置に別のパネルが出ていたらしまってから出す
        local def = panels[name]
        for other, odef in pairs(panels) do
            local o = panel_pane(other)
            if other ~= name and odef.side == def.side and o and in_tab(tab, o) then
                stash(tab, o)
            end
        end
        -- 分割が残っているタブをウィンドウ全体で分割すると、WezTerm が覚えるタブの高さが分割前の
        -- 上側の高さにずれ、しまって戻すたびにタブが縮む。下のパネルはウィンドウ全体で分割するので、
        -- 右のパネルもいったんしまって herdr だけにしてから下を出し、そのあと右を herdr の横に戻す。
        local reopen = {}
        if def.side == 'Bottom' then
            for other, odef in pairs(panels) do
                local o = panel_pane(other)
                if odef.side == 'Right' and o and in_tab(tab, o) then
                    stash(tab, o)
                    table.insert(reopen, { name = other, pane = o })
                end
            end
        end
        local main = main_pane(tab)
        local cmds = {}
        if p then
            table.insert(cmds, restore_cmd(main, name, p))
        else
            spawn_panel(main, name)
        end
        for _, r in ipairs(reopen) do
            table.insert(cmds, restore_cmd(main, r.name, r.pane))
        end
        if #cmds > 0 then
            run_cli(cmds)
        end
    end)

    -- ウィンドウの大きさが変わると WezTerm は各ペインの大きさを配り直すので、パネルの大きさを戻す。
    -- パネルは右か下の側にあるので、境界を右（下）へ動かすと縮み、左（上）へ動かすと広がる。
    wezterm.on('window-resized', function(window, _)
        local tab = window:active_tab()
        for name, def in pairs(panels) do
            local p = panel_pane(name)
            if p then
                for _, info in ipairs(tab:panes_with_info()) do
                    if info.pane:pane_id() == p:pane_id() then
                        local delta, shrink, grow
                        if def.side == 'Right' then
                            delta, shrink, grow = info.width - def.size, 'Right', 'Left'
                        else
                            delta, shrink, grow = info.height - def.size, 'Down', 'Up'
                        end
                        if delta > 0 then
                            window:perform_action(act.AdjustPaneSize { shrink, delta }, p)
                        elseif delta < 0 then
                            window:perform_action(act.AdjustPaneSize { grow, -delta }, p)
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
        local _, main, _ = wezterm.mux.spawn_window { args = herdr_args '' }
        -- 下のパネルはウィンドウ全体で分割するので、分割の無いうちに先に作る（toggle-panel の説明を参照）
        spawn_panel(main, 'term')
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
        -- Cmd+Shift+J（Windows: Ctrl+Shift+J）: 下のターミナルのパネルを出し入れする
        { key = 'j', mods = mod .. '|SHIFT', action = toggle 'term' },
        { key = 'J', mods = mod, action = toggle 'term' },
        -- Cmd+Shift+Z（Windows: Ctrl+Shift+Z）: 今のペインをタブいっぱいに広げる。もう一度押すと元に戻る
        { key = 'z', mods = mod .. '|SHIFT', action = act.TogglePaneZoomState },
        { key = 'Z', mods = mod, action = act.TogglePaneZoomState },
        -- Cmd+Option+矢印（Windows: Ctrl+Alt+矢印）: 上下左右のペインへフォーカス移動
        { key = 'LeftArrow', mods = mod .. '|ALT', action = act.ActivatePaneDirection 'Left' },
        { key = 'RightArrow', mods = mod .. '|ALT', action = act.ActivatePaneDirection 'Right' },
        { key = 'UpArrow', mods = mod .. '|ALT', action = act.ActivatePaneDirection 'Up' },
        { key = 'DownArrow', mods = mod .. '|ALT', action = act.ActivatePaneDirection 'Down' },
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
