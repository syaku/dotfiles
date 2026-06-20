return {
  -- カラースキーム
  {
    'catppuccin/nvim',
    name = 'catppuccin',
    lazy = false,
    priority = 1000,
    config = function()
      require('catppuccin').setup({
        flavour = 'mocha',
      })
      vim.cmd.colorscheme('catppuccin')
    end,
  },

  -- ファイル操作・ピッカー統合（snacks.nvim）
  {
    'folke/snacks.nvim',
    priority = 1000,
    lazy = false,
    opts = {
      explorer = { enabled = true },
      picker = { enabled = true },
    },
  },

  -- ステータスライン
  {
    'nvim-lualine/lualine.nvim',
    dependencies = { 'nvim-tree/nvim-web-devicons' },
    config = function()
      require('lualine').setup({
        options = {
          theme = 'catppuccin-nvim',
          component_separators = { left = '|', right = '|' },
          section_separators = { left = '', right = '' },
        },
      })
    end,
  },

  -- LSP
  {
    'neovim/nvim-lspconfig',
    dependencies = {
      'williamboman/mason.nvim',
      'williamboman/mason-lspconfig.nvim',
      'saghen/blink.cmp',
    },
    config = function()
      require('mason').setup()
      require('mason-lspconfig').setup({
        ensure_installed = {
          'lua_ls',
          'rust_analyzer',
          'ts_ls',
          'pyright',
        },
      })

      -- Neovim 0.11 標準の vim.lsp.config / vim.lsp.enable を使用。
      -- 各サーバのデフォルト設定は nvim-lspconfig の lsp/<name>.lua が提供する。
      local capabilities = require('blink.cmp').get_lsp_capabilities()
      vim.lsp.config('*', { capabilities = capabilities })
      vim.lsp.enable({ 'ts_ls', 'lua_ls', 'rust_analyzer', 'pyright' })
    end,
  },

  -- 補完（blink.cmp）
  {
    'saghen/blink.cmp',
    version = '1.*',
    opts = {
      -- 現状の nvim-cmp に近い操作感：Enter 確定、<C-Space> 表示、<C-e> 閉じる、<C-b>/<C-f> ドキュメントスクロール
      keymap = { preset = 'enter' },
      sources = {
        default = { 'lsp', 'path', 'snippets', 'buffer' },
      },
    },
  },

  -- シンタックスハイライト（nvim-treesitter main ブランチの新API）
  {
    'nvim-treesitter/nvim-treesitter',
    branch = 'main',
    build = ':TSUpdate',
    config = function()
      local langs = {
        'lua',
        'rust',
        'go',
        'typescript',
        'javascript',
        'python',
        'markdown',
        'markdown_inline',
      }
      -- パーサーをインストール（旧 ensure_installed 相当）
      require('nvim-treesitter').install(langs)

      -- ハイライトとインデントはバッファ単位で起動する（旧 highlight/indent enable 相当）
      vim.api.nvim_create_autocmd('FileType', {
        pattern = langs,
        callback = function()
          pcall(vim.treesitter.start)
          vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
        end,
      })
    end,
  },
} 