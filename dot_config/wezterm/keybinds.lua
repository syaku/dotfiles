local wezterm = require 'wezterm'
local act = wezterm.action

return {
  keys = {
    --
    { key = 'c', mods = 'SHIFT|CTRL', action = act.CopyTo 'Clipboard' },
    { key = 'c', mods = 'SUPER', action = act.CopyTo 'Clipboard' },
    { key = 'v', mods = 'SHIFT|CTRL', action = act.PasteFrom 'Clipboard' },
    { key = 'v', mods = 'SUPER', action = act.PasteFrom 'Clipboard' },

    { key = 'LeftArrow', mods = 'LEADER', action = act.ActivatePaneDirection 'Left' },
    { key = 'DownArrow', mods = 'LEADER', action = act.ActivatePaneDirection 'Down' },
    { key = 'UpArrow', mods = 'LEADER', action = act.ActivatePaneDirection 'Up' },
    { key = 'RightArrow', mods = 'LEADER', action = act.ActivatePaneDirection 'Right' },

    { key = "-", mods = 'LEADER', action = act.SplitVertical { domain = 'CurrentPaneDomain' } },
    { key = "\\", mods = 'LEADER', action = act.SplitHorizontal { domain = 'CurrentPaneDomain' } },

    { key = '[', mods = 'LEADER', action = act.ActivateCopyMode },
    { key = ']', mods = 'LEADER', action = act.PasteFrom 'Clipboard' },

    { key = 'T', mods = 'SHIFT|CTRL', action = act.SpawnTab 'CurrentPaneDomain' },
    { key = 'T', mods = 'CTRL', action = act.SpawnTab 'CurrentPaneDomain' },
    { key = 'W', mods = 'SHIFT|CTRL', action = act.CloseCurrentTab{ confirm = true } },

    { key = '}', mods = 'SHIFT|META', action = act.ActivateTabRelative(1) },
    { key = '{', mods = 'SHIFT|META', action = act.ActivateTabRelative(-1) },

    { key = 'f', mods = 'SHIFT|META', action = wezterm.action.ToggleFullScreen, },
  },
  key_tables = {
    copy_mode = {
      --
    },
    search_mode = {
      --
    },
  }
}
