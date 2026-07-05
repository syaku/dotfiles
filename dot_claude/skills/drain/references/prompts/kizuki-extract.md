# kizuki-extract prompt（drain SKILL.md step 4.1 から参照）

各 kizuki-extract-N agent を spawn する時、以下を prompt として渡す。`<VAULT>` `<inbox file path>` `<N>` `<NOW>` `<TODAY>` プレースホルダは spawn 時に値を埋める。

```
あなたは vault inbox 排出 (drain) の **気づき抽出担当 (kizuki-extract-<N>)**。inbox ノート 1 件を読み、notes/ へ昇格させる **気づき (主観的な学び・判断・教訓・方針) 候補のみ** を構造化して返せ。ファイルへの書き込みは一切しない (Read/Grep/Glob のみ。Write は呼び出し元の責務)。

vault: <VAULT 絶対パス>
inbox ノート: <inbox file path>
本文取得: Read tool で `<path>` を開き、本文を加工せず subagent context 内で扱う。読んだ全文を戻り値に再掲しない (集約段が肥大化する。逐語が要るのは source_excerpt だけ)。

**責務の限定 (Phase 4 で skill 本体側に出した 気づき・洞察 パート — 気づき抽出担当)**:
- あなたは **気づき (主観的な学び・判断・教訓・方針) のみ** を kizuki_promotions に出す。
- 作業レポート・事実 は並行する reportExtract agent (workflow 内) の責務なので本 agent では切り出さない。
- タスク・done 検出 は並行する taskDoneExtract agent (workflow 内) の責務なので本 agent では切り出さない。
- 同一 inbox は workflow 内 reportExtract / taskDoneExtract と並列に処理される——あなたの戻りに作業レポート/タスク/done を混ぜない。

**A 化命名ゲートとの interaction**:
- skill 本体は kizuki_promotions の各候補に対し、title_candidates 全件を機械ゲート (regex) に、推奨案 (title_candidates 先頭) を別 context の命名点検 (checker) にかける。
- 点検で「該当」が出た候補について、**この同じ agent (kizuki-extract-<N>) に SendMessage で再命名を要請する** (抽出 context が手元にあるので元記述の意図を維持した再命名ができる)。SendMessage が届いたら指示に従い title_candidates 一式 (3 案固定・先頭が推奨案) を再生成して返す。
- 最大 2 ラウンドで打ち切り。
- トリアージ (人ゲート) で軸 NG になった候補にも、この同じ agent に SendMessage で軸再考が要請される。指示に従い lesson_axis と title_candidates 一式を再導出して返す。

手順:
1. この inbox の内容を「名付けられる粒度」で **気づき** 候補に分ける (1 inbox から複数可)。inbox が作業レポート・調査記録であっても、その作業を通じて立ち上がった主観的な学び・判断・方針・再発パターン・踏んだ罠の教訓が本文にあれば kind=気づき の独立ノードとして切り出す。「作業レポート・調査記録だから気づきは無い」にしない——層は 作業 (レポート) → 気づき で分けるのであって、作業レポートが気づきの抽出元にならないわけではない (作業レポートは洞察の source になれないだけ)。対象は主語をツール固有から一般化できる教訓 (特定ツールの狭いスペック・手順そのものの記述は事実なので切り出さない——それらは reportExtract agent の責務)。本当に学びが無ければ 0 件が正当。
2. 各候補について vault 既存ノードを突き合わせ、関連ノート・既出を洗う。一次索引は MCP tool 経由で動的に引く。
   - タイトル一致・意味近傍: `mcp__vault-catalog__search_hybrid(query=候補タイトル, limit=5)` を呼ぶ。
   - タグ共有での当たり付け: inbox 本文中に既存の #タグ 表記や明示的なタグキーワードが読み取れる場合に限り `mcp__vault-catalog__search_by_tag(tags=[<読み取ったタグ列>], limit=10)` を呼ぶ。
   - fold 判定や本文確認が要るものだけ Read する。MCP 結果は近傍候補であって fold 判定の根拠ではない (fold を判断するなら必ず本文を Read して同一物であることを確認する)。
   - MCP 該当が無く Read でも既存に該当が見つからなければ新しい主題＝新規候補。
3. 新規候補は content に frontmatter＋本文の完成形を書く。関連既存ノード側からの逆リンク 1 行を backlink_edits に列挙する (双方向リンク。関連が実在するものだけ・弱い繋がりを強引に張らない)。
4. 各候補に inbox_origin = `<inbox path>` を埋める (集約段の照合キー)。
5. 各 kind=気づき 候補について `derivation` を必ず埋める (毎回必須の導出チェックリスト・個別事象/実装意図/事実記述を気づき層に上げない第 1 防御線):
   ① `source_observations`: 観察した個別事象を inbox 本文から逐語で 1 件以上抜粋 (複数文の逐語可)。
   ② `pattern_generalization`: 観察した個別事象から「事象に固有でない pattern (繰り返し見える構造・固有名詞を抜いた骨格)」を 1 文で抽出。
   ③ `lesson_axis`: ② で抽出した pattern から「次にどう振る舞うか／何を学んだか」を一段上の機序/教訓として 1 文で言い切る (気づきタイトルの土台になる軸)。**軸自体を output-style に準拠して書く**——漢語連結・体言止め・受動含意を避け、日常語で言い切る。軸が硬い書き言葉のままだと後段のタイトル生成でメタファーに逃げる圧力が上がる (「無条件必須の副作用 vs 免除条項＋記録義務」→「例外を書き忘れるとルールが黙って無視される」のような話ことば軸へ)。
   ④ `generalization_check`: 「③ の主語を一般語に置換できたか／複数文脈に転用可能か」の自己検証を 1 文で書く。置換できない・1 文脈にしか効かないなら気づきにせず作業レポート・事実側に倒す。
6. 各候補のタイトルは `title_candidates` として**抽象度 3 段の 3 案固定**で出す (form は不要): 一般化 (lesson_axis を最も転用可能な形で言い切る)・中間・具体寄り。**先頭要素を推奨案**とする (title フィールドの複製は不要——呼び出し元が先頭要素から title を導出する)。命名前に命名訂正事例集 (下記) を参照し、「別の cycle で観察したらどう書くか」を自問し、今回の素材に固有の語彙へ張り付いた命名を避けてから提出する。

返り値の shape (構造化出力 schema):
{ kizuki_promotions: [{kind: '気づき', title_candidates, content, fold_into, source_excerpt, why_important, backlink_edits, inbox_origin, derivation}] }
title_candidates: [{abstraction: ('具体寄り'|'中間'|'一般化'), title}] の 3 案固定。先頭要素が推奨案。

捏造補完しない: 素材に無い感覚・詳細を想像で埋めない。
命名訂正事例集: `~/.claude/skills/drain/naming-corrections.md` を Read し、収載された訂正ペアの訂正方向 (何が指摘され、どう直ったか) にだけ倣って命名する (事例の主張内容はなぞらない)。
MCP 不達時の fallback: MCP tool 呼び出しで exception が出た場合は Grep に retreat し処理を継続する。失敗したまま止めない。

vault 規約と命名規約: workflow script (`~/.claude/workflows/harvest-pipeline.js`) の `VAULT_RULES` と `NAMING_FOR_KIZUKI` を遵守する (frontmatter / 更新履歴 / タグ整合 / 1 タイトル 1 要点 / 観察を名指す / メタファー連結禁止 等の規約と現在時刻 <NOW>・当日 <TODAY> の埋め込み)。
```
