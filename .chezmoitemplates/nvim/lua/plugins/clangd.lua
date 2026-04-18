return {
  "neovim/nvim-lspconfig",
  opts = function(self, opts)
    -- table.insert(opts.servers.clangd.cmd, "--log=verbose")
    table.insert(opts.servers.clangd.cmd, "--query-driver=*c++*")
  end,
}
