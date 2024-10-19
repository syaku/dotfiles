local wezterm = require 'wezterm'
require 'keybinds'
local format = require 'format'
local colors = require 'colors'

function main() 
  local config = {}

  if wezterm.config_builder then
    config = wezterm.config_builder()
  end

  config.initial_cols = 128
  config.initial_rows = 32

  format.helper(config)

  config.window_padding = {
    left = 4,
    right = 4,
    top = 4,
    bottom = 4,
  }

  -- カラースキームの設定
  config.color_scheme = "tender (base16)"
  config.colors = colors
  config.window_background_opacity = 0.95

  -- フォント設定
  config.font = wezterm.font("PlemolJP Console NF", {weight="Regular", stretch="Normal", style="Normal"})
  config.font_size = 10.5
  config.cell_width = 1.0
  config.line_height = 1.0

  -- key設定
  config.leader = { key = 'q', mods = 'CTRL', timeout_milliseconds = 2000 }
  config.keys = require('keybinds').keys
  config.key_tables = require('keybinds').key_tables
  config.disable_default_key_bindings = true

  -- mouse設定
  config.mouse_bindings = require('mouse').mouse_bindings

  config.default_prog = { 'c:/venv/xonsh/Scripts/xonsh.exe' }
  --config.default_prog = { 'pwsh' }

  return config
end

return main()
