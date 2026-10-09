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
  task = { claude = { args = machine.claude_args } },
  -- PR レビューのタスクは、通常のタスク（tasks）と別の herdr workspace に起動する。
  review = {
    workspace = "review",
    -- 書かなければ task.cwd ではなく既定の ~/workspace になる。
    cwd = machine.review_cwd,
    command = machine.review_command,
    prompt = machine.review_prompt,
    -- review は task を引き継がないので、別に渡す。
    claude = { args = machine.review_claude_args },
  },
  -- issue のタスク（requestUrl が /issues/ のノート）。workspace は通常のタスクと同じ tasks にする。
  -- 古い pit-task はこの表を知らないキーとして止まるので、全部の機械の pit-task を上げてから書く。
  issue = {
    cwd = machine.issue_cwd,
    command = machine.issue_command,
    prompt = machine.issue_prompt,
    -- issue は task も review も引き継がないので、別に渡す。
    claude = { args = machine.issue_claude_args },
  },
  -- PR レビューと issue の一覧に足すリポジトリ。owner/* は owner の下を全部対象にする。
  github = { repos = { "syaku/*" } },
}
