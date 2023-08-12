-- Plugin Maneger を自動でダウンロードする
local jetpackfile = vim.fn.stdpath('data') .. '/site/pack/jetpack/opt/vim-jetpack/plugin/jetpack.vim'
local jetpackurl = "https://raw.githubusercontent.com/tani/vim-jetpack/master/plugin/jetpack.vim"
if vim.fn.filereadable(jetpackfile) == 0 then
  vim.fn.system(string.format('curl -fsSLo %s --create-dirs %s', jetpackfile, jetpackurl))
end

-- vim-jetpack で入れ込むプラグインをここに記載していく
vim.cmd('packadd vim-jetpack')
require('jetpack.packer').add {
  {'tani/vim-jetpack'}, -- bootstrap
  {'jacoborus/tender.vim'},
  {'feline-nvim/feline.nvim'},
  {'nvim-treesitter/nvim-treesitter', run = ':TSUpdate'},
  {'nvim-tree/nvim-web-devicons'},
  {'akinsho/bufferline.nvim'},
  {'stevearc/oil.nvim'},
}
