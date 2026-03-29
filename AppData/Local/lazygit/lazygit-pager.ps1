#!/usr/bin/env pwsh
[Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding           = [System.Text.UTF8Encoding]::new($false)

$old = $args[1].Replace('\', '/')
$new = $args[4].Replace('\', '/')
$path = $args[0]

git diff --no-index --no-ext-diff $old $new `
  | ForEach-Object { $_.Replace($old, $path).Replace($new, $path) } `
  | delta --width=$env:LAZYGIT_COLUMNS --line-numbers --hyperlinks `
    --hyperlinks-file-link-format="lazygit-edit://{path}:{line}"
