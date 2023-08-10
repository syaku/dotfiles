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
  
  -- カラースキームの設定
  config.color_scheme = "Solarized Dark Higher Contrast"
  config.colors = colors
  --config.window_background_opacity = 0.93

  -- フォント設定
  config.font = wezterm.font_with_fallback({
    { family = "HackGen Console NF" },
    { family = "HackGen Console NF", assume_emoji_presentation = true },
  })
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

  -- nushellをデフォルトシェルに
  config.default_prog = { 'nu', '--login' }

  return config
end

return main()