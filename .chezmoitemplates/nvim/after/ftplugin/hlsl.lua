-- HLSL でのコメントトグルの有効化
vim.bo.commentstring = "// %s"
vim.b.undo_ftplugin = (vim.b.undo_ftplugin or "") .. "\nsetlocal commentstring<"
