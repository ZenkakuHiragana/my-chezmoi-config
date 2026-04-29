return {
  {
    "Mofiqul/vscode.nvim",
    opts = {
      transparent = true,
      group_overrides = {
        NormalFloat = { bg = "NONE" },
        FloatBorder = { bg = "NONE" },
        FloatTitle = { bg = "NONE" },
        FloatFooter = { bg = "NONE" },
      },
    },
  },
  {
    "LazyVim/LazyVim",
    opts = { colorscheme = "vscode" },
  },
}
