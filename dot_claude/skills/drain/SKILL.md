---
name: drain
description: vault の inbox/ に溜まった capture（人の生ダンプ・会話文脈の無い AI 成果物）を notes/ ノードへ昇格させ、作業レポートから既存タスクの done も検出する inbox 排出スキル。「drain して」「inbox を処理して」「inbox を空にして」などで起動する。遡り蒸留（期間指定の done reconcile・創発/メタ洞察）は別スキル /harvest。対象 vault は ~/workspace/notes/obsidian/Life（Obsidian、日本語運用）。
---

# drain: inbox/ → notes/ の昇格（inbox 排出）

`~/workspace/notes/obsidian/Life`（以下 vault）の `inbox/` に着地した capture を notes/ ノードへ昇格させるスキル。capture と AI の処理は非同期（capture は inbox/ に足すだけ・notes/ は AI 単一 writer）なので、**会話に作業痕跡が無いのは劣化ではなく正常運用**——`inbox/` の中身が正規の作業リスト。3 つの認知対象（気づき A／洞察 B／タスク T）の定義・タグ規約は vault の `Life/CLAUDE.md`「学習ループ」節が正本。

## 4 パート構造（Phase 4 で確定）

drain の蒸留は 4 パートに分離される。各パートの責務・物理配置・命名ゲートの形は次のとおり:

| パート | 担当 | 命名ゲート |
|---|---|---|
| LLM Wiki（作業レポート・事実） | workflow 内 reportExtract agent（sonnet・inbox ごとに並列） | regex + 単純 checker のみ（renamer 撤廃の light gate） |
| タスク done | workflow 内 taskDoneExtract agent（sonnet・inbox ごとに並列） | task checker のみ（最大 2 ラウンド） |
| 気づき・洞察 | **skill 本体側**（気づき抽出 = sonnet / 洞察検出 = opus） | **self-check 版**（抽出 prompt 内の反証点検＋shape コード検査・regex は注記・再命名ラウンド無し） |
| 整形・出力 | workflow script 段（規約機械検証・rename swap・totals 計算・per_part_metrics 算出） | 該当なし |

LLM Wiki と タスク done は workflow（`~/.claude/workflows/harvest-pipeline.js`, `mode: 'drain'`）に委譲する。気づき・洞察 パートは skill 本体側で実行する（self_check artifact の shape 検査とトリアージ統合が本体にあり、workflow を経由する利得が無いため）。整形・出力 パートは workflow script 段に置く（Phase 1-3 の集計ロジックがそこにあり移植コストが最小）。

**done 検出は drain の責務**。完了証跡（「X 完了」と読める作業レポート）は inbox/ という耐久ファイルに逐語で着地する——drain は昇格中の inbox 本文を corpus に既存タスクと突き合わせ、done 候補を出す（taskDoneExtract agent の責務）。証跡到着＝drain 起動＝トリアージ承認ゲートの連鎖なので、**done 化も命名・層判定と同じ人承認経由**で整合する（揮発する会話バッファでなく耐久ファイルが証跡なのが要点）。順序ギャップ（完了レポートが先に drain され、タスクノートが後から作られて drain 時に存在しないケース）は event-driven では構造的に拾えず、期間を切って再照合する /harvest（backfill）の reconcile sweep が拾う。

drain は drain 産ノートの後段見直し（命名・層判定の opus 再点検）を持たない——その役目は /harvest（backfill）が期間指定で担う。drain は done 訂正が承認ループで発生する入口なので、**運用ログ記録は行う**（step 7・記録フォーマットは /harvest スキルの同名節が正本）。

## 厳守プロトコル

- **notes/ への Write/Edit は、トリアージ一覧の承認後に本体だけが行う**（workflow と skill 本体側の subagent は read-only の分析と候補生成のみ）。
- **workflow 戻りの `candidates` と skill 本体側 気づき・洞察候補を本体で要約・取捨・マージ・再命名しない**（生の N 件＝提示の N 件。命名はゲート済み——LLM Wiki / タスク done は workflow 内ゲート・気づき・洞察 は抽出 prompt 内 self-check ＋ skill 本体側 shape 検査。N は候補 item 数を指し、1 item の複数タイトル案（`title_candidates`）は提示形式で違反に当たらない）。
- **候補タイトルは全て抽出 agent 産**——本体はタイトルを生成しない・複数案から事前に絞り込まない（regex 機械ゲートによる除外は機械規則の適用であって本体の絞り込みに当たらない）。
- **処理前スナップショットを不変に保つ。** 読込直後に `ls ~/workspace/notes/obsidian/Life/inbox/*.md | sort` の出力を控え、処理途中で取り直さない（archive 退避前の消失検知の基準）。
- **命名品質の一次保証は抽出 agent の self-check**（生成と同一 prompt 内の反証点検・全候補 × 全基準・fail は逐語 evidence 必須）。skill 本体は self_check artifact の shape をコードで検査するだけで、タイトルの再生成を agent に要請しない（checker agent・SendMessage 再命名ラウンドは 2026-07-05 β3 実測で廃止）。人の選択・手入力は採択であって agent への差し戻しではない。
- **外部インポート（`imports/kindle/`・`imports/wallabag/`）は読み取りのみ。**
- inbox が空・所感なしの断片だけなら「A 止まりですらない」と正直に報告し、洞察をでっち上げない。原本の archive 退避だけ行う。

## フロー

### 1. スナップショットと読込

- `ls ~/workspace/notes/obsidian/Life/inbox/*.md | sort` を控える（README.md は処理対象外）。**空なら「drain 対象なし」と報告して即終了**。
- **inbox 件数が 30 件を超えるとき分割を促す**: スナップショット件数が **30 件を超える** 場合は、1 cycle で全件処理せず分割を推奨する（理論見積もりで subagent_tokens が許容閾値 300k に近づくため。Phase 4 で気づき抽出が skill 本体側に出たため inbox 件数 ×（reportExtract + taskDoneExtract + 気づき抽出 + α）の並列度になる——上限見積もりは plan.md の安全ゾーン計算）。同席ユーザがいれば「分割しますか」と一言確認する。
- inbox 本文の取得は **各 subagent が Read する**規約（main は本文を持たない）。main で取得するのは `inbox_files: [{path}]` の path 列だけ（`ls` 結果から構築）。後方互換のため、本文を持ちたい例外ケースでは `content` を同梱してもよい（workflow と skill 本体側 subagent の双方で content 非空なら Read をスキップする）。
- 曖昧な点があり同席ユーザがいれば確認する（無い文脈を想像で復元しない）。Obsidian Sync 競合対策として、同席ユーザがいれば他端末の Obsidian を閉じるよう一言促す（副次的防御。主防御は step 6 の照合・停止）。
- 現在時刻（ISO-T）と当日日付を `date` で取得する（workflow script は Date を使えないため args で渡す・skill 本体側 subagent に渡す prompt にも埋め込む）。
- **Obsidian 起動判定**: `pgrep -x Obsidian` で起動の有無を 1 回だけ確認する（起動判定は run 中で不変なので再取得しない）。この真偽は step 2 の `obsidian_available` で workflow に渡す。
- **既存タスク一覧の収集** (起動判定で分岐・done 検出の突き合わせ素材): frontmatter tags に `タスク` を含み、かつ `progress: done` でない既存ノートの path + title 一覧を作る。**progress フィルタは必須** (done 済みタスクが再 done 候補に上がると人ゲートを通って二重訂正が必要になる。backfill donePrompt は progress フィルタを明示しているが drain 経路はここで data 段防御する)。taskDoneExtract subagent が done 候補検出のために突き合わせる素材となる（args `open_tasks: [{path, title}]` で渡す）。

    ```bash
    # 起動分岐で「タスク タグを持つ path のリスト」を取得 → awk で frontmatter progress を 1-pass で抽出して done を除外。
    # while IFS= read -r p で読むため空白入り path を破壊しない (R2-3/R2-15)。
    # progress 抽出は awk (PCRE2 不要・rg -oP \K の依存を避ける・R2-7) で 1 file=1 awk fork (obsidian property:read による
    # MCP server 起動コストの N 回 fork を避ける・R2-2)。awk は frontmatter (`^---$` で挟まれた範囲) の `^progress:` 行だけを
    # 抜き、本文中の "progress:" 表記には反応しない (frontmatter 終端で exit)。
    # obsidian 分岐は vault-relative path (`notes/...`) を出すため awk 呼び出し時は vault_root prefix で絶対化する (R3-1)。
    # 出力は元の path 形式 (obsidian=vault-relative・rg=absolute) のまま保つ (後段 open_tasks 互換)。
    vault_root=~/workspace/notes/obsidian/Life
    extract_progress_awk='BEGIN{c=0} /^---$/{c++; if(c>=2)exit; next} c==1 && /^progress:/{sub(/^progress:[[:space:]]*/, ""); sub(/[[:space:]]*$/, ""); print; exit}'

    if pgrep -x Obsidian >/dev/null; then
      obsidian tag name=タスク | grep '^notes/'
    else
      rg -l --multiline -U '(?s)^---\n(.*?\n)*?tags:\n(\s*-\s+[^\n]*\n)*\s*-\s+タスク' "$vault_root/notes"
    fi | while IFS= read -r p; do
      case "$p" in /*) full="$p" ;; *) full="$vault_root/$p" ;; esac
      progress=$(awk "$extract_progress_awk" "$full")
      [ "$progress" != "done" ] && printf '%s\n' "$p"
    done
    ```

    取得した path 列から拡張子を落として title を作る（または各ノートの frontmatter title フィールドがあればそれを優先）。

### 2. harvest-pipeline workflow の起動（LLM Wiki + タスク done パート）

`Workflow` tool を以下で起動する:

- `scriptPath`: `~/.claude/workflows/harvest-pipeline.js`
- `args`（JSON オブジェクトとして渡す。文字列化しない）:
  - `mode`: `"drain"`
  - `vault`: vault の絶対パス
  - `now`: ISO-T 現在時刻 / `today`: `YYYY-MM-DD`
  - `inbox_files`: `[{path}]`（step 1 で `ls` した全件・README 除く）。**主流路は `path` のみ・`content` は省略可**（workflow 側の subagent が Read tool で本文を取る）。
  - `open_tasks`: `[{path, title}]`（step 1 で収集した既存タスクノートの一覧。taskDoneExtract subagent が done 候補検出のために突き合わせる素材。**drain では必須**）
  - `obsidian_available`: `pgrep -x Obsidian` の真偽（boolean）。

workflow は inbox ごとに reportExtract（作業レポート・事実）と taskDoneExtract（タスク + done 検出）の 2 並列で fan-out する（Phase 4 で 3 並列から縮小）。気づき抽出・洞察検出は workflow からは呼ばれず、skill 本体側 step 4 が担う。

### 3. workflow 戻り解釈

workflow は `{candidates, link_rewrites, done_candidates, duplicate_detected, totals, flags, per_part_metrics}` を返す（schema は script 冒頭を参照）。

- `candidates` には **作業レポート・事実 と タスク**（および workflow 側で命名ゲート済み）のみ含まれる。気づき・洞察は含まれない（skill 本体側 step 4 で生成・追加）。
- `totals.kizuki` / `totals.insights` は 0（workflow に流れないため）。skill 本体側 step 4 で実数を別管理する。
- `totals` は script 計算。`candidates.length` との一致を一瞥確認する（不一致は script 改変事故なので報告して停止）。
- `flags.report_extraction_failed` / `flags.task_done_extraction_failed` / `flags.report_referrers_skipped` に入った inbox ファイルは「未処理」と明示し、archive 退避の対象から外す（合算と hold 判定の正本は 4.7 step 4）。**気づき抽出は skill 本体側で別途扱う**ので、workflow 側のこの flag は LLM Wiki / タスク done パートの失敗だけを示す。`report_referrers_skipped` は rex 成功で `referrers_scanned === false` の inbox（R3-11 で `report_extraction_failed` から分離・rename を伴う昇格のみ次回 drain に持ち越し）。
- 各 candidate の `gate`（命名ゲートのログ）と `validation_errors` はトリアージ提示に添える。
- `duplicate_detected` は done 候補と task_promotions が同じ `inbox_origin` から両方出た組（taskDoneExtract subagent の order 強制 + 排他指示のフェイルセーフ。0 件が望ましいが非空なら step 5 で両方提示し人に解消を委ねる）。Phase 3 narrow 後の母集団は task_promotions ↔ done_candidates の 2 系統交差のみ。
- `link_rewrites` は reportExtract が返した old_name_referrers（Phase 4 で drainExtract 廃止後は reportExtract が唯一の referrers 供給源）。

### 4. 気づき・洞察パート駆動（skill 本体側・self-check 命名ゲート）

気づき抽出と洞察検出を skill 本体から Agent tool で spawn する。命名品質は抽出 prompt 内の self-check（反証点検・全候補 × 全基準・fail は逐語 evidence 必須）が生成段で担い、skill 本体は self_check artifact の shape をコードで検査する。再命名の agent 往復は行わない（2026-07-05 β3 実験の実測で checker/renamer ラウンドを置換。作業レポート: notes/『drain 命名 self-check β3 実験レポート（2026-07-05）』昇格分）。

#### 4.1 気づき抽出 agent の並列 spawn

inbox 件数分だけ `Agent` tool を **同一 turn 内で並列**に spawn する。各 agent の `subagent_type="drain-extractor"`・**モデル sonnet（spawn 時に `model: "sonnet"` を明示する**——agent 定義 frontmatter も sonnet だが、パート表の「気づき抽出 = sonnet」を spawn 側でも固定する二重防御。inherit に頼ると main のモデルで走ってコストが跳ねた実測がある: 2026-07-06）。name は不要（SendMessage の宛先として使う後段が無い）。

各 kizuki-extract-N agent への prompt template は **`~/.claude/skills/drain/references/prompts/kizuki-extract.md` を Read** して取得する（逐語転記の管理点）。prompt には agent の責務限定・derivation の 4 サブフィールド要件（`source_observations` / `pattern_generalization` / `lesson_axis` / `generalization_check`）・title_candidates の shape 指示（3 案・先頭が推奨案）・**self-check 手順（判断基準 7 項目の逐語・反証点検・fail 最少を先頭に）**・MCP 経路の使い方・命名訂正事例集の参照が含まれる。

`<VAULT>` `<inbox file path>` `<N>` `<NOW>` `<TODAY>` プレースホルダは spawn 時に値を埋める。各 inbox 1 件につき 1 agent を spawn する。

**title_candidates の shape（正本）**: `[{abstraction: ('具体寄り'|'中間'|'一般化'), form?: ('事実形'|'観点形'), title}]`。気づきは 3 案固定（form 無し）・洞察は 3〜4 案（観点形・事実形 各 1 案以上・form 必須）で、先頭要素が常に推奨案（推奨案の決定規則: self-check の反証点検で fail 最少の案。同数時の tie-break は各 prompt に明記）。SKILL 内部の検査・説明系（4.2〜4.5・step 5）は本定義を正本として参照し、再掲は差分のみに畳む。agent-facing prompt 内の shape 記載は自己完結が必要なので再掲のまま残す。`c.title` は agent 返り値の複製でなく **skill 本体が `title_candidates[0].title` から導出する**（agent 返り値は title_candidates を正とし、title フィールドの複製整合を要求しない。不変条件 c.title＝title_candidates 先頭同値はこの導出で維持される）。構造違反は「title_candidates が array でない・要素に title が無い・空」に限定し、案数の仕様差・`abstraction` / `form` ラベルの欠落は構造違反にせず gate.log に記録してラベル無しで扱う。

**self_check の shape（正本）**: 各候補は `self_check: [{candidate: <title_candidates の index 1..N>, results: [{criterion: ('①'..'⑦'), verdict: ('pass'|'fail'), evidence}]}]`・`self_verdict: ('該当'|'非該当')`（推奨案＝先頭に fail が残るか）・`self_violations: [{criterion, quote, note}]`（推奨案に残った fail・無ければ空配列）を持つ。shape 検査は次を機械確認する: self_check が title_candidates 全件をカバーする／各案の results が基準 7 項目を網羅する／verdict=fail の entry に非空 evidence がある／self_verdict が値域内／self_violations が array。点検の実施自体をここで観測可能にする（「チェックをやったフリ」の検出）——点検の質の判定は人ゲートの領分でここではしない。違反時の失敗 wire は 4.5「失敗判定の具体条件」に合流する。

**spawn 後の戻り検査と失敗 wire (R2-13 同型)**: 各 kizuki-extract-N agent の戻りを受け取った直後に step 4.5 「失敗判定の具体条件」に従って検査する。Agent tool 起動が exception / null / undefined / タイムアウトのいずれかなら該当 inbox path を `kizuki_extraction_failures` Set に push する（この wire 漏れがあると未処理 inbox が step 6 で archive 退避され消える）。返り値 shape が壊れていれば `kizuki_extract_malformed` Set に push する。失敗 / malformed の inbox の候補は `candidates` に積まず triage に「気づき抽出失敗のため未処理」として明示する。

#### 4.2 命名ゲートを回す（self-check 版）

各 kizuki-extract-N agent が返した `kizuki_promotions` の各候補について、以下を実施する（すべて skill 本体の決定論手続き・agent への差し戻しは無い）:

1. **self_check の shape 検査**: 4.1「self_check の shape（正本）」の機械確認を行う。1 つでも違反すれば該当 inbox を `kizuki_extract_malformed` に積む（4.5 の必須 field 検査と同じ inbox 単位 drop・partial recovery しない）。
2. **regex 検査** (機械ゲート・title_candidates 全件・正規表現 `/、|すると|したら|つつ|（|\(/`): **非先頭候補**の hit は提示からの除外と gate.log 記録のみ（残るのは常に先頭を含む列なので、この除外だけで全滅は構成されない）。除外を記録する gate.log には**除外候補の元 index を書く**（`self_check[].candidate` は除外前の並び基準なので、除外で列が詰まると対応が取れなくなる——log の対応表で監査可能性を保つ）。**先頭（推奨案）**の hit は除外・繰り上げをせず、`gate.machine_hits` にマッチした表層シグナル（`、` `すると` `したら` `つつ` `（` `(` のうち実際にマッチしたもの・space 区切り・重複は集約）を記録してトリアージ提示の注記に回す。再命名ラウンドは起動しない（β3 実測で生成段の反証点検が表層違反を潰すこと（machine_hits 0/10）を確認済み。hit が残っても人が見て直せる）。
3. **self_verdict の転記**: 候補の `self_verdict` / `self_violations` を gate に転記する。`self_verdict=該当`（agent が自分の推奨案に fail が残ると申告した候補）は `self_flagged` を ++ し、トリアージ提示で self_violations（基準・逐語 quote）を注記する——黙って通さない・黙って落とさない。

各候補に `gate = { title_candidates, machine_hits, self_verdict, self_violations, selected_title, log }` を残し、トリアージ提示に使う。`c.title = title_candidates[0].title` の導出は 4.1 のとおり（in-gate の再命名が無いため title はゲートで変化しない）。`title_candidates` は regex 除外適用済みの全候補（トリアージ提示用）。`selected_title` はトリアージで人が選んだ・または手入力した確定タイトル（step 5 の承認後に populate・推奨案を選んだ場合は `c.title` と同値）。`log` は非先頭除外・ラベル欠落などの機械処理記録。

#### 4.3 洞察検出 agent の spawn

気づき抽出と命名ゲートが全 inbox 分終わった後、洞察検出 agent を **1 つ spawn** する。

- `Agent` tool で spawn・`subagent_type="drain-extractor"`・モデル opus (spawn 時に model overwrite)。name は不要。
- 入力素材: workflow 戻りの reports の candidates（**タスクは除外**——層が違う。prompt 本体の「タスクは素材に含めない」・workflow backfill 経路の `kind !== 'タスク'` 機械除外と一致させる）と、skill 本体側で生成した kizuki_promotions の合算リスト（path + gist=source_excerpt 直結・各 200 字までで truncate）を `newNotesList` として組み立てる。`extraMaterial` には skill 本体側で集めた近傍の参考情報があれば添える（drain では空でよい）。
- **spawn 後の戻り検査と失敗 wire (R2-13 同型)**: 戻りを受け取った直後に step 4.5「失敗判定の具体条件」に従って検査する。Agent tool 起動が exception / null / undefined / `insights` field が array でない / 各 insight の必須 field 欠落 / `title_candidates` の構造違反（判定と限定条件は 4.1「title_candidates の shape（正本）」に従う・詳細は 4.5） / `derivation` の 3 サブフィールド欠落 のいずれかなら `insight_detect_failed = true` をセットする（この wire 漏れがあると insight 検出失敗が観測されないまま triage に「洞察 0 件」と提示される）。失敗時は insights を `[]` 扱いで 4.4 を skip し、triage に「洞察検出失敗のため未実施」と明示する。

prompt template と drain 固有の追加指示は **`~/.claude/skills/drain/references/prompts/insight-detect.md` を Read** して取得する（workflow `harvest-pipeline.js` の `insightPrompt` 本文の逐語転記＋drain 固有の追加指示。drain mode 用に backfillFocus 節は省略済み）。`<VAULT>` `<newNotesList>` `<extraMaterial>` `<NOW>` `<TODAY>` プレースホルダは spawn 時に値を埋める。drain 固有の追加指示（title_candidates 3〜4 案・form 必須・**self-check 手順＝洞察用判断基準 7 項目の逐語と反証点検**）は spawn 時に prompt の末尾へ足す。差分管理は「workflow との interface」節を参照。

返り値 schema (構造化出力を Agent tool API でなく prose で要求する点に注意・shape は workflow `INSIGHT_SCHEMA` に drain 固有の `title_candidates` を加えた形):
```
{ insights: [{
    claim, connected_notes: [path], title, title_candidates, content, why_important, backlink_edits: [{path, add_line, where_hint}],
    derivation: { source_avoidances: [string], common_point, common_axis },
    self_check, self_verdict, self_violations
}] }
```

`title_candidates` の shape（洞察差分を含む）は 4.1「title_candidates の shape（正本）」に従う。先頭要素が推奨案。`c.title` は skill 本体が先頭要素から導出する（外側 `title` フィールドとの一致は要求しない）。

0 件が正当（繋がりが弱い場合）。

**derivation_ok の skill 本体側機械算出 (workflow drain 経路移管前は workflow が算出していた値・移管後は skill 本体が同等の算出を担う)**: agent 戻りの各 insight に対し、`derivation_ok` を以下で算出する (agent 自己申告に依存しない):

```
i.derivation_ok =
  Array.isArray(i.derivation && i.derivation.source_avoidances) &&
  i.derivation.source_avoidances.filter((s) => s && s.trim()).length >= 2 &&
  !!(i.derivation && i.derivation.common_point && i.derivation.common_point.trim()) &&
  !!(i.derivation && i.derivation.common_axis && i.derivation.common_axis.trim())
```

`derivation_ok: false` の洞察候補は triage 提示で明示する (step 5 の規約)。`per_part_metrics.kizuki_insight.insight_derivation_ok` の populate もこの値の集計から行う (step 7)。

#### 4.4 洞察候補の命名ゲート（self-check 版）

`insight-detect` agent が返した `insights` の各候補について 4.2 と同じ 3 手順（self_check shape 検査 → regex 検査 → self_verdict 転記）を回す。違いは:

- self-check の判断基準は洞察用 7 項目（判断軸を名指す・失敗形不可 等。逐語は `references/prompts/insight-detect.md` 内の drain 固有追加指示——workflow `insightCriteria` との keep-in-sync 対象）。反証点検の突き合わせ先は `derivation.common_axis`（空のときのみ claim に退避）。
- shape 検査違反は inbox 単位でなく `insight_detect_failed` に倒す（4.5 の既存規則に合流・insight-detect は 1 spawn のため）。
- title_candidates は 3〜4 案・form 必須（4.1 の shape 正本の洞察差分）。
- **rename swap (洞察固有の追加対象・R2-4)**: 洞察固有の swap 対象 (`source:` リスト・`connected_notes[*]` path 境界一致) は **本節 4.7 step 1 に集約・本節を参照**（重複箇所は本節 4.7 を正本とする）。

各洞察候補に 4.2 と同じ `gate = { title_candidates, machine_hits, self_verdict, self_violations, selected_title, log }` 構造を残す（各フィールドの意味は 4.2 末尾の定義と同一）。

#### 4.5 並列度と reentrancy の観測 + 失敗追跡

##### 並列度

- 気づき抽出 agent の並列 spawn は同一 assistant turn 内に Agent tool 呼び出しを並べる。inbox ≤ 30 件で運用するため並列度は実用上問題にならない（SendMessage 往復は廃止済みのため reentrancy 制約は消滅）。

##### 失敗追跡 (skill 本体側で耐久に持つ)

workflow 側 `flags.report_extraction_failed` / `flags.task_done_extraction_failed` と対称な失敗追跡を skill 本体側でも持つ。理由: 気づき抽出・洞察検出は workflow に流れないため workflow flags には乗らない。失敗を記録しないまま archive 退避すると未処理 inbox を消してしまう。

**skill 本体側の in-memory 記録 (1 cycle 内のみ保持・運用ログ書き出しと step 6 archive 退避保護で消費する)**:

- `kizuki_extraction_failures: Set<inbox_path>` — kizuki-extract agent spawn が失敗した inbox path の集合
- `kizuki_extract_malformed: Set<inbox_path>` — spawn は成功したが返り値 shape が不正だった inbox path の集合
- `insight_detect_failed: boolean` — insight-detect agent spawn が失敗したかの真偽
- `self_flagged: number` — self_verdict=該当 のまま提示した候補件数 (self-check の自己申告が機能しているかの観測・4.2/4.4 の転記時に ++)
- `title_choice_non_primary: number` — トリアージで人が推奨案 (title_candidates 先頭) 以外の候補を選んだ件数 (複数候補が効いているかの観測・step 5 で ++)
- `title_human_edits: number` — トリアージで人が候補外のタイトルを手入力した件数 (4 択②・step 5 で ++)
- `axis_human_edits: number` — トリアージで人が軸を手修正した件数 (4 択③・step 5 で ++)

`title_human_edits` / `axis_human_edits` は checker 撤去の rollback 判断材料（人の手入力訂正率が跳ねたら単発チェック復帰を検討する。閾値は観測後に決定——v1 では記録まで）。

**初期化 (step 4 開始時に必須・R3-12)**: 上 7 つは step 4.1 spawn 直前に明示初期化する (`kizuki_extraction_failures = new Set()` / `kizuki_extract_malformed = new Set()` / `insight_detect_failed = false` / `self_flagged = 0` / `title_choice_non_primary = 0` / `title_human_edits = 0` / `axis_human_edits = 0`)。初期化を忘れると `undefined + 1` で NaN (JSON.stringify で null) / `undefined.size` で TypeError の経路に化けて本質指標が silent に欠損する。

**失敗判定の具体条件**:

- **`kizuki_extraction_failures`**: Agent tool 起動が exception で返った / 戻り値が null|undefined / Agent tool タイムアウト。
- **`kizuki_extract_malformed`**: Claude Code の Agent tool は workflow agent() ヘルパと異なり structured output schema パラメータを持たない (kizuki-extract agent の戻りは prose 指示で shape を要求するのみ)。**skill 本体側で受け取った戻りに対し、必須 field の存在と値域を Read 後に確認する**: `kizuki_promotions` field が array であること・各候補の必須 field (`kind` `title_candidates` `content` `fold_into` `source_excerpt` `why_important` `backlink_edits` `inbox_origin` `derivation`) が揃っていること（`title` は必須 field にしない——skill 本体が `c.title = title_candidates[0].title` を導出する）・**`title_candidates` に構造違反が無いこと**（判定と限定条件は 4.1「title_candidates の shape（正本）」に従う）・**`kind === '気づき'` の厳密一致**（kizuki-extract agent は `kind: '気づき'` 以外を返してはならない・別 kind 混入は step 4.6 統合で workflow 産 task_promotions と層混合してトリアージ二重提示の経路になる・R2-14）・`derivation` の 4 サブフィールド (`source_observations` `pattern_generalization` `lesson_axis` `generalization_check`) が揃っていること・**self_check / self_verdict / self_violations の shape 検査**（4.1「self_check の shape（正本）」）を通ること。1 つでも違反すれば該当 inbox を `kizuki_extract_malformed` に積む (該当候補だけ捨てて他候補を救う partial recovery はしない——shape が壊れた agent からの他候補も信頼性が落ちるため)。違反 inbox の候補は `candidates` に積まない (`kizuki_extraction_failures` と同列に扱う)。
- **`insight_detect_failed`**: Agent tool 起動が exception で返った / 戻り値が null|undefined / `insights` field が array でない / 各 insight の必須 field (`claim` `connected_notes` `title_candidates` `content` `why_important` `backlink_edits` `derivation`) が揃っていない（`title` は必須 field にしない——skill 本体が title_candidates 先頭から導出する） / `title_candidates` の構造違反（判定と限定条件は 4.1 の shape 正本に従う） / `derivation` の 3 サブフィールドが揃っていない / **self_check / self_verdict / self_violations の shape 検査**（4.1 正本）に通らない。

**失敗合算と inbox 単位の hold 判定は本節 4.7 step 4 に集約・本節を参照**（重複箇所は本節 4.7 を正本とする）。`kizuki_extraction_failures` ∪ `kizuki_extract_malformed` ∪ workflow flags の和集合と insight_detect_failed の kind 別 drop ルール（本節 4.7 step 4 参照）を介して archive 退避保護と triage 文言が決まる。

**運用ログ書き出し (step 7 連携)**: 上の各値を `per_part_metrics.kizuki_insight` に転記する:

- `kizuki_spawn_failed`: `kizuki_extraction_failures.size`
- `kizuki_extract_malformed`: `kizuki_extract_malformed.size`
- `insight_detect_failed`: 真偽
- `self_flagged`: 累計件数（4.2/4.4 で確定）
- `title_choice_non_primary`: 累計件数（step 5 で確定）
- `title_human_edits`: 累計件数（step 5 で確定）
- `axis_human_edits`: 累計件数（step 5 で確定）

#### 4.6 統合

**気づき derivation_ok の skill 本体側機械算出 (Phase 4 で workflow drainExtract 廃止に伴い算出責務が skill 本体側に移管された)**: kizuki_promotions の各候補に対し、`derivation_ok` を以下で算出する (agent 自己申告に依存しない):

```
c.derivation_ok =
  Array.isArray(c.derivation && c.derivation.source_observations) &&
  c.derivation.source_observations.filter((s) => s && s.trim()).length >= 1 &&
  !!(c.derivation && c.derivation.pattern_generalization && c.derivation.pattern_generalization.trim()) &&
  !!(c.derivation && c.derivation.lesson_axis && c.derivation.lesson_axis.trim()) &&
  !!(c.derivation && c.derivation.generalization_check && c.derivation.generalization_check.trim())
```

`derivation_ok: false` の気づき候補は triage 提示で明示する (step 5 の規約・individual observations / 実装意図 / 事実記述を気づき層に上げない第 1 防御線)。`per_part_metrics.kizuki_insight.kizuki_derivation_ok` の populate もこの値の集計から行う (step 7)。洞察 derivation_ok は step 4.3 で agent 戻り直後に算出済み。

**cross-candidate rename swap (workflow ↔ skill 本体の双方向伝播・R2-5)**: 双方向 swap pairs の構築と全候補への適用（workflow swapRefs と同型の境界一致 / escape 規約を含む）は **本節 4.7 step 1 に集約・本節を参照**（重複箇所は本節 4.7 を正本とする）。本節 step 1 で全候補対象の swap pair 構築と適用が完了したものとして統合に進む。

**統合**: skill 本体は以下を合算してトリアージ用 candidate リストを作る:

- workflow 戻りの `candidates`（作業レポート・事実 + タスク・候補内 swap 済み）
- skill 本体側 kizuki_promotions（命名ゲート済み・derivation_ok 算出済み・候補内 swap 済み）
- skill 本体側 insights（命名ゲート済み・derivation_ok 算出済み・候補内 swap 済み）

統合リストへの **cross-candidate swap・規約検証・失敗合算 + hold 判定・Write 候補確定** は本節 4.6 ではなく次節 **4.7 整形・出力パート** で集約して回す（4.6 は a + b の合算と素材整理に留め、整形 5 ステップは 4.7 で一括）。連番 id 振り直しは 4.7 step 1 (cross-candidate swap) 完了後に行う（rename pair 構築には旧 gate を使うため id 振り直しは swap の後で問題ない）。

**4.6 → 4.7 handoff の責務境界**: 4.6 は「workflow 戻りの (a) candidates と skill 本体側 (b) kizuki_promotions / insights を 1 つの配列にまとめる素材整理のみ」を担当する。4.7 が引き受けるのは step 1 rename swap (cross-candidate swap + 連番 id 振り直し) / step 2 リンク張り替え (`backlink_edits` 統合 + `link_rewrites` 主流路 + basename matching 判定への参照) / step 3 規約検証 (kind 別検査の再走) / step 4 失敗合算 + hold 判定 (workflow flags ∪ skill 本体 failures の `holdInboxes` 確定 + `insight_detect_failed` の D-3 規則 + basename matching 規則) / step 5 Write + archive 退避決定（hold 通過分の `writeCandidates` / `archiveTargets` 確定）。step 6 (実 Write/Edit/mv) は 4.7 step 5 の決定結果を受けて実行する。

#### 4.7 整形・出力パート (5 ステップの集約点)

drain mode で発生する整形パートの責務（抽出結果との乖離を吸収して最終ノートとして保存する集約点）を 1 箇所に明示する。workflow 側の整形段（reportExtract / taskDoneExtract 直後の swapRefs / validateCandidate / fixAndRevalidate）は **a 中間処理**として稼働継続する（backfill mode で正本・drain mode では a 候補に対する事前処理）。本節は **a + b 全候補が揃った合流点**で 5 ステップを再走らせる集約点で、drain mode では本節が**正本**。物理配置は skill 本体側に固定し、執行モデルは**ハイブリッド**（決定論的処理を prose で記述し sonnet が候補ごとに 1 候補ずつ走らせる・workflow JS は a 中間処理に役割限定）。

5 ステップ（本節で 1 箇所に集約）:

1. **rename swap**: 全候補（workflow 戻り a + skill 本体側 b）の暫定 → 確定 title 置換（wikilink / path / backlink_edits / connected_notes / source 各系統）
2. **リンク張り替え**: 既存ノートへの `backlink_edits`（workflow `link_rewrites` を含む）＋ 同バッチ新規ノートへの `source` / `connected_notes` 連鎖
3. **規約検証**: workflow `validateCandidate` / `fixAndRevalidate` と同型の検査を a + b 全候補に対して再度実行（kind 別 frontmatter / 更新履歴 / ラベル残存 / tags 整合 / 洞察 source 必須 / タスク progress 必須・チェックボックス禁止）
4. **失敗合算 + hold 判定**: workflow flags ∪ skill 本体 failures の和集合 `holdInboxes` を確定。inbox 単位の hold 判定
5. **Write + archive 退避**: hold 通過分のみ確定書き込み + 原本退避（本節 step 5 は決定だけ・実 Write/mv は step 6 が担う）

##### 4.7 step 1 — rename swap (候補内 swap + cross-candidate swap)

気づき・洞察側（b 側）は in-gate の再命名を持たないため、ゲート段での swap は発生しない（人が推奨案以外を選ぶ・手入力する差分は本節末尾「選択タイトルの差し替え swap」が吸収する。b 側候補同士の cross-reference は生成時から確定タイトル＝title_candidates 先頭で書かれる）。統合（4.6）で a + b 揃った合流点では、workflow 側（a 側）の rename を全候補へ伝播する **cross-candidate swap** を適用する。これにより同一 inbox 内 cross-reference の dangling を消す（R3-9 / R3-14 を構造で解消）。

**swap pair の構築**: workflow 戻り `candidates`（reports + tasks）から `c.gate && c.gate.initial_title && c.gate.initial_title !== c.title` を満たす候補を `{from: gate.initial_title, to: c.title}` で抽出する（skill 本体側 kizuki_promotions / insights は in-gate rename を持たないため pair の供給源にならない）。

統合した rename pairs を全候補（workflow 戻り + skill 本体側 kizuki + skill 本体側 insights）に冪等適用する（自候補分の再適用は無害）。

**置換規則 (workflow swapRefs L991-999 を skill 本体側で逐語転記)**:

各候補 `c` の `c.content` / `c.backlink_edits[*].add_line` / `c.backlink_edits[*].path` / `c.connected_notes[*]`（insights 限定・存在時）に対し、各 rename pair `(from, to)` を以下のルールで適用（**R3-2**: 旧 4.6 にあった `s.derivation.source[*]` への置換は schema (`derivation: { source_avoidances, common_point, common_axis }`) に該当 field が無く no-op だったため 4.7 集約時に削除）:

1. **wikilink の置換 (本文・source frontmatter・add_line)**: `[[from]]` を `[[to]]` に文字列分割 join 形式で置換

   ```
   s = s.split('[[' + from + ']]').join('[[' + to + ']]')
   ```

   frontmatter title の自己参照と本文 `[[old]]` 自己参照の両方を 1 回で処理する。

2. **ファイルパスの境界一致置換 (backlink_edits.path・connected_notes)**: from の直前が path 先頭 (`^`) または path separator (`/`) の場合のみ置換する（境界一致しない `notes/古いメタ.md` も誤マッチして `notes/古い<to>.md` に書き換わるのを防ぐ）。

   **escapeRegex (workflow L981 を逐語転記・R3-10)**:

   ```
   const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
   ```

   **境界一致 RegExp (workflow L988 を逐語転記)**:

   ```
   const pathRegex = new RegExp('(^|/)' + escapeRegex(from) + '\\.md', 'g')
   ```

   **`to` の `$` escape (workflow L989 を逐語転記・R2-1 / R3-10)**: `to` を `String.prototype.replace` の第 2 引数に渡す場合、`to` に `$&` `$$` `$1`〜`$9` が含まれると template 解釈されて誤書換になるため、`$` を `$$` に置換してから replace template に埋め込む（`$1` capture-group reference は意図的なので保持）。

   ```
   const pathTo = '$1' + to.replace(/\$/g, '$$$$') + '.md'
   s = s.replace(pathRegex, pathTo)
   ```

**swap 後の整合**: cross-candidate swap が完了した時点で、全候補の `c.title` の最終値は確定しており、wikilink / path 系統の旧タイトル参照は全て最終タイトルへ反映される。**連番 id 振り直しは cross-candidate swap 完了後に行う**（rename pair 構築には旧 gate を使うため順序は問題ない）。

**選択タイトルの差し替え swap（トリアージ後・step 6 の実 Write 前）**: 本節の主 swap はトリアージ前に走るため、人が推奨案以外を選んだ・手入力した場合の差分は追加 pair で吸収する。承認後・step 6 の実 Write 前に、`gate.selected_title` が確定し `selected_title !== c.title` の item について追加 pair `{from: c.title, to: selected_title}` を構築し、本節と同じ置換規則（wikilink 分割 join・path 境界一致・escapeRegex・`to` の `$` escape）で次の 3 系統に冪等適用する: (1) `writeCandidates` 全体、(2) **step 2 / 2.1 で事前計算した既存ノート編集 Map の content**（frontmatter `related:` 追記の `[[c.title]]` が対象——wikilink 置換規則で）、(3) **`link_rewrites` Map の new_target**（path 境界一致置換で）。(2)(3) への適用が漏れると、推奨案以外を選んだ item の既存ノート側に dangling wikilink（旧タイトル＝推奨案への参照）が残る。`c.title` 自体は書き換えない（gate.log・self_check との対応を事後改変しない）。これは 2026-06-29（drain 23 回目）で本体が手動で行った「人ゲート rename 後の cross-candidate 整合を最初から新名で書く」運用の規則化であり、新規メカニズムではない。

##### 4.7 step 2 — リンク張り替え

step 1 で確定した最終タイトルを前提に、**既存ノートへの逆リンク** と **同バッチ新規ノートへの連鎖** を統合する。

- **既存ノート への張り替え (workflow `link_rewrites` を含む)**: workflow 戻りの `link_rewrites`（reportExtract が返した old_name_referrers ベース。Phase 4 で drainExtract 廃止後は reportExtract が唯一の referrers 供給源）を主流路として張り替える。inbox 名が変わる/分割される昇格の被リンク元で、元 inbox 名への wikilink を昇格先（複数分割なら主たる行き先）へ張り替える。
- **同バッチ新規ノートの逆リンク (`backlink_edits`)**: workflow / skill 本体側双方の候補が持つ `backlink_edits` を合算し、既存ノート側へ追記する Set を作る。step 1 の rename swap 適用済みなので、`add_line` 内の `[[X]]` は最終タイトルになっている。**新規分の `backlink_edits` は frontmatter `related:` への merge として扱う**（後述・本文 `## 関連` セクションへの追記は廃止された旧方式で、新規分には適用しない）。
- **同バッチ新規ノート間の連鎖 (`source` / `connected_notes`)**: skill 本体側 insights の `source:` リスト・`connected_notes[*]` に列挙された同バッチ新規気づき/洞察への参照は、step 1 の cross-candidate swap で最終タイトル/最終 path に置換済み。step 2 で改めて触らない（step 1 で確定する規律）。
- **`reportExtract` 失敗時の張り替え保護**: `flags.report_extraction_failed` ∪ `flags.report_referrers_skipped` に乗った inbox は `link_rewrites` が空（referrers が機械的に洗えていない）。basename matching の判定（rename を伴う昇格は持ち越し・同名 1:1 は採用可）は step 4 で行う・本節 step 2 は step 4 の判定結果に従う。

##### 4.7 step 2.1 — frontmatter `related:` への冪等 merge（新方式）

新規分の `backlink_edits`（`where_hint === 'frontmatter related:'`）は、既存ノートの frontmatter `related:` list に新規 wikilink を冪等 merge する形で適用する。`add_line` は yaml list の 1 要素（`- "[[<新規ノートタイトル>]]"`）で来る前提。集約点で次の手順を回す:

1. **対象 path の frontmatter を Read**: `backlink_edits[].path` の既存ノートを Read し、frontmatter（`^---\n([\s\S]*?)\n---`）を抽出する。frontmatter が無い既存ノート（旧形式の手書きノート等）は新規に frontmatter を生成しない・skip して `validation_errors` へ「frontmatter 不在の追記対象」と記録する（既存ノートの skeleton を勝手に作らない・人ゲートに委ねる）。
2. **既存 `related:` list の抽出**: frontmatter から `related:` キーを探す。`related:` の取り得る yaml 形式は以下:
   - **block list 形式** (主流路): `related:\n  - "[[X]]"\n  - "[[Y]]"`（複数行・2 スペースインデント + `- ` + ダブルクオート囲み wikilink）
   - **inline list 形式**: `related: ["[[X]]", "[[Y]]"]` または `related: [[[X]], [[Y]]]`（1 行 yaml inline・実機では稀だが既存運用に存在するなら受容）
   - **空 value**: `related:`（key だけで value 無し・list 未生成）
   - **key 不在**: `related:` キー自体が無い

   抽出は yaml parser を使わず文字列処理で行う（drain は外部依存を増やさない方針・block list 形式が主流路で揺れは少ない）。block list 形式は `related:` 直後の継続行（インデント `  - ` で始まる行）を読み、wikilink 部分（`[[X]]` の `X` 部分）を Set に積む。inline 形式は `related: \[(.+?)\]` で 1 行から `[[X]]`, `[[Y]]` を split で取る。
3. **新規 wikilink との merge（冪等性）**: `add_line` の `- "[[<新規タイトル>]]"` から `<新規タイトル>` を抽出し、既存 list の wikilink 集合に含まれているかチェック。
   - **既に含まれている場合**: 追加しない・`updatedAt` も打ち直さない（再実行で vault が動かない＝冪等）。
   - **含まれていない場合**: 既存 list の形式を保ったまま 1 要素追加する（**block list なら継続行を 1 行 append・inline なら配列末尾に 1 要素 append**）。既存が inline 形式のものを block list 形式に書き直さない——既存運用が inline を選んでいる意図を消さない・冪等 merge の規律（追加 wikilink が無いなら content 差分ゼロ）を style 統一の都合で壊さないため。同じ path に複数の `add_line` が積まれている場合は Set 重複排除した上でまとめて 1 回追記する（同一実行で同じ wikilink を 2 回追加しない）。
4. **`related:` キーが無い場合の新規生成**: frontmatter は存在するが `related:` キーが無い場合、新規に block list 形式（`related:\n  - "[[<新規タイトル>]]"`）で frontmatter 末尾（`updatedAt:` の直前など適切な位置）に追加する。key 順は他キーとの整合（`status:` / `progress:` 等の隣接が自然な位置）を見て判断する。既存 style が無い（key 不在）ケースなので block list が新方式の主流路として採れる。
5. **`updatedAt` の打ち直し**: list に新規要素を 1 件以上追加した場合のみ、frontmatter `updatedAt` を実行時刻 ISO-T（`YYYY-MM-DDTHH:mm` 形式・drain 開始時の `<NOW>`）で打ち直す。冪等パスでは打ち直さない（更新内容が無いのに `updatedAt` だけ進むと MOC の recency 索引が誤って並び替わる）。
6. **本文 `## 関連` セクションは触らない**: 旧方式（本文 `## 関連` セクションへの追記）は新規分には適用しない。過去ノートに残る `## 関連` セクションも本タスクでは遡及書き換えしない（新方式と共存・別 cycle）。

step 2 の出力: 既存ノート path → frontmatter 編集後の最終 content（または skip 判定）の Map と、`link_rewrites` の old_path → new_target の Map。実 Edit/Write は step 5 が決定し step 6 が実行する（本節 step 2 は決定だけ）。

##### 4.7 step 2.2 — fold 候補の本文 Read 最終確認

`reportExtract` agent は MCP `search_hybrid` の hits を `related_hits` field に並べて返すだけで本文 Read はしない（fold 判定は **MCP 戻りでなく本文で確証する**規律の集約点側担当）。集約段の純関数 `scoreRelatedness` が hits の 2 チャネル evidence を見て **fold 候補集合** `c.fold_candidates`（`c.related` の subset・kNN 窓内かつ BM25 相対値 `FOLD_BM25_REL=0.5` 以上・上限 `FOLD_MAX=2`）を機械判定する（v2 2026-07-06: 絶対値 cosine 閾値は裏取りで判別力なしと確定し廃止。related 認定は kNN 窓 ∪ BM25 相対 `BM25_REL_FLOOR=0.15` 以上・上限 `RELATED_MAX=6`・定数の正本は `harvest-pipeline-pure.js`）。fold の最終判定（実際に畳むか）は本節 step 2.2 で本文 Read による同一物確認に回す。

各 promotion 候補 `c` のうち `c.fold_candidates` が空でないものについて、`c.fold_candidates` の各 path（昇格候補と高類似度の既存ノート path）を Read し、別 context の sub-agent（model = sonnet）で同一物かを判定する:

- **同一物と判断**: `c.fold_into` を当該 path で確定する（昇格でなく既存ノートへ畳む）。fold 確定後は `c.content` を空文字に倒し（fold 時 content 不要）、`c.backlink_edits` を畳み先への追記 1 行に切り詰める（既に step 2 / step 2.1 で merge 済みのため、追加処理は要らない場合がある）。
- **別主題と判断**: fold せず新規昇格として進める（`c.fold_into` は空のまま）。`c.related` への frontmatter `related:` リンク追加は step 2.1 で既に完了している。

判断は **per fold_candidate** で独立に行う（複数の高類似度 hit が同一物候補として並んでいる場合、最初に同一物と判定したものに fold する）。`c.fold_candidates` が空の候補は本 step を skip する（fold する根拠が機械側に無い・1 段下の `c.related` 認定だけが残る）。

fold_candidates が空でないのに本 step で全て「別主題」と判定された場合、`c` は新規昇格のまま進む（純関数の閾値が緩く拾い過ぎたシグナル・観測対象として集計する）。

##### 4.7 step 3 — 規約検証 (validateCandidate / fixAndRevalidate と同型)

step 1 / step 2 で最終タイトル・最終リンク状態が確定した a + b 全候補に対して、workflow `validateCandidate` (L504-536) / `fixAndRevalidate` (L538-558) と同型の検査を **再度** 実行する。workflow 側 a 中間処理として L504-536 の検査は backfill mode で稼働継続するが、drain mode では本節 step 3 が a + b 全候補に対する**正本**として再度走らせる（二重実行コストは受容・集約点原則を崩さない側に倒す。R3-13 解消は「集約点で全候補対象」が要件）。

**検査項目 (workflow validateCandidate L504-536 と同型・kind 別分岐を enumerated に列挙)**: 出典は workflow.js の対応行を参照（workflow との keep-in-sync は R3-8 同性質で本 cycle Scope Out・正本ファイル化は別 cycle）。executor は本節を prose 単独で読んで kind 別検査を判定できる。

fold 候補（`c.fold_into` あり）の特例:

- `backlink_edits` が空でないこと（fold 指定なのに畳み先への追記が無いと違反・出典: workflow.js L507）。
- 以下の共通検査・kind 別検査は fold ではスキップ。

共通検査（fold でない全候補）:

- `c.content` の frontmatter (`^---\n([\s\S]*?)\n---`) が存在すること（出典: workflow.js L511）。
- frontmatter に `createdAt: <NOW>` と `updatedAt: <NOW>` が含まれること（NOW は drain 開始時の ISO-T・出典: workflow.js L515-516）。
- 本文に `## 更新履歴` が含まれること（出典: workflow.js L517）。
- 本文に `[[<TODAY>]]` の当日 wikilink が含まれること（TODAY は drain 開始時の `YYYY-MM-DD`・出典: workflow.js L518）。
- 本文 (frontmatter を除く) に H1 (`^# `) が無いこと（H2 から始める規約・出典: workflow.js L519）。

kind 別検査:

- **気づき (`c.kind === '気づき'`)**:
  - frontmatter tags に `気づき` が含まれること（出典: workflow.js L523）。
  - `derivation` 必須かつ 4 サブフィールド全充足: `source_observations` が non-empty array（≥1 件） / `pattern_generalization` が non-empty string / `lesson_axis` が non-empty string / `generalization_check` が non-empty string（skill 本体 4.6 `derivation_ok` 算出と同型・step 3 で再確認する）。

- **洞察 (`c.kind === '洞察'`)**:
  - frontmatter tags に `洞察` が含まれること（出典: workflow.js L525）。
  - frontmatter に `source:` フィールドが存在すること（リスト形式・2 件以上の元ノート列挙・出典: workflow.js L526）。
  - `derivation` 必須かつ 3 サブフィールド全充足: `source_avoidances` が non-empty string の配列で ≥2 件 / `common_point` が non-empty string / `common_axis` が non-empty string（skill 本体 4.3 `derivation_ok` 算出と同型・step 3 で再確認する）。

- **タスク (`c.kind === 'タスク'`)**:
  - frontmatter tags に `タスク` が含まれること（出典: workflow.js L529）。
  - `progress: backlog` が存在すること（progress の取り得る値は backlog / ready / doing / done の enum で、新規 promotion は backlog 固定・出典: workflow.js L530）。
  - 本文に `- [ ]` (チェックボックス) が含まれないこと（`## やること` は plain な箇条書きで持つ規約・出典: workflow.js L531）。
  - `c.label === '③'` のとき `why_important` が空でないこと（出典: workflow.js L532）。
  - `[①②③]` のラベル文字が残存していないこと（タスク限定の検査・全 kind に当てると作業レポートの正当な引用まで書き換わる理由は workflow.js L520-521 コメント参照・出典: workflow.js L522）。

- **作業レポート・事実 (`c.kind === '作業レポート・事実'`)**:
  - frontmatter の tags 範囲 (`tags:[\s\S]{0,200}?`) に `気づき` `洞察` が含まれないこと（事実・作業レポートに 気づき/洞察 タグが付くと層混入・出典: workflow.js L534）。

- **done (タスク既存ノートの `progress: done` 移行)**:
  - 対象は inbox 候補でなく既存タスクノートの progress 更新で、`progress: done` への移行と `source_inbox` の埋め込みが伴う（実適用は step 6 が担うため本節 step 3 の検査対象外・done 候補の triage 提示は step 5「トリアージ承認ゲート」が `quote_verified` を含めて行う）。

検査で違反が検出された場合、`fixAndRevalidate` 同型の修正ループを 1 回かける:

- 別 context の sub-agent（`subagent_type="drain-fix"`・model = sonnet）を spawn し、prompt template は **`~/.claude/skills/drain/references/prompts/fix.md` を Read** して取得する（workflow `fixAndRevalidate` 内本文の逐語転記）。`<errs.join(' / ')>` `<NOW>` `<TODAY>` `<c.content>` プレースホルダは spawn 時に埋める。
- 修正 sub-agent の戻り `r.content` を `c.content` に書き戻し、再度上記の検査を 1 回実行する。
- 再検査で残った違反は `c.validation_errors` に積み triage 提示で明示する（無理に解消しない・人に委ねる）。

**workflow との非対称性 (R-2)**: workflow 側 `validateCandidate` を変更したときは本節 step 3 の検査項目も同期する（手 keep-in-sync 関係を受け入れる cycle）。発覚契機は drain 実走の質指標悪化 + 運用ログ。

##### 4.7 step 4 — 失敗合算 + hold 判定 (inbox 単位)

drain mode で発生する失敗は 5 種類（workflow 側 2 + skill 本体側 3）あり、これを inbox 単位の hold 判定に合算する。

**失敗ソース**:

- workflow 側 (a 中間処理由来):
  - `flags.report_extraction_failed: string[]` — reportExtract agent 起動失敗の inbox path
  - `flags.task_done_extraction_failed: string[]` — taskDoneExtract agent 起動失敗の inbox path
  - `flags.report_referrers_skipped: string[]` — reportExtract は成功したが `referrers_scanned === false` で referrers 未走査の inbox path（R3-11 で分離。「extraction 失敗」と「referrers skip」を 1 軸に乗せていた混在計上を解消）
- skill 本体側 (b 由来・step 4.5 で耐久):
  - `kizuki_extraction_failures: Set<string>` — kizuki-extract agent spawn 失敗の inbox path
  - `kizuki_extract_malformed: Set<string>` — kizuki-extract 戻り shape 不正の inbox path
  - `insight_detect_failed: boolean` — insight-detect agent spawn 失敗の真偽

**hold 判定の構成 (Set 実装)**: `holdInboxes` は inbox path の Set。workflow flags の 3 系統と skill 本体側 failures 2 系統を 1 つの Set に合算する。

```
const holdInboxes = new Set([
  ...flags.report_extraction_failed,
  ...flags.task_done_extraction_failed,
  ...flags.report_referrers_skipped,
  ...kizuki_extraction_failures,
  ...kizuki_extract_malformed,
])
```

Set による dedup の意味は「同一 inbox path が複数 flag に登録されても 1 件として扱う」（例: 同 inbox で reportExtract と kizuki-extract の両方が失敗した場合）。順序保持は不要 (hold 判定は `holdInboxes.has(inbox_path)` の membership check のみで使う・archive 退避除外と triage 文言分岐の入力)。

**`insight_detect_failed` の扱い (D-3 規則本体・sub-option B 採用)**: `insight_detect_failed = true` のときは:

- 当該 insight 候補 (および同バッチ kizuki への参照を持つ insight 候補) を candidates から drop する。
- `per_part_metrics.kizuki_insight.insight_detect_failed` に `true` を転記する（真偽・4.5 / step 7 の型定義と同じ）。
- 他パート (reports / tasks / kizuki) は通常通り進める。
- `insight_detect_failed` は `holdInboxes` に **含めない**。

sub-option B 採用根拠: insight は 1 inbox の特定パートに紐づかず全 inbox 横断の 1 候補集合として生成され、新規ノート Write 自体が drop 可能で他パートの partial-commit を直接生まない。kizuki 失敗時 (kizuki_extraction_failures / kizuki_extract_malformed は inbox 単位で hold する) と非対称なのは「inbox 単位に紐づく失敗」と「全 inbox 横断の集合 1 つの失敗」で構造が違うため。triage には「洞察検出失敗のため未実施」と明示する (insights 候補を `[]` 扱い)。

**`report_referrers_skipped` 由来 inbox の basename matching ルール (集約点)**: `flags.report_referrers_skipped` に乗った inbox から出た昇格候補は、`link_rewrites` が空のため referrers が洗えていない状態にある。この inbox 由来の候補は basename matching で採否を分ける:

- 採用可: 候補 `c` の `c.title` が inbox basename と一致する（`c.title === inbox_basename` ・rename を伴わない同名 1:1 昇格）。
- 持ち越し: `c.title !== inbox_basename`（rename を伴う昇格・referrers の張り替えが必要だが対象不明のため hold）。

`inbox_basename` の計算式: `c.inbox_origin` (絶対 path) を `path.basename` で末尾要素にし、`.md` 拡張子を除去した文字列（例: `~/.../inbox/メモ.md` → `メモ`）。本ルールは本節 step 4 が正本で、本節 4.7 step 2（リンク張り替え）・step 5（Write + archive 退避決定）はこの判定結果に従う。

**境界ケース (R-3)**: 「insight-detect 失敗 + 同 inbox の他パート失敗あり」は本節 step 1 の cross-candidate swap で押さえる（insight 候補が drop された後に他パートが進む際の `[[名前]]` 残存は step 1 で全候補対象に swap 適用するため発生しない）。

**hold 後の triage 明示**: `holdInboxes` に含まれる inbox path は triage 提示で次の文言を分けて出す:

- `report_extraction_failed` / `task_done_extraction_failed` のいずれかに含まれる inbox: 「作業レポート/タスク・done 抽出失敗のため未処理」
- `report_referrers_skipped` に含まれる inbox: 「reportExtract 失敗のため referrers 不明・rename を伴う昇格は次回 drain で再処理」（inbox basename と同名 1:1 の rename なし昇格は採用可）
- `kizuki_extraction_failures` / `kizuki_extract_malformed` のいずれかに含まれる inbox: 「気づき抽出失敗のため未処理」

##### 4.7 step 5 — Write + archive 退避 (決定だけ)

step 4 で確定した `holdInboxes` 通過分のみ確定書き込み + 原本退避を **決定** する。本節 step 5 は決定だけを担い、実 Write/mv は既存 step 6（承認後の適用と archive 退避）が実行する形に倒す（処理境界の明確化）。

**Write 候補の確定**:

- 統合 candidate リストから、`inbox_origin ∈ holdInboxes` の候補を **次回 drain への持ち越し** に倒す（triage 提示に「hold」と明示・承認対象から外す）。
- ただし `inbox_origin ∈ flags.report_referrers_skipped` の候補は basename matching の判定結果に従う（採否規則は step 4 が正本・本節は判定結果を消費するのみ）。
- ID 振り直し済み (step 1 の cross-candidate swap 完了後の振り直し) の連番 id をそのまま triage 提示の per-item ID として使う。

**archive 退避対象の確定**:

- 全 inbox path から `holdInboxes` を除いた集合が archive 退避対象。
- step 6 で archive 退避を実行する直前に **スナップショット照合** を再度 (step 1 のスナップショットとの集合差分) 行うが、その時点で「未処理 (hold)」の inbox は除外対象として保持する。

**step 5 → step 6 の引き渡し**:

- `writeCandidates: candidates[]` — 承認後に Write される候補（hold 除外済み）
- `archiveTargets: string[]` — 承認後に `archive/inbox/` へ mv される inbox path
- `holdInboxes: Set<string>` — 次回 drain に持ち越す inbox path（triage に明示・archive 退避から除外）
- 既存ノート編集 Map — step 2 / 2.1 の出力（既存ノート path → frontmatter 編集後の最終 content または skip 判定）。差し替え swap の適用対象（4.7 step 1 参照）
- `link_rewrites` Map — old_path → new_target（step 2 の出力）。同じく差し替え swap の適用対象

実 Edit/Write/mv は step 6 が担う。本節 step 5 で `validation_errors` が残っている候補も triage 提示の per-item に明示する（hold とは別軸——validation_errors は採否を人に委ねる残課題）。

### 5. トリアージ承認ゲート（軸先出し・複数候補）

統合した candidate 全件を**本文で per-item 列挙**する。**作業レポート・タスク item は従来形式のまま**: `{種別／タイトル（再命名があれば 元→最終）／昇格元 inbox／fold 先 or 新規／逆リンク先／ゲート・検証の残課題}`（軸を持たないため形式を変えない）。

**気づき・洞察 item は軸を先頭に置き、タイトル候補を番号付きで並べる**——lesson_axis / common_axis が主承認対象で、タイトルは軸から導いた候補からの選択:

```
- **ID n**（気づき）軸: <lesson_axis 逐語>
  候補: ① <title>（<abstraction>） ② <title>（<abstraction>） ③ <title>（<abstraction>）（推奨 ①）
  導出: <source_observations 抜粋 / pattern_generalization / generalization_check>
```

- 洞察は `軸:` に `derivation.common_axis` の逐語、`候補:` に form ラベル（観点形/事実形）と抽象度を添えた 3〜4 案、`導出:` に `source_avoidances` ／ `common_point` を添える。
- 候補番号は `gate.title_candidates` の並び順（regex 除外適用済み）で振り、各候補に abstraction（洞察は加えて form）のラベルを添える。**先頭が常に推奨案**（推奨=①=先頭）なので表示は（推奨 ①）になる。抽象度の固定順（一般化→中間→具体寄り）に並べ直さない——番号は並び順のまま。ラベルが欠落した候補は gate.log に記録済みのままラベル無しで提示する。候補タイトルは全て抽出 agent 産——本体が候補を生成・削減しない（厳守プロトコル参照）。
- 昇格元 inbox／fold 先 or 新規／逆リンク先／ゲート・検証の残課題は従来どおり各 item に添える。
- **self-check の結果を注記する**: `self_verdict=該当` の item は self_violations（基準・逐語 quote）を、`gate.machine_hits` が非空の item は「機械ゲート hit: <シグナル>」を、各 item に添える（残課題の明示——黙って通さない）。
- 軸（lesson_axis / common_axis）はタイトルの導出元かつ成立判断の材料なので、**これを出さずに気づき・洞察候補を採否にかけない**。`derivation_ok: false`（チェックリスト未充足）は明示する。

**列挙に Markdown の番号付きリストを使わない**——各行は `- **ID n**: ...` のように candidate の `id` を地の文で書く（番号付きリストはレンダラがリストごとに 1 から振り直し、採否の ID 指定とずれる）。item 内のタイトル候補番号は丸数字（①②③）で書き、item の ID と干渉させない。

**気づき・洞察 item への人の応答は item ごとに次の 4 択**:

1. **候補番号の選択**（軸承認とタイトル確定を兼ねる）: 選ばれた候補を `gate.selected_title` に確定する。推奨案（先頭）以外が選ばれた item は `title_choice_non_primary` を ++ する。
2. **タイトル手入力（軸は維持）**: 人がその場で確定タイトルを書く。入力値を `gate.selected_title` に確定し、`title_human_edits` を ++ する。agent への再生成要請はしない（人ゲートが最終層——再生成の往復より人の手入力が速い）。
3. **軸手修正**: 人が軸（lesson_axis / common_axis）を書き直す。書き直した軸を `c.derivation` の該当フィールドへ反映し、`c.content` 内の軸言及箇所も同旨に直す。タイトルは併せて手入力（→ `gate.selected_title`・`title_human_edits` は ++ しない——軸修正に随伴する確定として `axis_human_edits` 側で数える）するか、既存候補から選び直す。反映後に derivation_ok を再算出し（算出式は気づき 4.6・洞察 4.3）、当該 item に 4.7 step 3 の規約検証を再走する（違反は従来どおり `validation_errors` へ）。`axis_human_edits` を ++ する。軸を書き直せない（成立しない）候補は 4 の drop に倒す。
4. **drop**。drop した気づきを `source:` / `connected_notes` に持つ**同バッチ洞察候補**があれば連鎖を確認する: 当該気づきを洞察の source から外し、残 source が 2 件未満になる場合はその洞察候補も drop を提案する（4.7 step 4 の検出失敗時連鎖と同型。dangling wikilink・source 2 件規律割れを黙って書かない）。

トリアージは 1 回で、軸承認だけを先に取る別ゲートは立てない。**agent への差し戻しラウンドは存在しない**——手入力の反映はすべて本体の決定論手続き（選択タイトルの差し替え swap・derivation 書き戻し・規約検証再走）で閉じる。

`done_candidates`（完了根拠の逐語引用と `quote_verified`）も列挙する。**`quote_verified` は taskDoneExtract subagent の自己照合**（subagent が自分の context 内で evidence_quote が inbox 本文に包含されることを確認した結果）であり、workflow 側の再照合は廃止済み。`quote_verified: false` の done 候補は「subagent 自己照合で inbox 本文への包含が確認できなかった」ことを明示して提示する。

**`DUPLICATE_DETECTED` ログが出た候補は両方提示し、人に重複解消を委ねる**（taskDoneExtract subagent の order 強制と排他指示が機能しなかったケースのフェイルセーフ）。

採否入力は 4 件以下なら AskUserQuestion の multiSelect でもよいが、5 件以上は番号指定で答えさせる（列挙は常に本文・選択肢からの除外で候補を落とさない）。承認確定時に、各採用 item の `gate.selected_title` を populate する。`selected_title !== c.title` の item は step 6 の実 Write 前に 4.7 step 1 の「選択タイトルの差し替え swap」を適用する。

### 6. 承認後の適用と archive 退避

step 4.7 step 5 で確定した `writeCandidates` / `archiveTargets` / `holdInboxes` を受けて、本 step は実 Write / Edit / mv を実行する（**本 step は実 IO 担当・決定は 4.7 step 5 が正本**）。

- **選択タイトルの差し替え swap（実 Write の前提）**: `selected_title !== c.title` の item があれば、4.7 step 1 の「選択タイトルの差し替え swap」（適用 3 系統・置換規則は同節が正本）を適用してから Write / Edit に進む。
- 新規ノート: `writeCandidates` のうち新規分は `content` を `notes/<タイトル>.md` に Write（タイトルは `selected_title`・未確定なら `c.title`）。fold は `backlink_edits` を畳み先へ追記。
- 逆リンク: `backlink_edits` を各既存ノートへ追記し、`updatedAt` 打ち直し・`## 更新履歴` に当日 `[[日付]]` を冪等追記。
- リンク張り替え: `link_rewrites`（昇格で inbox 名が変わる/分割される場合の被リンク元）の各ファイルで、元 inbox 名への wikilink を昇格先（複数分割なら主たる行き先）へ張り替える。**`reportExtract` 失敗時の張り替え保護 (rename を伴う昇格は次回 drain に持ち越し) は 4.7 step 2 / step 4 に集約・本節を参照**（重複箇所は 4.7 を正本とする）。inbox 自体の archive 退避除外も 4.7 step 4 の `holdInboxes` から `archiveTargets` を引いた結果に従う。
- done 化: 承認された done 候補の `progress: done` ＋ `updatedAt` 更新＋`## 更新履歴` に「完了」。`status:` は触らない。
- **archive 退避**: mv の前に `ls ~/workspace/notes/obsidian/Life/inbox/*.md | sort` を再実行し、step 1 のスナップショットと集合差分を取る。**欠落があれば mv せず、欠落ファイル名を報告してユーザ判断を仰ぐ**（Sync 消失の上に mv で状態を複雑化させない）。差分なしなら `archiveTargets` (4.7 step 5 で確定) の各 inbox path を `archive/inbox/` へ mv（`mkdir -p` の上で）。昇格先が同名 1:1 の場合は mv 自体が昇格を兼ねてよい（その場合 archive 退避は不要＝原本が notes/ で生きる）。`holdInboxes` に乗った inbox path は `archiveTargets` から除外済みなので inbox/ に残る（次回 drain で再処理）。

### 7. 完了報告と運用ログ

- 作成・fold・逆リンク・リンク張り替え・done 化・archive 退避（inbox/ 残量）・保留（理由付き）を箇条書きで報告する。
- **運用ログ記録**: `notes/distill運用ログ.md` に 1 実行 = 1 ブロックを追記する（記録項目・対記録フォーマットは `/harvest` スキルの「完了報告と運用ログ」節が正本——drain/harvest 共通）。drain で記録する項目:
  - モード `drain` / totals（候補・洞察・タスク・fold・done 候補）。**気づき件数・洞察件数は skill 本体側で別管理した値を補う**（気づき抽出・洞察検出が workflow を経由しないため `totals.kizuki` / `totals.insights` は drain では常に 0）。
  - **`per_part_metrics`**: workflow 戻りの 4 パート metric（`llm_wiki` / `task_done` / `kizuki_insight` / `format_output`）を運用ログに書き出す。`kizuki_insight` は workflow からは空 dict `{}` で返るので skill 本体側で算出した値を埋める（他 3 パートは workflow 戻りの値をそのまま使う）。**項目の例**:
    - `kizuki_insight.kizuki_count`: 気づき候補の総件数（fold を除く）
    - `kizuki_insight.insight_count`: 洞察候補の総件数
    - `kizuki_insight.kizuki_derivation_ok`: derivation_ok=true の気づき件数
    - `kizuki_insight.insight_derivation_ok`: derivation_ok=true の洞察件数
    - `kizuki_insight.self_flagged`: self_verdict=該当 のまま提示した候補件数（self-check の自己申告観測）
    - `kizuki_insight.machine_hits_items`: 推奨案に regex 機械ゲート hit が残った item 件数（生成段で表層違反が潰れているかの観測。4.5 の in-memory カウンタは持たず、本 step の集計時に `gate.machine_hits` 非空の item を数えて導出する）
    - `kizuki_insight.kizuki_spawn_failed`: 気づき抽出 agent spawn が失敗した inbox 件数
    - `kizuki_insight.kizuki_extract_malformed`: 気づき抽出 agent の戻り shape 不正 (必須 field / self_check 検査欠落) の inbox 件数
    - `kizuki_insight.insight_detect_failed`: 洞察検出 agent spawn が失敗したかの真偽
    - `kizuki_insight.title_choice_non_primary`: トリアージで人が推奨案 (title_candidates 先頭) 以外の候補を選んだ件数（複数候補が効いているかの観測）
    - `kizuki_insight.title_human_edits`: トリアージで人が候補外のタイトルを手入力した件数（rollback 判断材料）
    - `kizuki_insight.axis_human_edits`: トリアージで人が軸を手修正した件数（rollback 判断材料）
    - `format_output.report_extraction_failed`: reportExtract agent 起動失敗の inbox 件数（真の rex 失敗のみ）
    - `format_output.report_referrers_skipped`: reportExtract は成功したが `referrers_scanned === false` で referrers 未走査の inbox 件数（R3-11 で分離計上。「extraction 失敗」とは別軸——前者は agent が結果を返さなかった件数・後者は agent が結果を返したが referrers 走査を放棄した件数）
    - `format_output.task_done_extraction_failed`: taskDoneExtract agent 起動失敗の inbox 件数
  - **推奨/訂正ペア**（パイプライン推奨案 ↔ ユーザ指摘の訂正を 1 項目 1 ペアで・done の誤検出/取りこぼし訂正も含む）／洞察却下。複数候補提示の導入後のタイトル訂正書式（`<ID> 初稿 X → Y` の X/Y の意味）は /harvest スキル「完了報告と運用ログ」節の定義に従う（正本・項目追加は additive で書式互換）。
  - **最小テンプレで始める**（重くして書かなくなるのが最大の失敗）。訂正が無い実行でも totals の 1 ブロックは残す。

## workflow との interface

正本は `~/.claude/workflows/harvest-pipeline.js`（chezmoi source: `dot_claude/workflows/harvest-pipeline.js`）。判断系規約（捏造補完禁止・A／事実の区別・迷ったら分けて作る・タスク層分離・命名規約・persona との関係）は script に encode 済み——詳細と「撃ち直した残差の記録」は `/harvest` スキルの同名節を正本とする（drain/harvest は同一 pipeline を共有するため二重記述しない）。

Phase 4 で workflow から skill 本体側に移った責務（気づき抽出 prompt・洞察検出 prompt・self-check 命名ゲート）の prompt 本文は **`~/.claude/skills/drain/references/prompts/*.md` に外出し**してある（skill 本体から workflow utility を import できないため。SKILL.md 本文はフロー骨格と shape 検査に絞り、逐語 prompt は references 側の管理点で保守する）。`references/prompts/` 配下の各ファイル対応:

- `kizuki-extract.md` — 気づき抽出 agent 用（step 4.1 が参照・self-check 判断基準 7 項目の逐語を含む——**気づき命名基準の唯一の正本**）
- `insight-detect.md` — 洞察検出 agent 用（step 4.3 が参照・drain 固有の title_candidates / self-check 追加指示を含む）
- `fix.md` — 規約違反修正 sub-agent 用（4.7 step 3 が参照）

旧 checker / renamer / axis-redo の各 prompt ファイルは self-check 化（2026-07-05）で廃止した（判断基準は extract / detect prompt 内へ移設。再命名・軸再考の agent 往復は step 5 の人手入力に置換）。

vault 規約・命名規約の prose は **`references/vault-rules.md` が単一の正本**（2026-07-06 に workflow 側 `VAULT_RULES` / `NAMING_*` 定数から移設）。workflow 側 prompt も `references/prompts/` 側 prompt もパス参照で agent 自身に Read させるため、規約 prose の keep-in-sync は不要になった。節名（「vault 規約」「命名規約 (kind 共通の核)」「気づきの命名」「洞察の命名」）を変える場合だけ、全参照元（workflow `rulesRef` 呼び出し・`references/prompts/` の参照行）の節名指定を追従させる。**気づき命名基準**（旧 workflow noteCriteria・旧 kizuki-checker.md の 7 項目）は **`references/prompts/kizuki-extract.md` 内の self-check 節が唯一の正本**（R2-12 で workflow から noteCriteria を撤去・self-check 化で checker prompt ファイルも廃止し正本を extract prompt 内へ移した）——`references/prompts/` 側のみ変更する。洞察命名基準は `references/prompts/insight-detect.md` 内の self-check 節（drain 固有追加指示）へ転記済みで、workflow `insightCriteria`（backfill mode の洞察検出が workflow 内 nameGate を通るため稼働継続）との keep-in-sync 関係を維持する。なお `references/prompts/insight-detect.md` と workflow `insightPrompt` の逐語転記差分は、backfillFocus 節・mode 固有句に加え drain 固有の追加指示（title_candidates 3〜4 案・form 必須・**要素 shape 例の明示**（string 配列で返す事故の防止・2026-07-05 drain 27 回目の shape 違反接地）・self-check 手順。`insight-detect.md` 内に明示・spawn 時に末尾へ足すブロック）——few-shot 参照句自体は両側同一に保つ。prompt 本体側の既知差分（意図的・逐語同期の対象外）: (a) 冒頭の書き込み禁止文言（drain 側「Write は呼び出し元の責務」・workflow 側「Read/Grep/Glob のみ」——agent の実ツール構成が違うため）、(b) common_axis の output-style 準拠指示（drain 側のみ・kizuki-extract の lesson_axis と同じ規律）、(c) MCP 不達 fallback の記述が drain 側は要約形（実 rg コマンドは workflow 側のみ）、(d) vault-rules.md への参照指示行の書式——workflow 側は `rulesRef` helper が VAULT/NOW/TODAY の値を interpolate して埋め込み・drain 側はプレースホルダの対応付けを prose で指示する（参照先の規約ファイルと節は同一）。

**命名訂正事例集**: `~/.claude/skills/drain/naming-corrections.md`（chezmoi source: `dot_claude/skills/drain/naming-corrections.md`）が唯一の正本。参照方式・更新方式（パス参照のみ・静的キュレーション・NAMING 優先則）は同ファイル末尾の「keep-in-sync 方針」節を正本とする。SKILL 固有の受容事項: workflow `insightPrompt`（backfill でも走る）から drain 内部パスへ依存が生じる（backfill 同型改修の既存タスクの際に再検討）。

## やってはいけないこと

- 「会話に作業痕跡が無い」を理由に素材無し扱いに格下げする（inbox/ の中身が正規の作業リスト）
- workflow を介さず LLM Wiki / タスク done を本体から直接 Agent で fan-out する（命名ゲートと件数集計の決定論層を骨抜きにする）
- self_check artifact の shape 検査（4.1 正本）を省いて候補を通す（「チェックをやったフリ」の検出が唯一のコード層防御）
- `self_verdict=該当` の候補を黙って通す・黙って落とす（self_violations を注記してトリアージに明示し人に委ねる）
- 命名の再生成を agent に差し戻す（checker/renamer/軸再考ラウンドは 2026-07-05 β3 実測で廃止済み。トリアージでの訂正は人の手入力で閉じる）
- workflow 戻りの `candidates` と skill 本体側 気づき・洞察候補を要約・取捨・マージ・再命名してから提示する（生の N 件＝提示の N 件）
- 承認前に notes/ へ Write する
- スナップショット照合をせずに archive へ mv する（欠落があれば止めて報告）
- inbox/ の原本を処理後も放置する（archive/inbox/ へ退避し inbox を空に保つ。残量＝未処理キューの可視化）
- 昇格で inbox 名が変わるのに `link_rewrites` の張り替えを省く（同名昇格を既定前提にしない。`alwaysUpdateLinks` は mv→新規作成では効かない）
- `quote_verified: false` の done 候補を黙って通す・黙って落とす（subagent 自己照合で証拠が inbox 本文に包含されなかった旨をトリアージに明示して人に委ねる）
- skill 本体側 気づき抽出 / 洞察検出の失敗を黙って「0 件」として通す（workflow 側 flags には乗らないので、skill 本体側で独自に追跡して triage と運用ログに明示する）
- 運用ログを形骸化させる（重くして書かなくなるのが最大の失敗。`per_part_metrics.kizuki_insight` を skill 本体側で埋め忘れない）
- `imports/kindle/` `imports/wallabag/` の編集・リネーム
