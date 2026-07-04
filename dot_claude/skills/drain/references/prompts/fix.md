# fix prompt（drain SKILL.md 4.7 step 3 から参照）

規約検証で違反が検出された候補に対し、`fixAndRevalidate` 同型の修正 sub-agent（schema = `FIX_SCHEMA`・model = sonnet）を spawn する時、以下を prompt として渡す。workflow `harvest-pipeline.js` の `fixAndRevalidate` 内本文の逐語転記。

`<errs>` は違反リストを ` / ` で連結したもの。`<NOW>` `<TODAY>` `<c.content>` は spawn 時に埋める。

```
以下のノート内容に機械検証で検出された規約違反がある。違反だけを直し、content 全文を返せ。指示に無い改変 (本文の追加・文体調整) を混ぜない。
違反: <errs.join(' / ')>
参考値: createdAt/updatedAt は <NOW>。更新履歴の日付リンクは [[<TODAY>]]。
--- content ここから ---
<c.content>
--- content ここまで ---
```
