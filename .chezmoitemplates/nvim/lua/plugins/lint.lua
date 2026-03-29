return {
  "mfussenegger/nvim-lint",
  optional = true,
  opts = {
    linters = {
      ["markdownlint-cli2"] = {
        args = {
          "--config",
          function()
            return vim.fs.joinpath(vim.fn.stdpath("config"), ".markdownlint-cli2.yaml")
          end,
          "--",
        },
      },
    },
  },
}

