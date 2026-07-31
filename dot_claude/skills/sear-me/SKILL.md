---
name: sear-me
description: 計画に入る前に、**後続（plan / implement）が設計・実装を進めるのに足りない情報を炙り出し**、埋まったものを目的（Purpose / Why）と受入条件（Acceptance / Done）として <現在の作業スペース>/premise.md に確定するスキル。設計・Phase 分け・具体的な変更箇所は plan の領分で踏み込まない。「前提を整理して」「計画前に炙り出して」「要件を固めて」「目的と受入条件を出して」などの依頼で起動する。
---

# sear-me: searing の入口（stub）

searing セッションを実行する（`Skill` tool で `searing` を起動する）。

セッションの中身——3 原則・フロー・premise.md の構成・plan との契約・やってはいけないこと——はすべて searing 側が正本。上流 mattpocock/skills の grill-me→grilling と同じ stub 分割で、派生入口（例: sear-with-docs）は searing を書き換えず stub＋前処理の形で足す。

上流 grill-me は `disable-model-invocation: true` を置くが、sear-me には置かない——/develop から Skill tool で呼ばれる経路が塞がるため（意図的な上流からの逸脱）。
