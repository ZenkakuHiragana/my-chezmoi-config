return {
  "neovim/nvim-lspconfig",
  opts = function(_, opts)
    local function hlsl_full_text(uri)
      local bufnr = vim.uri_to_bufnr(uri)
      local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
      local text = table.concat(lines, "\n")

      if vim.bo[bufnr].endofline then
        text = text .. "\n"
      end

      return text
    end

    local function hlsl_end_position(text, position_encoding)
      local lines = vim.split(text, "\n", { plain = true, trimempty = false })
      local last_line = lines[#lines] or ""

      return {
        line = #lines - 1,
        character = vim.str_utfindex(last_line, position_encoding),
      }
    end

    local function wrap_hlsl_sync(client)
      if client._hlsl_sync_wrapped then
        return
      end

      local old_notify = client.notify
      client._hlsl_documents = client._hlsl_documents or {}
      client.notify = function(self, method, params)
        if method == "textDocument/didOpen" and params and params.textDocument and params.textDocument.uri then
          self._hlsl_documents[params.textDocument.uri] = params.textDocument.text or ""
        elseif method == "textDocument/didClose" and params and params.textDocument and params.textDocument.uri then
          self._hlsl_documents[params.textDocument.uri] = nil
        elseif method == "textDocument/didChange" and params and params.textDocument and params.textDocument.uri then
          local uri = params.textDocument.uri
          local previous_text = self._hlsl_documents[uri]
          local current_text = hlsl_full_text(uri)
          if previous_text
            and params.contentChanges
            and #params.contentChanges > 0
            and params.contentChanges[1].range == nil
          then
            params = {
              textDocument = params.textDocument,
              contentChanges = {
                {
                  range = {
                    start = { line = 0, character = 0 },
                    ["end"] = hlsl_end_position(previous_text, self.offset_encoding),
                  },
                  text = current_text,
                },
              },
            }
          end

          self._hlsl_documents[uri] = current_text
        end

        return old_notify(self, method, params)
      end

      client._hlsl_sync_wrapped = true
    end

    local function seed_hlsl_document(client, bufnr)
      client._hlsl_documents = client._hlsl_documents or {}
      client._hlsl_documents[vim.uri_from_bufnr(bufnr)] = hlsl_full_text(vim.uri_from_bufnr(bufnr))
    end

    -- table.insert(opts.servers.clangd.cmd, "--log=verbose")
    table.insert(opts.servers.clangd.cmd, "--query-driver=*c++*")
    table.insert(opts.servers.clangd.cmd, "--enable-config")

    -- HLSL / Shader Model 3.0 のための LSP 設定
    opts.servers.hlsl = {
      mason = false,
      cmd = { "ShaderTools.LanguageServer.exe" },
      filetypes = { "hlsl" },
      root_markers = { ".git" },
      workspace_required = false,
      flags = {
        allow_incremental_sync = false,
      },
      on_attach = function(client, bufnr)
        wrap_hlsl_sync(client)
        seed_hlsl_document(client, bufnr)
        client.server_capabilities.documentHighlightProvider = false
      end,
    }
  end,
}
