local wezterm = require("wezterm")
local act = wezterm.action
local config = wezterm.config_builder()

-- 最初から PowerShell 7
config.default_prog = {
  "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  "-NoLogo",
}

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
}

if wezterm.target_triple:find("windows") then
  config.keys[#config.keys + 1] = {
    key = "t",
    mods = "CTRL|SHIFT|ALT",
    action = act.SpawnCommandInNewTab({
      args = { "wsl.exe" },
    }),
  }
end

return config
