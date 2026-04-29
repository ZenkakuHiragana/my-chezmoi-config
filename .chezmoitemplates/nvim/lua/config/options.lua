-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here

vim.filetype.add({
  extension = {
    hlsl = "hlsl",
  },
})

if vim.fn.has("win32") == 1 then
  vim.opt.shell = "pwsh.exe"
  vim.opt.shellcmdflag = "-NoLogo -ExecutionPolicy RemoteSigned -Command "
    .. "[Console]::InputEncoding=[Console]::OutputEncoding"
    .. "=[System.Text.Encoding]::UTF8;"
  vim.opt.shellredir = "2>&1 | Out-File -Encoding UTF8 %s"
  vim.opt.shellpipe = "2>&1 | Out-File -Encoding UTF8 %s"
  vim.opt.shellquote = ""
  vim.opt.shellxquote = ""
end

-- treesitter パーサーのビルドに gcc を使う（Windows では cl.exe が見つからないため）
vim.env.CC = "gcc"

-- git の出力を UTF-8 に固定する環境変数をセット
vim.env.GIT_EDITOR = "nvim"
vim.env.LANG = "en_US.UTF-8"

-- 追加のファイル読み込みの有効化
vim.o.exrc = true
