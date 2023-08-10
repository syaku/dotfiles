local wezterm = require("wezterm")
local act = wezterm.action

local mouse_bindings = {
	{
        event = { Up = { streak = 1, button = 'Right' } },
        mods = 'NONE',
        action = act.PasteFrom 'PrimarySelection'
    },
}

return {
    mouse_bindings = mouse_bindings
}