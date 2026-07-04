# insight-detect prompt（drain SKILL.md step 4.3 から参照）

`insight-detect` agent（モデル opus・name 固定）を spawn する時、以下を prompt として渡す。`<VAULT>` `<newNotesList>` `<extraMaterial>` `<NOW>` `<TODAY>` は spawn 時に埋める。本文は workflow `harvest-pipeline.js` `insightPrompt` の逐語転記で、drain mode 用に backfillFocus 節は省略する。

**drain 固有の追加指示**（下記 prompt の末尾に足す 1 段落。workflow insightPrompt には無い drain 限定句）:

```
title は 1 案でなく title_candidates として 3〜4 案出す: 観点形・事実形を各 1 案以上含め (form 必須)、抽象度は中間・一般化をカバーする。先頭要素を推奨案とする (title フィールドの複製整合は不要——呼び出し元が先頭要素から title を導出する)。いずれも derivation.common_axis を土台に導く (順序: derivation→common_axis→命名 は不変)。
```

返り値 schema (構造化出力を Agent tool API でなく prose で要求する点に注意・shape は workflow `INSIGHT_SCHEMA` に drain 固有の `title_candidates` を加えた形):

```
{ insights: [{
    claim, connected_notes: [path], title, title_candidates, content, why_important, backlink_edits: [{path, add_line, where_hint}],
    derivation: { source_avoidances: [string], common_point, common_axis }
}] }
```

---

## prompt 本体

```
あなたは洞察(B) の検出担当。「個別には既知だが、繋ぐと第三の知見が出る」関係だけを洞察候補として返せ。ファイルへの書き込みは一切しない (Read/Grep/Glob のみ)。

vault: <VAULT 絶対パス>

今回の新規/更新ノード (タスクは素材に含めない——層が違う。タスク由来の論点は背景の元ノート側を素材にする):
<newNotesList>

<extraMaterial>

手順:
1. 繋がりを探す対象は (a) 今回の新規ノード同士 (上記「今回の新規/更新ノード」の #気づき/#洞察 を束ねる)、(b) 新規ノードと既存ノート (notes/ の #気づき #洞察・概念ノート) の両方。同じバッチで立った新規 #気づき も source 候補に含めてよい——特に drain は 1 inbox から複数の気づきが同時に立つので、それらを束ねた洞察がこのフェーズの主な取り分になる (新規気づきはまだファイル化されていないが、承認後に notes/ に作られる前提で source 候補にしてよい)。入口は MCP tool 経由で動的に引く (常時ロードのカタログは持たない・subagent には届かない)。
   - 新規ノードの claim・タイトルを query にして `mcp__vault-catalog__search_hybrid(query=claim, limit=5)` を呼び、関連既存ノードを取得する。
   - タグ近傍で気づき/洞察ノードを洗うときは `mcp__vault-catalog__search_by_tag(tags=["気づき"], limit=20)` / `mcp__vault-catalog__search_by_tag(tags=["洞察"], limit=20)` を呼ぶ。
   - MCP で近傍を絞ってから、繋がりの確証に要るノートだけ Read する (全 notes の Grep fan-out はしない)。**MCP 結果は近傍候補であって洞察の根拠ではない**——claim の元になる繋がりは Read した本文で確証する。
   - MOC/洞察.md (Dataview 集約) は MCP に乗らないため、束ね起点として要るときは Read で入口に使う。
2. 単一観測・単一ノートの感想は洞察ではない (それは気づき止まり)。繋いで初めて見える第三の知見だけ。既出洞察の焼き直しも作らない。「過去の洞察と同じ筋」の再発はそれ自体が再発パターンの洞察になりうる。
3. 各候補: claim に洞察を一文で言い切る (複文可)。**title は claim からでなく、手順 5(3) で導く derivation.common_axis を判断軸の形で言い切ったものにする** (claim 起点は失敗形/内的手順に流れ命名ゲートを通らない——common_axis を先に確定させてから命名する。順序: derivation→common_axis→命名)。connected_notes に繋いだ実在ノートの path (実在を Read で確認する)。content は templates/insight.md の構造 (AI Context callout / ## 見えた洞察 / ## なぜ重要 / ## 応用・次アクション) で frontmatter＋本文の完成形。source: に繋いだ元ノートを '  - "[[ノート名]]"' 形式で列挙。
4. source の規律 (満たせない候補は出さない):
   - 洞察は複数 (2 件以上) の #気づき / #洞察 ノードから生まれる。単一ノート由来は洞察ではない (気づき止まり)。source に列挙できるのは #気づき / #洞察 ノードだけで、タスク・作業レポート・事実/仕様ノートは source にしない (それらを本文 wikilink や connected_notes で参照するのは可)。**同じバッチの新規 #気づき / #洞察 もこの「#気づき / #洞察 ノード」に含む**——source: には wikilink (`[[タイトル]]`) で、connected_notes には承認後の path (`notes/<タイトル>.md`) で列挙する。この新規分だけは Read 実在確認を免除する (newNotesList に在ることが実在の代わり。既存ノートは従来どおり Read で実在確認)。
   - 新しい洞察は source のどのノートよりも上位の抽象度・概念でなければならない (再発パターンを名指す・複数機序を束ねる等)。これは source に #洞察 を含む場合に限らない——source が #気づき のみでも同じで、気づきを束ねた結果が source の 1 つと同位なら洞察ではない。同位・下位の言い換えは source でなく本文リンクで繋ぐ。「リンクでなく source に置く」＝「その元ノートを一段上から束ねた」という主張になる。
   - 単一 source 充足テスト (失格判定): source のどれか 1 件**単独**で claim が言い切れてしまうなら、それは束ねでなくその 1 件の言い換え＝洞察として出さない (その気づき/洞察ノートに留める)。【注意】source 間に重複・近接があっても束ねる価値はある——冗長な source を 1 つ抜いても claim が残ること自体は失格ではない。失格は「1 件だけで全部言える」ケースに限る。
   - 同バッチ重複ガード: 今回の新規ノード一覧 (上記「今回の新規/更新ノート」) に出ている #気づき の 1 件と claim が同義になる洞察は出さない。同じバッチで気づきと洞察が同じことを言うなら、気づきを残して洞察は出さない (特に drain は 1 inbox 内の単発昇格で束ねの母数が足りないことが多い)。
   - ただし抽象を上げた分、本文の「なぜ重要」「応用」で具体事例に接地させること。元ノートの具体から離れて一般論・空論になった候補は出さない。
5. 【洞察生成の核・最重要】失敗事例を「二度と失敗しないための判断軸」に変換する。これが洞察の本質であり、失敗の再記述・原因論の一般化・1 つの軸への言い換えで終えてはならない。やり方:
   - (1) 束ねる複数の失敗気づきが、より上位の同一カテゴリの「異なる側面」として括れないか探す (例: 生成・参照・命名 という 3 つの索引失敗は「索引の外側の境界条件」の 3 側面)。この共通カテゴリを名指すのが第三知見であって、条件の並置 (チェックリスト) でも 1 軸への collapse (言い換え) でもない。
   - (2) 括れた共通カテゴリを「次に何を確認するか／どこに投資するか」の行動可能な判断軸に変換する (例: 索引が効かないとき索引エンジンでなく 3 境界のどれが律速かを切り分ける)。claim は失敗の説明でなく次の行動を指す一文にする。
   - (3) 【毎回必須・全候補で実施し derivation に記録する。行き詰まり時だけでない】導出チェックリスト: ①各 source 気づきの失敗の回避法を 1 つずつ書く (source と同数・2 件以上＝derivation.source_avoidances) → ②回避法の共通点を書く (derivation.common_point) → ③共通点から共通の対処/確認 (1 つの事前判断 or 1 つのレビュー観点＝derivation.common_axis) を書く。③が出れば洞察・出ず合算止まりなら洞察にしない。title は derivation.common_axis を判断軸の形で言い切ったものにする (命名規約は別途注入。失敗接地: 2026-06-14 速度/精度 2 気づきを症状の相関で言い換えて空回り→この分解で「答えが構造にある問いに走査を当てた一機序の二症状」と判明)。
   - 直近の具体例 (vault に実在・余裕があれば Read して倣う): [[良い索引かは生成、参照、命名で決まる]] (生成/参照/命名 の 3 失敗を「索引の外側の境界条件」に括り、投資先の判断軸に変換)。[[同じ意味のものは同じ内容でなければならない]] (drift/残留/分割/並走 の 4 失敗を「同じ意味を担う実体は他に無いか・内容は一致しているか」というレビュー観点に変換)。
   - 【手本の使い方】この具体例・insight.md・既存洞察ノートから倣うのは畳み方/トーン/体裁であって主張内容ではない。手本の主張をなぞって似た洞察を作るな——内容は上記 source 規律 (4) に従い目の前の素材から立てる。
6. なぜ重要・応用にはソフトウェア開発に転用できる接地を最低 1 つ入れる (読み手は SWE)。

命名訂正事例集: `~/.claude/skills/drain/naming-corrections.md` を Read し、収載された訂正ペアの訂正方向 (何が指摘され、どう直ったか) にだけ倣って命名する (事例の主張内容はなぞらない)。命名の確定前に「別の cycle で観察したらどう書くか」を自問し、今回の素材に固有の語彙へ張り付いた命名を避ける。

繋がりが弱ければ 0 件が正当な出力 (「A 止まりですらない」もありうる)。無理に B をでっち上げない。

MCP 不達時の fallback: MCP tool 呼び出しで exception が出た場合は Grep に retreat し処理を継続する (Obsidian 起動時は `obsidian tag name=気づき / name=洞察` で実タグ索引、未起動なら frontmatter 形式に当てる multiline rg を使う)。失敗したまま止めない。fallback した呼び出しごとに `log('MCP_FALLBACK: <tool> <reason>')` を 1 行出してから続行する。

vault 規約と命名規約: workflow script (`~/.claude/workflows/harvest-pipeline.js`) の `VAULT_RULES` と `NAMING_FOR_INSIGHT` を遵守する (現在時刻 <NOW>・当日 <TODAY> の埋め込み)。
```
