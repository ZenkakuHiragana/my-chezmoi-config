local wezterm = require("wezterm")
local act = wezterm.action
local config = wezterm.config_builder()

config.default_gui_startup_args = { "connect", "unix" }
config.unix_domains = { { name = "unix" } }

-- フォント
config.font = wezterm.font_with_fallback({
  "HackGen Console NF", -- 英文 Nerd Font
  "HackGen Console NF", -- 日本語フォントフォールバック
})
config.use_ime = true
config.ime_preedit_rendering = "Builtin"

-- TUIとの幅不一致を避けるため、まずは既定の1セル扱い
config.treat_east_asian_ambiguous_width_as_wide = false

-- Windows Terminal の Acrylic 相当
config.window_background_opacity = 0.82
config.win32_system_backdrop = "Disable"

-- Windows のタイトルバーを消し、
-- 最小化・最大化・閉じるボタンをタブバーに統合
config.window_decorations = "INTEGRATED_BUTTONS|RESIZE"
config.integrated_title_button_style = "Windows"
config.integrated_title_button_alignment = "Right"

-- タブバーを1段の簡素な表示にする
config.use_fancy_tab_bar = false
config.hide_tab_bar_if_only_one_tab = false
config.show_new_tab_button_in_tab_bar = true
config.tab_bar_at_bottom = true

-- Windows Terminal のプロファイルショートカット相当
config.keys = {
  {
    key = "%",
    mods = "CTRL|SHIFT",
    action = wezterm.action.SplitPane({
      direction = "Right",
      size = { Percent = 50 },
    }),
  },
  {
    key = '"',
    mods = "CTRL|SHIFT",
    action = wezterm.action.SplitVertical({ domain = "CurrentPaneDomain" }),
  },
  {
    key = "w",
    mods = "CTRL|SHIFT",
    action = wezterm.action.CloseCurrentPane({ confirm = true }),
  },
  {
    key = "d",
    mods = "CTRL|SHIFT",
    action = act.DetachDomain("CurrentPaneDomain"),
  },
  -- domainを選択してattach
  {
    key = "s",
    mods = "CTRL|SHIFT|ALT",
    action = act.ShowLauncherArgs({
      flags = "FUZZY|DOMAINS",
      title = "Select multiplexer domain",
    }),
  },
}

if wezterm.target_triple:find("windows") then
  -- 最初から PowerShell 7
  config.default_prog = { "pwsh.exe", "-NoLogo" }
  config.keys[#config.keys + 1] = {
    key = "t",
    mods = "CTRL|SHIFT|ALT",
    action = act.SpawnCommandInNewTab({
      args = { "wsl.exe" },
    }),
  }
end

wezterm.on("update-status", function(window, pane)
  local domain = pane:get_domain_name()
  local host = domain:match("^SSHMUX:(.+)$")

  local label
  if host then
    label = " SSH: " .. host .. " "
  else
    label = " LOCAL "
  end

  window:set_right_status(wezterm.format({
    { Attribute = { Intensity = "Bold" } },
    { Text = label },
  }))
end)

return config
