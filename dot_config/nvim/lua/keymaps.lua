local keymap = vim.keymap.set
local opts = { noremap = true, silent = true }

-- リーダーキーの設定
vim.g.mapleader = ' '

-- 基本的なキーマッピング
keymap('n', '<leader>w', ':w<CR>', opts)
keymap('n', '<leader>q', ':q<CR>', opts)
keymap('n', '<leader>h', ':nohlsearch<CR>', opts)
keymap('n', '<C-s>', ':w<CR>', opts)
keymap('i', '<C-s>', '<Esc>:w<CR>', opts)

-- ウィンドウ操作
keymap('n', '<C-h>', '<C-w>h', opts)
keymap('n', '<C-j>', '<C-w>j', opts)
keymap('n', '<C-k>', '<C-w>k', opts)
keymap('n', '<C-l>', '<C-w>l', opts)

-- タブ操作
keymap('n', '<leader>tn', ':tabnew<CR>', opts)
keymap('n', '<leader>tc', ':tabclose<CR>', opts)
keymap('n', '<leader>th', ':tabprev<CR>', opts)
keymap('n', '<leader>tl', ':tabnext<CR>', opts)

-- ファイルエクスプローラー（snacks）
keymap('n', '<leader>e', function() Snacks.explorer() end, opts)

-- ピッカー（snacks）
keymap('n', '<leader>ff', function() Snacks.picker.files() end, opts)
keymap('n', '<leader>fg', function() Snacks.picker.grep() end, opts)
keymap('n', '<leader>fb', function() Snacks.picker.buffers() end, opts)
keymap('n', '<leader>fh', function() Snacks.picker.help() end, opts)

-- LSP
keymap('n', 'gd', vim.lsp.buf.definition, opts)
keymap('n', 'gr', vim.lsp.buf.references, opts)
keymap('n', 'K', vim.lsp.buf.hover, opts)
keymap('n', '<leader>ca', vim.lsp.buf.code_action, opts)
keymap('n', '<leader>rn', vim.lsp.buf.rename, opts)
keymap('n', '<leader>cf', vim.lsp.buf.format, opts) 