---
paths: ["**/.claude/**", "**/dot_claude/**"]
---

# subagent への規範伝播

- skill・pipeline を設計するとき、常時ロード規範（CLAUDE.md・@import・rules）が workflow script 内の agent() に継承されると仮定しない。成果物に効かせたい規範（特に output-style の要点）は agent の prompt に明示注入する。
- 失敗接地: 2026-06-30、plan-pipeline で output-style 非継承による違反（「runtime 窓」等の合成名詞）を観測。main 直下の Agent tool は通常継承するため、workflow 内 agent() と区別する。
