# 結果が一つに決まる処理はコードに書く、の失敗接地

実行時には読み込まれない。規範本文は `~/.claude/rules/deterministic-over-llm.md`。

> 失敗接地: 2026-06-13、prompt に置いた件数の集計、命名の検査、モードの固定が、LLM 自身の申告に頼っていたためにずれていき、harvest-pipeline / plan-pipeline でコードへ移した。
