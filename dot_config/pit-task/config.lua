-- pit-task の設定。書いていないキーは既定値で動く（キーの一覧は pit-task の README）。
return {
  -- PR レビューのタスクは、通常のタスク（tasks）と別の herdr workspace に起動する。
  review = { workspace = "review" },
}
