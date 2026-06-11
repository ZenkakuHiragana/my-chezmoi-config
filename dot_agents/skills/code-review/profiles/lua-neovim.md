# Lua + Neovim Review Profile

Use this profile for Neovim Lua configuration or plugins in addition to `profiles/lua-generic.md`.

## Triggers

- global state or options changed without restoring or documenting scope
- autocmds, keymaps, commands, or highlights registered repeatedly
- plugin setup order, lazy-loading, or dependency assumptions
- buffer-local vs global behavior confused
- `vim.g`, global keymaps, pattern-wide autocmds, or global options used where buffer-local or window-local scope may be intended
- user commands or keymaps named by raw strings in multiple places
- compatibility fallbacks for old Neovim or plugin versions added without a stated support policy
- docs that describe private config history instead of user-facing behavior

## Questions

- Is this project personal config, a reusable plugin, or shared team config?
- Are repeated source/reload operations safe?
- Are commands, autocmd groups, and keymaps idempotent where needed?
- For each option, autocmd, keymap, highlight, or command, is the intended scope global, buffer-local, window-local, tab-local, or project-local?
- Does a global registration accidentally affect every buffer when the behavior is meant for one filetype, project, or buffer?
- Does the change follow existing plugin-manager and module patterns?

## Prefer

- named augroups and clear cleanup semantics
- local scope for buffer-specific behavior
- explicit `buffer`, filetype pattern, or local option use when behavior is not meant to be global
- direct config when there is no public compatibility contract
