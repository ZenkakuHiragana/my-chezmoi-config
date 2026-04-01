return {
  "keaising/im-select.nvim",
  config = function()
    -- Automatically switch IM to a "default" (usually English) when leaving Insert/Cmdline mode.
    -- This makes IME effectively "off" when you return to NORMAL mode.
    local cfg = {
      -- Restore to default when leaving insert or cmdline
      set_default_events = { "InsertLeave", "CmdlineLeave" },
      -- Restore previous used IM when entering Insert mode
      set_previous_events = { "InsertEnter" },
      keep_quiet_on_no_binary = true,
      async_switch_im = true,
    }

    if vim.fn.has("win32") == 1 then
      cfg.default_im_select = "1033" -- English (US) on Windows
      cfg.default_command = "im-select.exe"
    elseif vim.fn.has("mac") == 1 or vim.fn.has("macunix") == 1 then
      cfg.default_im_select = "com.apple.keylayout.ABC" -- macOS US layout
      cfg.default_command = "macism"
    else
      -- Linux: prefer fcitx5 as a sensible default
      cfg.default_im_select = "keyboard-us"
      cfg.default_command = "fcitx5-remote"
    end

    require("im_select").setup(cfg)
  end,
}
