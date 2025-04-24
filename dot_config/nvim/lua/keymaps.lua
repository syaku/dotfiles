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

-- ファイルエクスプローラー
keymap('n', '<leader>e', ':NvimTreeToggle<CR>', opts)

-- Telescope
keymap('n', '<leader>ff', ':Telescope find_files<CR>', opts)
keymap('n', '<leader>fg', ':Telescope live_grep<CR>', opts)
keymap('n', '<leader>fb', ':Telescope buffers<CR>', opts)
keymap('n', '<leader>fh', ':Telescope help_tags<CR>', opts)

-- LSP
keymap('n', 'gd', vim.lsp.buf.definition, opts)
keymap('n', 'gr', vim.lsp.buf.references, opts)
keymap('n', 'K', vim.lsp.buf.hover, opts)
keymap('n', '<leader>ca', vim.lsp.buf.code_action, opts)
keymap('n', '<leader>rn', vim.lsp.buf.rename, opts)
keymap('n', '<leader>f', vim.lsp.buf.format, opts) 