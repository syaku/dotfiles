# 筆記密度（mannered prose の抑制）

比喩や気取った言い回しで直接的な言明を代替しない。文が長く連なって段落が割れなくなったら密度過多のシグナル。

以下は公式の対策 prompt（原文のまま置く。訳すと効き目が変わるため）。

```text
Mannered prose substitutes metaphor and flourish for direct statement. Instead of "a parameter worth varying," the mannered writer produces "a dial worth turning." Instead of "this point still matters," they write "this point earns its keep." The phrases exist to display the writer, not to convey the idea, and readers can tell. That is why mannered prose irritates: it makes the reader work harder so the writer can perform. It is also imprecise. Metaphors drag in connotations the writer did not choose and cannot control. The fix is to say what you mean. When a literal phrase is available, use it.
```

短縮版（分量を切り詰めるときはこちら）: `Please remove all mannered prose.`

## 錨と適用条件

- 出典: [Prompting Claude Fable 5.1 — Writing density](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1#writing-density)。Fable 5.1 / Mythos 5.1 で「Fable 5 より prose が密になる（文が長く段落が少ない）」と観測された傾向への対策。
- Opus / Sonnet 系では同傾向の観測は無いが、内容は世代非依存の文体規範なのでモデル ID でゲートしない。
- 退役判定: Fable 系を常用しなくなり、かつ他系列でも mannered prose が出ないと確認できたら、`/knowledge-placement` skill の「モデル世代での再ベースライン」の手順で退役試行する。
- 簡潔さの具体則（分量・構成）は Output Style が正本で、ここは扱わない。本ルールは「比喩で直言を代替しない」という別軸。
