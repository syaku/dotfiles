"dein Scripts-----------------------------
if &compatible
  set nocompatible               " Be iMproved
endif

" Required:
set runtimepath^=$HOME/git/github.com/Shougo/dein.vim

" Required:
call dein#begin(expand('.'))

" Let dein manage dein
" Required:
call dein#add('Shougo/dein.vim')

" Add or remove your plugins here:
call dein#add('altercation/vim-colors-solarized')
call dein#add('scrooloose/nerdtree')

" Required:
call dein#end()

" Required:
filetype plugin indent on

" If you want to install not installed plugins on startup.
if dein#check_install()
  call dein#install()
endif

"End dein Scripts-------------------------

"=========================
" 基本設定
"=========================
" タブをスペース4つに
set tabstop=4
set autoindent
set expandtab
set shiftwidth=4
set number

"=========================
" ショートカット
"=========================
"ctrl+eでNERDTreeを開く
nnoremap <silent><C-e> :NERDTreeToggle<CR>

let g:solarized_termcolors=256
syntax enable
set background=dark
colorscheme solarized

set clipboard+=unnamedplus

