-- pit-task の設定。書いていないキーは既定値で動く（キーの一覧は pit-task の README）。

-- 機械ごとの値は、このファイルと同じディレクトリの local.lua に書く。
-- local.lua は dotfiles で配らない。無い機械では既定値で動く。
local ok, machine = pcall(require, "local")
if not ok then
  machine = {}
end
if type(machine) ~= "table" then
  error("local.lua: table を返していません（最後に return { ... } を書きます）", 0)
end

return {
  vault = machine.vault,
  tasks_dir = machine.tasks_dir,
  template = machine.template,
  -- review は task を引き継がないので、両方に渡す。
  task = { claude = { args = machine.claude_args } },
  -- PR レビューのタスクは、通常のタスク（tasks）と別の herdr workspace に起動する。
  review = { workspace = "review", claude = { args = machine.claude_args } },
}
