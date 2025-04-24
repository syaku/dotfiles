# Shell integration settings
# OSC2: Terminal title setting
# OSC7: Working directory reporting
# OSC8: Hyperlink support
# OSC9_9: Terminal state reporting (disabled)
# OSC133: Prompt marking (disabled)
$env.config.shell_integration = {
  osc2: true,    # Enable terminal title setting
  osc7: true,    # Enable working directory reporting
  osc8: true,    # Enable hyperlink support
  osc9_9: false, # Disable terminal state reporting
  osc133: false  # Disable prompt marking
}