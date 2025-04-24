-- プラットフォーム判定
local is_windows = vim.fn.has('win32') == 1
local is_mac = vim.fn.has('mac') == 1

-- リーダーキーの設定（lazyの読み込み前に設定）
vim.g.mapleader = ' '

-- 基本設定
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.mouse = 'a'
vim.opt.clipboard = 'unnamedplus'
vim.opt.undofile = true
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.termguicolors = true
vim.opt.expandtab = true
vim.opt.shiftwidth = 2
vim.opt.tabstop = 2
vim.opt.softtabstop = 2
vim.opt.smartindent = true
vim.opt.wrap = false
vim.opt.scrolloff = 8
vim.opt.sidescrolloff = 8
vim.opt.signcolumn = 'yes'
vim.opt.updatetime = 300
vim.opt.timeoutlen = 300

-- プラットフォーム固有の設定
if is_windows then
  vim.opt.shell = 'nu'
  vim.opt.shellcmdflag = '-c'
  vim.opt.shellxquote = ''
elseif is_mac then
  vim.opt.shell = 'zsh'
end

-- プラグイン管理の設定
local lazypath = vim.fn.stdpath('data') .. '/lazy/lazy.nvim'
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    'git',
    'clone',
    '--filter=blob:none',
    'https://github.com/folke/lazy.nvim.git',
    '--branch=stable',
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

-- 設定ファイルの読み込み
require('lazy').setup('plugins')
require('keymaps') 