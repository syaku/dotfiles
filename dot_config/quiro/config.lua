-- quiro の設定ファイル（Lua）。
-- 置き場所:
--   macOS   ~/.config/quiro/config.lua
--   Windows %USERPROFILE%\.config\quiro\config.lua
--
-- 最後に return { ... } で設定の table を返す。知らないキーや型の誤りは、位置付きで
-- 読み込みが落ちる。「設定を再読み込み」のときは理由がウィンドウに出て、設定は前の
-- まま残る。起動のときは quiro が起動せず、理由は標準エラー（macOS は
-- ~/Library/Logs/quiro.err.log）にだけ出る。
--
-- パスの先頭の ~/ はホームディレクトリに展開する。環境変数は展開しない。
-- exec の実体が無い entry は一覧に出ない。
--
-- 書き方の全体は quiro の README と config.example.lua を参照。

-- 全部の機械で同じパスで書ける起動対象と走査先だけをここに書く。
local entry = {
  { name = "workspace", exec = "~/workspace", keywords = { "ws", "repos" } },
  { name = "quiro の設定", exec = "~/.config/quiro/config.lua", keywords = { "config", "settings" } },
}

local scan = {
  { dir = "~/.local/bin" },
}

-- 機械ごとの起動対象と走査先は、このファイルと同じディレクトリの local.lua に書く。
-- local.lua は dotfiles で配らない（.chezmoiignore）。無い機械では何も足さない。
--
--   return {
--     entry = {
--       { name = "Ghostty", exec = "/Applications/Ghostty.app", keywords = { "terminal", "term" } },
--     },
--     scan = {
--       { dir = "d:/tools/" },
--     },
--     claude_args = { "--add-dir", "~/notes" },
--   }
--
-- claude_args は Claude モードで起動する claude に足す引数で、claude.args にそのまま渡す。
--
-- pcall で包むので、local.lua の構文エラーと実行時エラーは黙って無視される（その機械の
-- 候補が出ないだけになる）。local.lua の entry の中のキーや型の誤りは設定全体を落とし、
-- 位置は共有の entry の後ろに足した後の添字（entry[3].foo など）で出る。
local ok, machine = pcall(require, "local")
if not ok then
  machine = {}
end

-- ipairs でそのまま足すと、内側の括弧を書き忘れた entry や、並びに混ぜた名前付きの
-- キーが黙って飛ばされる。並びが 1 から続く添字だけでできているかを確かめてから足す。
local function append(list, items)
  if items == nil then
    return
  end
  local count = 0
  if type(items) == "table" then
    for _ in pairs(items) do
      count = count + 1
    end
  end
  if type(items) ~= "table" or count ~= #items then
    error("local.lua: 並び（{ { ... }, { ... } }）で書きます", 0)
  end
  for _, item in ipairs(items) do
    table.insert(list, item)
  end
end

if type(machine) ~= "table" then
  error("local.lua: table を返していません（最後に return { ... } を書きます）", 0)
end
append(entry, machine.entry)
append(scan, machine.scan)

return {
  -- 修飾子は Alt / Ctrl / Shift / Super(macOS の Cmd) を + で繋ぐ。
  hotkey = "Alt+.",

  entry = entry,
  scan = scan,

  -- prefix + 半角空白 で入り、打った語を既定ブラウザで検索する。
  search = {
    {
      name = "Google",
      prefix = "s",
      url = "https://www.google.com/search?q={query}",
      icon = "fa-brands:google",
    },
    {
      name = "GitHub",
      prefix = "gh",
      url = "https://github.com/search?q={query}",
      icon = "fa-brands:github",
    },
  },

  -- herdr の pane 一覧（prefix は p で固定）。書けるのは icon だけ。
  pane = {
    icon = "~/.config/quiro/icons/herdr_logo.svg",
  },

  -- Claude Code のセッション。この表を消せばモードごと出なくなる。
  claude = {
    prefix = "cc",
    root = "~/workspace",
    workspace = "workspace",
    args = machine.claude_args,
    icon = "fa-brands:claude",
  },
}
