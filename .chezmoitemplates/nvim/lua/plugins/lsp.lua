return {
  "neovim/nvim-lspconfig",
  opts = function(self, opts)
    -- table.insert(opts.servers.clangd.cmd, "--log=verbose")
    table.insert(opts.servers.clangd.cmd, "--query-driver=*c++*")
    table.insert(opts.servers.clangd.cmd, "--enable-config")

    -- clangd を HLSL ファイルにも使う
    -- opts.servers.clangd.filetypes = { "c", "cpp", "objc", "objcpp", "cuda", "proto", "hlsl" }

    -- slangd は hlsl にアタッチしない（Slang 言語のみ）
    opts.servers.slangd = opts.servers.slangd or {}
    opts.servers.slangd.filetypes = { "shaderslang" }
    opts.servers.hlsl = {
      mason = false,
      cmd = { "ShaderTools.LanguageServer.exe" },
      filetypes = { "hlsl" },
      root_markers = { ".git" },
      workspace_required = false,
    }
  end,
}
