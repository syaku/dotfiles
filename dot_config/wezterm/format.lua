local wezterm = require 'wezterm'

wezterm.on("format-tab-title", function(tab, tabs, panes, config, hover, max_width)
    return {
      {Text=" " .. tab.active_pane.title .. " "},
    }
end)

local function helper(config)
    config.window_decorations = 'RESIZE'
    -- config.integrated_title_button_style = "Gnome"
    config.use_fancy_tab_bar = false
    config.tab_bar_at_bottom = true
    -- tab関連の設定
    config.tab_max_width = 64
end

return {
    helper = helper,
}