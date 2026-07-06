export const meta = {
  name: 'harvest-pipeline',
  description: 'drain (即時 ingestion)・backfill (期間 reconciliation) の 2 層蒸留パイプライン: 素材整理 (既存突き合わせ・候補生成・命名ゲート inline)→洞察検出 (backfill のみ)→タスク・done 検出。件数・ゲート判定・モード封鎖・規約検証は script がコードで実行し、自己申告に依存しない。drain の気づき抽出・洞察検出は Phase 4 で skill 本体側に移管した (命名は抽出 prompt 内 self-check + skill 本体の shape コード検査。再命名の agent 往復は 2026-07-05 に廃止)',
  whenToUse: 'drain / harvest スキル本体 (SKILL.md) から scriptPath 指定で起動される。単体起動は想定しない',
  phases: [
    { title: '素材整理', detail: 'inbox 昇格候補 (drain=sonnet・taskDoneExtract / reportExtract の 2 並列抽出。気づき抽出は Phase 4 で skill 本体側に移管・workflow からは呼ばない) / 期間素材 (backfill=opus) の構造化と既存ノード突き合わせ。命名ゲート (機械 regex → 別 context 点検 agent → 再命名 → 再点検・最大 2 ラウンド) も素材整理 phase 内インラインで走る (drain では LLM Wiki=light gate・タスクのみ full gate)' },
    { title: '洞察検出', detail: 'ノード間の繋がりから第三の知見を検出 (opus・0 件は正当・backfill 専用)。drain の洞察検出は Phase 4 で skill 本体側に移管 (self-check 命名ゲート経由)・workflow では実行しない' },
    { title: 'タスク・完了検出', detail: '既存タスクの done 候補検出。drain では素材整理段で taskDoneExtract subagent が並列実行済み (donePrompt 呼び出しは廃止・引用は集約段で script が包含照合)。backfill は期間内作業レポート本文を corpus に donePrompt を走らせる' },
    { title: '集計', detail: 'ノート規約の機械検証 (frontmatter/更新履歴/ラベル残存/タグ整合) と totals 計算 + 整形パートの per_part_metrics 算出 (Phase 4 で 整形パート物理配置は workflow script 段に確定)。DUPLICATE_DETECTED (done と task_promotions の inbox_origin 衝突) と INSIGHT_ZERO のログも出す' },
  ],
}

// 純関数 scoreRelatedness は Workflow tool の制約 (static import は meta より前不可・後に書くと dynamic import call と誤解析・dynamic `import()` 自体も unsupported) で
// harvest-pipeline-pure.js から本体に直接コピーする。harvest-pipeline-pure.js は単体テスト用 (harvest-pipeline-pure.test.js) と API/定数仕様の正本として残し、
// 本ファイル内の関数本体は手作業で keep-in-sync する (workflow との interface 節と同型の関係)。
// v2 (2026-07-06): 絶対値 cosine 閾値を廃止しチャネル evidence 判定へ再設計。設計根拠の詳細は pure 側ヘッダコメント参照
// (score_knn=0.0 は kNN 窓外の欠測マーカー・e5-base の cosine 分布は正例/負例が重なり絶対値閾値が成立しない・裏取り 2026-07-06)。
const BM25_REL_FLOOR = 0.15
const FOLD_BM25_REL = 0.5
const RELATED_MAX = 6
const FOLD_MAX = 2

function scoreRelatedness(hits, opts = {}) {
  const bm25RelFloor = opts.bm25RelFloor ?? BM25_REL_FLOOR
  const foldBm25Rel = opts.foldBm25Rel ?? FOLD_BM25_REL
  const relatedMax = opts.relatedMax ?? RELATED_MAX
  const foldMax = opts.foldMax ?? FOLD_MAX

  if (foldBm25Rel < bm25RelFloor) {
    throw new Error(`scoreRelatedness: foldBm25Rel (${foldBm25Rel}) must be >= bm25RelFloor (${bm25RelFloor})`)
  }

  if (!Array.isArray(hits) || hits.length === 0) {
    return { related: [], fold_candidates: [] }
  }

  // note (path) 単位に集約 (index は section 粒度で 1 note が複数 hit を占める)
  const byPath = new Map()
  for (const h of hits) {
    if (!h || !h.path) continue
    let e = byPath.get(h.path)
    if (!e) {
      e = { path: h.path, knnMax: 0, bm25Max: 0, order: byPath.size }
      byPath.set(h.path, e)
    }
    e.knnMax = Math.max(e.knnMax, h.score_knn || 0)
    e.bm25Max = Math.max(e.bm25Max, h.score_bm25 || 0)
  }
  const notes = [...byPath.values()]
  const bm25Top = notes.reduce((m, n) => Math.max(m, n.bm25Max), 0)

  for (const n of notes) {
    n.inKnn = n.knnMax > 0 // kNN 窓に入った (0.0 は欠測なので「窓外」とだけ読む)
    n.bm25Rel = bm25Top > 0 ? n.bm25Max / bm25Top : 0
    n.inBm25 = bm25Top > 0 && n.bm25Rel >= bm25RelFloor
  }

  // ランキング: 両チャネル共起 > kNN 単独 > BM25 単独。同値は入力順 (stable)
  const group = (n) => (n.inKnn && n.inBm25 ? 0 : n.inKnn ? 1 : 2)
  const cands = notes.filter((n) => n.inKnn || n.inBm25)
  cands.sort((a, b) => {
    const ga = group(a)
    const gb = group(b)
    if (ga !== gb) return ga - gb
    const ka = ga === 1 ? a.knnMax : a.bm25Rel
    const kb = ga === 1 ? b.knnMax : b.bm25Rel
    return kb - ka || a.order - b.order
  })

  const related = cands.slice(0, relatedMax).map((n) => n.path)
  const fold_candidates = cands
    .filter((n) => n.inKnn && n.bm25Rel >= foldBm25Rel)
    .slice(0, foldMax)
    .map((n) => n.path)
    .filter((p) => related.includes(p)) // fold ⊆ related (relatedMax cap で切れた path の保護)

  return { related, fold_candidates }
}

// args interface:
//   共通: mode ('drain'|'backfill') / vault (絶対パス) / now (ISO-T) / today (YYYY-MM-DD)
//   drain:
//     inbox_files: [{path, content?}] 必須 — path のみが主流路。content 省略時は subagent が Read tool で取得 (main 占有トークン削減)。
//     open_tasks: [{path, title}] 必須 — 既存タスクノート一覧。taskDoneExtract subagent が done 候補検出のために突き合わせる素材。
//     obsidian_available: boolean — 被リンク洗いコマンド分岐
//   backfill:
//     period: {from, to} 必須

// ---- 入力 (ツール境界の引数は受け側で defensive に正規化する) ----
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (e) {
    throw new Error('args が JSON として解釈できない文字列で渡された: ' + e.message)
  }
}
if (!input || !input.mode || !input.vault || !input.now || !input.today) {
  throw new Error('args に mode / vault / now / today が必要 (script は Date 不可なので時刻は呼び出し側が渡す)')
}
const MODE = input.mode
if (!['drain', 'backfill'].includes(MODE)) throw new Error('mode は drain | backfill のいずれか')
const VAULT = input.vault
const NOW = input.now // ISO-T (YYYY-MM-DDTHH:mm)
const TODAY = input.today // YYYY-MM-DD
const INBOX_FILES = input.inbox_files || [] // drain: [{path}] が主流路。content は省略可 (workflow 内の各抽出 subagent (taskDoneExtract / reportExtract) と skill 本体側の気づき抽出 agent (Phase 4 で skill 本体側に移管) が Read tool で本文を取る)。
// 後方互換として content 同梱もサポート (subagent 側で Read をスキップ)。v6 plan で main 占有トークンを削減するため。
const OPEN_TASKS = input.open_tasks // drain: [{path, title}] — 既存タスクノート一覧。taskDoneExtract subagent が done 候補検出のために突き合わせる素材。drain 必須で || [] の既定値は取らない (validation 不発を防ぐため)
const PERIOD = input.period || null // backfill: {from, to}

// Obsidian 起動の有無 (タグ列挙・被リンク洗いを obsidian-cli にするか rg にするかの分岐)。起動判定は run 中で不変なので
// SKILL.md step 1 が pgrep -x Obsidian で一度だけ判定して渡す。分岐は決定論なので script がコマンド文字列を解決し、
// プロンプトには解決済みの単一コマンドだけを埋める (各 subagent に pgrep+分岐を委ねない)。未指定 (harvest 等) は false=rg/Grep。
const OBSIDIAN_AVAILABLE = !!input.obsidian_available
if (MODE === 'drain' && !INBOX_FILES.length) throw new Error('drain には inbox_files ([{path}] が主流路・content は省略可) が必要')
if (MODE === 'drain' && !Array.isArray(OPEN_TASKS)) throw new Error('drain には open_tasks ([{path, title}]) が必要 (string/null/undefined は不可・空配列は可)')
if (MODE === 'backfill' && !(PERIOD && PERIOD.from && PERIOD.to)) throw new Error('backfill には period ({from, to}) が必要')

// ---- モデル固定 (モデル出し分けを /model 手動運用から script へ移す) ----
const M_EXTRACT = MODE === 'drain' ? 'sonnet' : 'opus' // drain の昇格・整形はモデル差が小さい / backfill は洞察前段の素材判断が重い
const M_INSIGHT = 'opus' // 洞察検出はモデル差が最大
const M_CHECK = 'sonnet' // 命名点検は基準照合で軽い

// ---- backfill のタスクラベル封鎖: schema enum で ②③ を表現不能にする (散文の 3 重ゲートを置換) ----
const TASK_LABELS = MODE === 'backfill' ? ['①'] : ['①', '②', '③']

// ---- 層タグ集合 (done sweep の作業レポート判別・層仕分けの共有タクソノミ。リテラル二重定義を避ける) ----
const LAYER_TAGS = ['気づき', '洞察', 'タスク']

// ---- schema (enum に null を使わず 'none' を番兵にする) ----
const BACKLINK_EDIT = {
  type: 'object',
  required: ['path', 'add_line', 'where_hint'],
  properties: {
    path: { type: 'string', description: '追記先の既存ノート path' },
    add_line: { type: 'string', description: '追記する 1 行 (wikilink を含む完成形。既存ノートへの追記は最小限)' },
    where_hint: { type: 'string', description: '追記位置のヒント (節名など。本文の自然な位置)' },
  },
}

function candidateItem(kinds, { withInboxOrigin = false, withRelatedHits = false } = {}) {
  const required = ['kind', 'label', 'title', 'content', 'fold_into', 'source_excerpt', 'why_important', 'backlink_edits']
  const properties = {
    kind: { enum: kinds },
    label: { enum: ['none', ...TASK_LABELS], description: 'kind=タスク のとき抽出ラベル。それ以外は none' },
    title: { type: 'string', description: 'ノートのファイル名になるタイトル (拡張子なし)' },
    content: { type: 'string', description: 'frontmatter＋本文の完成形。fold_into 指定時は空文字' },
    fold_into: { type: 'string', description: '明白に同一物の既出を既存ノートへ畳む場合のみその path。新規なら空文字 (迷ったら分けて作りリンクする)' },
    source_excerpt: { type: 'string', description: 'タイトルの元になった素材の逐語抜粋 (命名点検の元記述)' },
    why_important: { type: 'string', description: 'タスク③は必須。それ以外は空文字可' },
    backlink_edits: { type: 'array', items: BACKLINK_EDIT, description: '関連既存ノード側からの逆リンク追記 (双方向リンク)。fold 時は畳み先への追記' },
    derivation: {
      type: 'object',
      description: '気づき向けの導出 (洞察 derivation 同型・気づき以外は空。kind=気づき のときだけ prompt と script が必須化する)',
      properties: {
        source_observations: { type: 'array', items: { type: 'string' }, description: '観察した個別事象の逐語抜粋 (1 件以上・複数文の逐語可)' },
        pattern_generalization: { type: 'string', description: '観察した個別事象から事象に固有でない pattern (繰り返し見える構造・固有名詞を抜いた骨格) を 1 文で抽出した中間段。固有名詞・特定ツール・特定文脈の語を一般語に置換した形で書く。lesson_axis (次にどう振る舞うか) の前段で、subagent の抽象化過程を出力に残すための段' },
        lesson_axis: { type: 'string', description: '一段上の機序/教訓を 1 文で言い切ったもの。タイトルの土台になる教訓軸 (洞察の common_axis 同型の役割)' },
        generalization_check: { type: 'string', description: '主語を固有名詞でない一般語に置換できるか／複数文脈に転用可能かの自己検証文言 (1 文)' },
      },
    },
  }
  if (withInboxOrigin) {
    required.push('inbox_origin')
    properties.inbox_origin = { type: 'string', description: 'この候補がどの inbox から来たか (集約段で done_candidates との重複検出に使う照合キー。drain の場合は各抽出 subagent が処理中の inbox path を埋める)' }
  }
  if (withRelatedHits) {
    // optional field: MCP search_hybrid の hits を構造化して並べる入口。script 側で scoreRelatedness() に渡して related/fold_candidates を算出する。
    // LLM の「当たり付け」判断は削除し、agent は MCP 戻りを並べるだけ (純関数化の正本: harvest-pipeline-pure.js)。
    // 欠落耐性: agent 戻りが空のとき script 側で [] に正規化してから scoreRelatedness に渡す。
    properties.related_hits = {
      type: 'array',
      description: 'MCP mcp__vault-catalog__search_hybrid の hits 配列。各 hit は { path, score_bm25, score_knn } の subset を含む。script 側で純関数 scoreRelatedness() が 2 段階閾値 (related/fold_candidates) を判定する',
      items: {
        type: 'object',
        required: ['path', 'score_bm25', 'score_knn'],
        properties: {
          path: { type: 'string', description: '既存ノートの path (vault 内・notes/foo.md 等)' },
          score_bm25: { type: 'number', description: 'Lucene BM25 score (unbounded・kNN だけが当たって BM25 が 0 のとき 0)' },
          score_knn: { type: 'number', description: 'kNN cosine 0.0-1.0 (BM25 だけが当たって kNN が 0 のとき 0)' },
        },
      },
    }
  }
  return { type: 'object', required, properties }
}

// Phase 4: drain の気づき抽出 agent と旧戻り schema (kizuki_promotions / old_name_referrers の 2 field 版) は廃止された。
// 気づき抽出責務は skill 本体側 (drain SKILL.md) に移管され、命名は抽出 prompt 内 self-check + skill 本体の
// shape コード検査で運用される (再命名の agent 往復は 2026-07-05 に廃止)。workflow からは 気づき抽出 prompt を呼ばない。

// Phase 2: reportExtract agent (LLM Wiki パート) の戻り schema。作業レポート・事実 のみを kind enum に持ち、
// taskDoneExtract と並列起動して同一 inbox を独立に処理する (Phase 4 で 気づき抽出 廃止後は 2 並列構成)。
// old_name_referrers は集約段で union 取得 (skill 本体側で kizuki/insight 由来の rename referrers を merge する想定だが Phase 4 では reportExtract のみが referrers を返す)。
const REPORT_EXTRACT_SCHEMA = {
  type: 'object',
  required: ['report_promotions', 'old_name_referrers', 'referrers_scanned'],
  properties: {
    report_promotions: { type: 'array', items: candidateItem(['作業レポート・事実'], { withInboxOrigin: true, withRelatedHits: true }) },
    old_name_referrers: { type: 'array', items: { type: 'string' }, description: '昇格でこの inbox 名が変わる/分割される場合、元 inbox 名を wikilink で指す既存ノートの path (Phase 4 で drainExtract 廃止後は reportExtract が唯一の referrers 源)' },
    referrers_scanned: { type: 'boolean', description: 'old_name_referrers の洗い出しを実際に実行したか (true=scan 実行・false=skip)。0 件返ったとき「scan して 0 件」と「skip して 0 件」を区別するため必須 (R2-8)。skip 時は archive 退避除外対象にする' },
  },
}

// Phase 3: taskDoneExtract agent (タスク done パート) の戻り schema。旧 drain 抽出 prompt からタスク抽出 + done 検出責務を
// 切り出した分離後の構成。Phase 4 以降は reportExtract と並列起動して同一 inbox を独立に処理する (2 並列 fan-out)。
// task_promotions の inbox_origin と done_candidates の inbox_origin は同じ inbox を指すので集約段で交差判定
// (DUPLICATE_DETECTED) する。done_candidates の schema は旧抽出 schema から逐字移植 (集約段の包含照合・quote_verified の
// 自己申告規約は不変)。
const TASK_DONE_EXTRACT_SCHEMA = {
  type: 'object',
  required: ['task_promotions', 'done_candidates'],
  properties: {
    task_promotions: { type: 'array', items: candidateItem(['タスク'], { withInboxOrigin: true }) },
    done_candidates: {
      type: 'array',
      description: '既存タスクノートのうち、この inbox の本文に完了示唆が読み取れるもの。0 件が正当 (推測で done 候補にしない)',
      items: {
        type: 'object',
        required: ['task_path', 'evidence_quote', 'basis', 'quote_verified', 'inbox_origin'],
        properties: {
          task_path: { type: 'string', description: '既存タスクノートの path (open_tasks から)' },
          evidence_quote: { type: 'string', description: 'inbox 本文中の完了示唆の逐語引用 (集約段で script が包含照合する)' },
          basis: { type: 'string', description: 'やることのどの項目が満たされたかの説明' },
          quote_verified: { type: 'boolean', description: 'subagent が自分の context 内で evidence_quote が inbox 本文に包含されることを確認した真偽 (集約段でも script が再照合する)' },
          inbox_origin: { type: 'string', description: 'この done 候補がどの inbox から来たか (taskDoneExtractPrompt が処理中の inbox path を埋める。集約段の DUPLICATE_DETECTED 照合キー)' },
        },
      },
    },
  },
}

const BACKFILL_SCHEMA = {
  type: 'object',
  required: ['period_pages', 'journal_notes', 'candidates'],
  properties: {
    period_pages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'gist', 'tags', 'body'],
        properties: {
          path: { type: 'string' },
          gist: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' }, description: 'frontmatter tags の全要素 (done sweep の作業レポート判別を script が行うため。気づき/洞察/タスク を含むかで層を仕分ける)' },
          body: { type: 'string', description: 'ノート本文の逐語 (done sweep の証拠照合の母体。要約・truncate せず原文全文を返す。長大でも省略しない——truncate すると done-scan の引用が corpus に当たらず quote_verified が系統的に false になる)' },
        },
      },
    },
    journal_notes: { type: 'array', items: { type: 'string' } },
    candidates: { type: 'array', items: candidateItem(['タスク']) },
  },
}

const INSIGHT_SCHEMA = {
  type: 'object',
  required: ['insights'],
  properties: {
    insights: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'connected_notes', 'title', 'content', 'why_important', 'backlink_edits', 'derivation'],
        properties: {
          derivation: {
            type: 'object',
            required: ['source_avoidances', 'common_point', 'common_axis'],
            description: '洞察を立てる前に毎回必ず実施する導出チェックリスト (行き詰まり時でなく全候補)。埋められない＝第三知見が立っていない＝洞察にしない',
            properties: {
              source_avoidances: { type: 'array', items: { type: 'string' }, description: '各 source 気づきの失敗を回避する方法を 1 つずつ (source と同数・2 件以上)' },
              common_point: { type: 'string', description: '回避法に共通する点' },
              common_axis: { type: 'string', description: '共通点から出る共通の対処/確認 (1 つの事前判断 or 1 つのレビュー観点)。title=判断軸 の元。出せないなら洞察にしない' },
            },
          },
          claim: { type: 'string', description: '見えた洞察の一文の言い切り (複文可。タイトルの元記述になる)' },
          connected_notes: { type: 'array', items: { type: 'string' }, description: '繋いだ実在ノートの path' },
          title: { type: 'string', description: 'claim から述語を 1 つ選び条件節を捨てて圧縮したタイトル' },
          content: { type: 'string', description: 'templates/insight.md 構造の frontmatter＋本文完成形' },
          why_important: { type: 'string' },
          backlink_edits: { type: 'array', items: BACKLINK_EDIT },
        },
      },
    },
  },
}

const CHECK_SCHEMA = {
  type: 'object',
  required: ['verdict', 'violations'],
  properties: {
    verdict: { enum: ['該当', '非該当', '判断不能'] },
    violations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['criterion', 'quote', 'note'],
        properties: {
          criterion: { type: 'string', description: '違反した判断基準の番号・名前' },
          quote: { type: 'string', description: 'タイトル案の該当部分文字列の引用 (基準④は元記述側の対応部分とタイトルを併記)' },
          note: { type: 'string', description: '1 行の説明 (判断不能のときは理由)' },
        },
      },
    },
  },
}

const RENAME_SCHEMA = { type: 'object', required: ['title'], properties: { title: { type: 'string' } } }
const FIX_SCHEMA = { type: 'object', required: ['content'], properties: { content: { type: 'string' } } }
const DONE_SCHEMA = {
  type: 'object',
  required: ['done_candidates'],
  properties: {
    done_candidates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['task_path', 'evidence_quote', 'basis'],
        properties: {
          task_path: { type: 'string' },
          evidence_quote: { type: 'string', description: '作業素材からの逐語引用 (script が包含照合する。要約・言い換えは落ちる)' },
          basis: { type: 'string', description: 'やることのどの項目が満たされたかの説明' },
        },
      },
    },
  },
}

// ---- 共有規約への参照 (規約 prose の正本は外部ファイル) ----
// 正本: ~/.claude/skills/drain/references/vault-rules.md (旧 VAULT_RULES / NAMING_* 定数から移設)。
// script sandbox は fs を読めないが spawn される agent は Read を持つ——prose は agent に直接 Read させ、
// script には構造と業務指示だけを残す。NOW/TODAY/VAULT の値は静的ファイルに書けないため参照指示の行で渡す。
const RULES_FILE = '~/.claude/skills/drain/references/vault-rules.md'
const rulesRef = (...sections) =>
  `vault 規約と命名規約: ${RULES_FILE} を Read し「${sections.join('」「')}」節に厳守で従う (Read は 1 回だけでよい)。規約文中の <VAULT> は ${VAULT}、<NOW> は ${NOW} (ISO-T)、<TODAY> は ${TODAY} を指す。`

// ---- 命名ゲート (3 層: 機械 regex → 別 context 点検 agent → 再命名ループ) ----
const FUKUBUN = /、|すると|したら|つつ|（|\(/g
function regexHits(title) {
  return title.match(FUKUBUN) || []
}

function checkerPrompt(kind, title, excerpt) {
  const taskCriteria = `- 動詞主体の短句か (「〜する」「〜化する」「〜を確認する」)。
- 複文化していないか (条件節・並列。連用形「〜して」の 2 動詞構造、主述 1 文の条件結果型「Xは Y で Z する」もすり抜け対象として見る)。`
  // Phase 2 lightNameGate 用 (作業レポート・事実)。気づき/洞察の作法 (観察/判断軸の名指し) は要件外なので
  // ①観察を名指す/①判断軸を名指す はかけない——「平易な日常語」「不自然動詞結合」「条件結果 2 動詞構造」「false agency」
  // など作業レポート題でも避けたい構造シグナルだけに絞る。renamer は呼ばないので「該当」は素直に unresolved に倒れる。
  const reportCriteria = `① 平易な日常語で、メタファー連結になっていないか: jargon・英語混入・造語・狭い実装語の連結が無いこと、および比喩/メタファー/personification の連結で抽象語が並んでいないか (vault で確立した技術術語は許容)。偏愛語 (泥臭さ／手触り／解像度／本質／営み／文脈)・必殺技造語 (真理／虚飾／美学／境地)・横文字メタファー (思考の OS／ハック／インストール／リファクタリング) も違反。
② 不自然な動詞-目的語結合が無いか: 圧縮で生じる不自然結合 (「過剰を取り込む」等) は元記述の意味を消すシグナル。
③ 条件結果の 2 動詞構造になっていないか: 連用形「〜して〜する」、主述 1 文の条件結果型。要点を 1 動詞に圧縮できるかで判定する (できなければ 2 主張の混在＝複文)。
④ false agency になっていないか: モノを主語に人間動詞をさせる型 (「データが示す」「文化が醸成される」等) は違反——誰が何をしたかに書き換える対象。`
  // Phase 4 + R2-12: 気づき命名基準 (旧 noteCriteria) は skill 本体側へ移管した。
  // workflow に kind='気づき' の候補は流入しない (REPORT/TASK_DONE/BACKFILL/INSIGHT_SCHEMA のいずれも気づきを enum しない)。
  // drain references/prompts/kizuki-extract.md の self-check 節が稼働中の正本——本 workflow から noteCriteria 定義を撤去し、非対称ドリフトの温床を断つ。
  // 洞察は気づきと作法が違う: 判断軸を名指す (失敗形は不可)。気づきは観察 (失敗形/中立どちらも可) なので noteCriteria① とは別基準にする (失敗接地: 2026-06-14 洞察タイトルを失敗形/相関/型空当てで 4 回外した)
  const insightCriteria = `① 判断軸を名指しているか: 「次にどう振る舞うか／何で判断するか」の規則・観点になっているか。失敗の再記述 (「〜と損する/間違える/死ぬ」等の失敗形) は気づき側の作法で、洞察では不可 (失敗形=該当)。
② 平易な日常語で、メタファー連結になっていないか: jargon・英語混入・造語・狭い実装語が無いこと、および比喩/メタファー/personification の連結で抽象語が並んでいないか (vault で確立した技術術語は許容)。失敗例「ガードを指す番地は消える記憶では迷子になる」型——「ガード」「番地」「迷子」「消える記憶」のような抽象語/技術メタファーの連結で何が起きるかが直接読めない型は違反。偏愛語 (泥臭さ／手触り／解像度／本質／営み／文脈)・必殺技造語 (真理／虚飾／美学／境地)・横文字メタファー (思考の OS／ハック／インストール／リファクタリング) も違反。**semi-metaphor 動詞をタイトル動詞に据えるのも違反**——ルール/決定/情報など抽象主語に対して「飛ぶ・抜ける・刺さる・効く・回る・跳ねる・突く・突き刺さる・降りる・落ちる・外れる・浮く・沈む」等の semi-metaphor 動詞を主動詞に置く型は違反 (「ルールが黙って飛ぶ」「必須の問いが抜ける」「ガードが外れる」)。直接動詞 (使われない・省かれる・無視される・適用されない・守られない) か、明示的な受動/人間主語への書き換えを促す。日常語の「効く」(=役に立つ) など動詞本体が日常用法として成立するケースは違反にしない——判定は「抽象主語 + semi-metaphor 動詞 = 何が起きるかが直接読めない型」に限る。
③ source の単純合算・症状の相関の言い切りでないか: 複数 source 気づきを足しただけ・症状を並べた相関 (「X も Y も決まる」等) は第三知見でない。source の上に立つ一段上の軸か。
④ 観測できる規則・境界か: 成果物に対して確認できる規則 (レビュー観点・設計制約に使える) か。作者の内的手順 (「〜する前に確かめる」等・成果物に現れず自己申告に退化する) は不可 (内的手順=該当)。
⑤ 型の空当てでないか: 「良い◯◯は…で決まる」等の形を中身なく当てただけで、対象と基準の関係が芯に無い、になっていないか。
⑥ false agency になっていないか: モノを主語に人間動詞をさせる型 (「データが示す」「文化が醸成される」等) は違反——誰が何をしたかに書き換える対象。
⑦ 主語の空虚な一般化になっていないか: 「人々は」「我々は」「現代社会において」型の空虚な一般化は違反 (具体事象から構造を抽出する一般化は OK——洞察の核がこちら)。`
  return `あなたはタイトル案の指摘者である。書き直さない・代替案を出さない・違反の指摘だけ返す。ツールは一切使わない (判断のみ)。生成時の確信は手元に無くてよい・無いまま per-item で独立に判断する。

種別: ${kind}
タイトル案: ${title}
元記述 (この素材から名付けられた):
${excerpt || '(元記述なし)'}

判断基準:
${kind === 'タスク' ? taskCriteria : kind === '洞察' ? insightCriteria : kind === '作業レポート・事実' ? reportCriteria : (() => { throw new Error(`checkerPrompt: 想定外の kind=${kind} (気づき checker は skill 本体 step 4.2 に移管・workflow には流入しないはず)`) })()}

verdict: 違反あり=該当 / 違反なし=非該当 / 元記述が薄く判定できない=判断不能 (note に理由を 1 行)。`
}

function renamePrompt(kind, title, excerpt, issues) {
  const namingSections =
    kind === '洞察'
      ? ['命名規約 (kind 共通の核)', '洞察の命名']
      : kind === 'タスク'
        ? ['命名規約 (kind 共通の核)']
        : ['命名規約 (kind 共通の核)', '気づきの命名']
  return `あなたはタイトルの再命名担当。以下の指摘を解消する新しいタイトルを 1 つだけ返せ。ツールは下記規約ファイルの Read 1 回のみ使ってよい (他のツールは使わない)。

種別: ${kind}
現タイトル: ${title}
元記述: ${excerpt || '(なし)'}
指摘: ${issues}
${rulesRef(...namingSections)}
機械ゲート (正規表現 、|すると|したら|つつ|（|\\( ) にもかからないこと。`
}

function renameCandidate(c, newTitle) {
  const old = c.title
  c.title = newTitle
  if (c.content) c.content = c.content.split(`[[${old}]]`).join(`[[${newTitle}]]`)
  for (const e of c.backlink_edits || []) e.add_line = e.add_line.split(`[[${old}]]`).join(`[[${newTitle}]]`)
}

// Phase 2: 作業レポート・事実 (LLM Wiki パート) 専用の軽量命名ゲート。
// regex hit → checker 該当 → unresolved の 1 ラウンドで打ち切り、renamer agent は呼ばない。
// 命名規約の難所 (②メタファー連結・⑤型空当て) は気づき・洞察にしか直撃しないため、作業レポート題には
// renamer 起動コストを払わない (Phase 2 plan L156-158 の renamer 撤廃方針)。
async function lightNameGate(c) {
  const g = { initial_title: c.title, final_title: c.title, rounds: 1, log: [], unresolved: false, undecidable: false }
  const hits = regexHits(c.title)
  if (hits.length) {
    g.log.push(`r1: 機械ゲート hit: ${[...new Set(hits)].join(' ')} (light gate・renamer 呼ばずに unresolved)`)
    g.unresolved = true
    return g
  }
  const v = await agent(checkerPrompt(c.kind, c.title, c.source_excerpt), {
    schema: CHECK_SCHEMA,
    model: M_CHECK,
    label: `check:${c.title.slice(0, 14)}`,
    phase: '命名ゲート',
  })
  if (!v) {
    g.log.push('r1: 点検 agent 失敗 (light gate・unresolved)')
    g.unresolved = true
    return g
  }
  if (v.verdict === '非該当') {
    g.log.push('r1: 非該当 (通過)')
    return g
  }
  if (v.verdict === '判断不能') {
    g.log.push(`r1: 判断不能 — ${(v.violations[0] && v.violations[0].note) || '理由不明'}`)
    g.undecidable = true
    return g
  }
  // 該当 → renamer 呼ばずに unresolved (light gate: rounds=1 で打ち切り)
  const issues = v.violations.map((x) => `基準${x.criterion}: 「${x.quote}」 ${x.note}`).join(' / ')
  g.log.push(`r1: 該当 ${issues} (light gate・renamer 呼ばずに unresolved)`)
  g.unresolved = true
  return g
}

async function nameGate(c, renameModel) {
  // Phase 2: 作業レポート・事実 は軽量ゲートに dispatch (renamer 撤廃)
  if (c.kind === '作業レポート・事実') return await lightNameGate(c)
  const g = { initial_title: c.title, final_title: c.title, rounds: 0, log: [], unresolved: false, undecidable: false }
  for (let round = 1; round <= 2; round++) {
    g.rounds = round
    const hits = regexHits(c.title)
    let issues = ''
    if (hits.length) {
      issues = `機械ゲート hit: ${[...new Set(hits)].join(' ')} (複文・括弧の表層シグナル)`
    } else {
      const v = await agent(checkerPrompt(c.kind, c.title, c.source_excerpt), {
        schema: CHECK_SCHEMA,
        model: M_CHECK,
        label: `check:${c.title.slice(0, 14)}`,
        phase: '命名ゲート',
      })
      if (!v) {
        g.log.push(`r${round}: 点検 agent 失敗`)
        g.unresolved = true
        return g
      }
      if (v.verdict === '非該当') {
        g.log.push(`r${round}: 非該当 (通過)`)
        return g
      }
      if (v.verdict === '判断不能') {
        g.log.push(`r${round}: 判断不能 — ${(v.violations[0] && v.violations[0].note) || '理由不明'}`)
        g.undecidable = true
        return g
      }
      issues = v.violations.map((x) => `基準${x.criterion}: 「${x.quote}」 ${x.note}`).join(' / ')
    }
    g.log.push(`r${round}: ${issues}`)
    if (round === 2) {
      g.unresolved = true
      return g
    }
    const r = await agent(renamePrompt(c.kind, c.title, c.source_excerpt, issues), {
      schema: RENAME_SCHEMA,
      model: renameModel,
      label: `rename:${c.title.slice(0, 14)}`,
      phase: '命名ゲート',
    })
    if (!r || !r.title || r.title === c.title) {
      g.unresolved = true
      return g
    }
    renameCandidate(c, r.title)
    g.final_title = r.title
    g.log.push(`r${round}: 再命名 → ${r.title}`)
  }
  return g
}

function needsGate(c) {
  // Phase 2: 作業レポート・事実 も軽量ゲート (regex+checker のみ) の対象に含める。fold は対象外。
  // Phase 4: 気づき gate は skill 本体側 step 4.2 (self-check 命名ゲート) に移管 (workflow 経路の `kind === '気づき'` は到達不能・R2-9)。
  return !c.fold_into && (c.kind === 'タスク' || c.kind === '洞察' || c.kind === '作業レポート・事実')
}
async function runGate(c) {
  c.gate = await nameGate(c, c.kind === '洞察' ? M_INSIGHT : M_EXTRACT)
}

// ---- ノート規約の機械検証 (prompt の厳守事項をコード化) ----
function validateCandidate(c) {
  const errs = []
  if (c.fold_into) {
    if (!(c.backlink_edits || []).length) errs.push('fold 指定なのに畳み先への追記 (backlink_edits) が無い')
    return errs
  }
  const content = c.content || ''
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return ['frontmatter が無い']
  const fm = fmMatch[1]
  const body = content.slice(fmMatch[0].length)
  if (!fm.includes(`createdAt: ${NOW}`)) errs.push(`createdAt が ${NOW} でない`)
  if (!fm.includes(`updatedAt: ${NOW}`)) errs.push(`updatedAt が ${NOW} でない`)
  if (!content.includes('## 更新履歴')) errs.push('## 更新履歴 が無い')
  if (!content.includes(`[[${TODAY}]]`)) errs.push(`更新履歴に [[${TODAY}]] が無い`)
  if (/^# /m.test(body)) errs.push('本文に H1 がある (H2 から始める)')
  // ラベル残存チェックはタスク限定。全 kind に当てると作業レポートの正当な ①②③ 引用まで
  // 抽出 agent が回避表記に書き換える (失敗接地: 2026-06-12 実走で「①」→「丸1」等の不自然な置換)
  if (c.kind === 'タスク' && /[①②③]/.test(content)) errs.push('ラベル文字 ①②③ が残存している')
  if (c.kind === '気づき' && !/気づき/.test(fm)) errs.push('tags に 気づき が無い')
  if (c.kind === '洞察') {
    if (!/洞察/.test(fm)) errs.push('tags に 洞察 が無い')
    if (!/source:/.test(fm)) errs.push('frontmatter source: が無い')
  }
  if (c.kind === 'タスク') {
    if (!/タスク/.test(fm)) errs.push('tags に タスク が無い')
    if (!/progress: backlog/.test(fm)) errs.push('progress: backlog が無い')
    if (content.includes('- [ ]')) errs.push('チェックボックス (- [ ]) が使われている')
    if (c.label === '③' && !c.why_important) errs.push('ラベル③なのに why_important が空')
  }
  if (c.kind === '作業レポート・事実' && /tags:[\s\S]{0,200}?(気づき|洞察)/.test(fm)) errs.push('事実・作業レポートに 気づき/洞察 タグが付いている')
  return errs
}

async function fixAndRevalidate(c) {
  if (c.fold_into) {
    c.validation_errors = validateCandidate(c)
    return
  }
  let errs = validateCandidate(c)
  if (errs.length) {
    const r = await agent(
      `以下のノート内容に機械検証で検出された規約違反がある。違反だけを直し、content 全文を返せ。指示に無い改変 (本文の追加・文体調整) を混ぜない。
違反: ${errs.join(' / ')}
参考値: createdAt/updatedAt は ${NOW}。更新履歴の日付リンクは [[${TODAY}]]。
--- content ここから ---
${c.content}
--- content ここまで ---`,
      { schema: FIX_SCHEMA, model: M_CHECK, label: `fix:${c.title.slice(0, 14)}`, phase: '集計' },
    )
    if (r && r.content) c.content = r.content
    errs = validateCandidate(c)
  }
  c.validation_errors = errs
}

// ---- プロンプト (モード別素材整理) ----
// Phase 4: drain の気づき抽出 prompt は廃止された。気づき抽出責務は skill 本体側 (drain SKILL.md) に移管され、
// 命名は抽出 prompt 内 self-check + skill 本体の shape コード検査で運用される (再命名の agent 往復は 2026-07-05 に廃止)。
// 関連 prompt 本文 (kizuki extraction / insight detection・self-check 判断基準) は skill 本体側 references/prompts/ に転記済み。
// drain mode の workflow は reportExtract (LLM Wiki) と taskDoneExtract (タスク done) の 2 agent fan-out に縮小された。

// Phase 2: reportExtract agent (LLM Wiki パート) のプロンプト。元の 4 系統併合抽出 prompt から作業レポート・事実 抽出責務を切り出し、
// inbox 1 件を単独で読み込み 作業レポート・事実 候補だけを構造化して返す。Phase 4 以降は taskDoneExtract と並列起動
// (script の pipeline + Promise.all で 1 inbox=2 agent fan-out)・気づき抽出は skill 本体側で並列に動く (本 agent からは見えない)。
// 責務順序強制 (作業レポート 1:1 昇格)・MCP 突き合わせ・MCP fallback 規約は元の併合 prompt から継承する。
function reportExtractPrompt(f) {
  const backlinkCmd = OBSIDIAN_AVAILABLE
    ? 'obsidian backlinks file=<元 inbox 名 (拡張子なし)> (実リンクグラフを解決するので alias・heading リンクも拾う)'
    : `rg -l '\\[\\[<元 inbox 名 (拡張子なし)>\\]\\]' ${VAULT}`
  const hasContent = !!(f.content && f.content.length)
  const bodySection = hasContent
    ? `--- 内容ここから ---\n${f.content}\n--- 内容ここまで ---`
    : `本文取得: Read tool で \`${f.path}\` を開き、本文を加工せず subagent context 内で扱う。**読んだ全文を戻り値に再掲しない** (集約段が肥大化する。逐語が要るのは source_excerpt だけ)。`
  return `あなたは vault inbox 排出 (drain) の **作業レポート・事実 (LLM Wiki パート) 抽出担当**。以下の inbox ノート 1 件を読み、notes/ へ昇格させる **作業レポート・事実 候補のみ** を構造化して返せ。ファイルへの書き込みは一切しない (Read/Grep/Glob のみ。Write は呼び出し元の責務)。

vault: ${VAULT}
inbox ノート: ${f.path}
${bodySection}

**責務の限定 (Phase 2 で分離された LLM Wiki パート)**:
- あなたは **作業レポート・事実 (調査記録・1:1 昇格対象・客観事実・仕様・スペック) のみ** を report_promotions に出す。schema enum で 作業レポート・事実 以外は表現不能だが、念のため指示。
- 気づき (主観的な学び・判断・教訓・方針) は **skill 本体側 (drain SKILL.md) の気づき抽出担当の責務**なので本 agent では切り出さない (主語をツール固有から一般化した主観的教訓は気づき側で扱う)。
- タスク (未着手の行動) と done 検出 は **並行する taskDoneExtract agent の責務**。
- 同一 inbox は taskDoneExtract と並列 (workflow 内) ＋ skill 本体側の気づき抽出と並列 (workflow 外) で処理される——あなたの戻りに気づき/タスク/done を混ぜない (他 agent と重複する)。

手順:
1. この inbox の内容を「名付けられる粒度」で **作業レポート・事実** の昇格候補に分ける (1 inbox から複数可)。作業レポート・調査記録はそれ自体を 1:1・具体タイトルのまま kind=作業レポート・事実 として昇格する。検証で確定した客観事実・仕様・スペックも 作業レポート・事実 として扱う。**気づきはここで切り出さない** (skill 本体側の気づき抽出担当の責務)。
2. 各候補について vault 既存ノードを突き合わせる。一次索引は MCP tool 経由で動的に引く (常時ロードのカタログは持たない・subagent には届かない)。**関連既存ノートの認定 (どの hit を逆リンク候補・fold 候補にするか) は判断しない**——script 側の純関数 (scoreRelatedness) が hits の 2 チャネル evidence (kNN 窓・BM25 相対値) で判定する。あなたの責務は hits を構造化して並べて返すだけ。
   - タイトル一致・意味近傍: **2 本のクエリを呼んで hits を合算する**——\`mcp__vault-catalog__search_hybrid(query=候補タイトル, limit=12)\` と \`mcp__vault-catalog__search_hybrid(query=<素材の中心語: source_excerpt 中の固有名詞・具体語をスペース区切りで 3〜6 語>, limit=12)\`(一般化した候補タイトルは具体語彙が剥がれて検索 anchor が弱いため、素材側の語彙で 2 本目を引く)。合算した hits の各要素から \`path\` / \`score_bm25\` / \`score_knn\` を取り、候補の \`related_hits\` field にそのまま並べる (重複 path はそのまま並べてよい・script が note 単位に dedup して evidence 判定する)。**hits の path/title/tags/body_snippet を見て当たりを付けることはしない**——その判断は純関数が score で行う。
   - タグ共有での当たり付け: inbox 本文中に既存の #タグ 表記や明示的なタグキーワードが読み取れる場合に限り、それらを引数に \`mcp__vault-catalog__search_by_tag(tags=[<読み取ったタグ列>], limit=10)\` を呼ぶ (近傍候補の追加収集として使う・search_hybrid の戻りに含まれる hit と path が重複したら 1 件に集約する。それ以外の hit は related_hits に並べる)。inbox 本文にタグの手掛かりが無ければこの step を飛ばす。
   - fold 判定が要るもの (script が後段で fold_candidates 認定する path) はあなたではなく集約段で本文 Read 確認に回る。あなたは **MCP 戻りを並べる**だけで本文 Read はしない (全 notes の Grep fan-out もしない)。
   - MCP 該当が 0 件なら related_hits を空配列で返す。新規候補として扱う。
3. 新規候補は content に frontmatter＋本文の完成形を書く。**関連既存ノード側からの逆リンクは frontmatter \`related:\` への追記として backlink_edits に列挙する** (本文 \`## 関連\` セクションへの追記は廃止・新方式)。backlink_edits は **related_hits に並べた distinct path 1 件につき 1 件** を機械的に生成する (同じ path の section 重複には 1 件でよい。どの path が「関連」「fold 候補」かは集約段の純関数 scoreRelatedness が 2 チャネル evidence で判定するので、あなたは選別判断をしない・列挙だけする)。テンプレートは以下:
   - \`where_hint\` = \`'frontmatter related:'\` (固定文字列)
   - \`add_line\` = \`'  - "[[<新規ノートのタイトル>]]"'\` (frontmatter block list の 1 要素・行頭 2 スペースインデント + \`- \` + ダブルクオート囲み wikilink。SKILL.md 4.7 step 2.1 がこの形のまま list に差し込む)
   - \`path\` = hit の path (例: \`notes/既存ノート.md\`)
   - 例: \`{"path": "notes/既存ノート.md", "add_line": "  - \\"[[新規ノートのタイトル]]\\"", "where_hint": "frontmatter related:"}\`
   related_hits が空配列なら backlink_edits も空配列。**作業レポート・事実 は tags に 気づき / 洞察 を付けない** (トピックタグのみ・script 側の機械検証でも検査される)。
4. 各候補に inbox_origin = \`${f.path}\` を埋める (集約段の照合キー)。
5. この inbox のファイル名が昇格で変わる/分割される場合、元 inbox 名を wikilink で指す既存ノートを ${backlinkCmd} で機械的に洗い old_name_referrers に返す (path のリスト。0 ヒットなら空配列。同名昇格なら洗わなくてよい)。**Phase 4 で drainExtract が廃止されたため reportExtract が referrers の唯一の供給源**——本 agent では report_promotions が 0 件でも (taskDoneExtract や skill 本体側の気づき抽出が inbox 名を変える場合があるので) 必ず referrers の洗い出しは実行する。**referrers の洗い出しを実行した場合は referrers_scanned=true で明示申告し、(同名昇格と判断して) skip した場合は referrers_scanned=false で明示する** (集約段が「scan して 0 件」と「skip して 0 件」を区別するため・R2-8)。

捏造補完しない: 素材に無い感覚・詳細を想像で埋めない。

MCP 不達時の fallback: MCP tool 呼び出しで exception が出た場合 (network error / server down / timeout / unreachable 等) は Grep (\`rg '<query>' ${VAULT}/notes\` 等) に retreat し処理を継続する。失敗したまま止めない。fallback した呼び出しごとに \`log('MCP_FALLBACK: <tool> <reason>')\` を 1 行出してから続行する (script 側でカウンタを持たないので grep で頻度を後から数える)。
${rulesRef('vault 規約', '命名規約 (kind 共通の核)')}`
}

// Phase 3: taskDoneExtract agent (タスク done パート) のプロンプト。元の 4 系統併合抽出 prompt から タスク抽出 + done 検出責務を
// 切り出し、inbox 1 件を単独で読み込み (a) 新規タスク候補と (b) 既存タスクの done 候補を構造化して返す。Phase 4 以降は
// reportExtract と並列起動 (script の pipeline + Promise.all で 1 inbox=2 agent fan-out)・気づき抽出は skill 本体側で
// 並列に動く (本 agent からは見えない)。責務順序強制 (まず done → 残りからタスク抽出)・MCP 突き合わせ・MCP fallback 規約は
// 元の併合 prompt から該当箇所を継承する。既存タスクノート一覧 (open_tasks) はこの agent にだけ渡る (done 突き合わせ素材)。
function taskDoneExtractPrompt(f, openTasksList) {
  const hasContent = !!(f.content && f.content.length)
  const bodySection = hasContent
    ? `--- 内容ここから ---\n${f.content}\n--- 内容ここまで ---`
    : `本文取得: Read tool で \`${f.path}\` を開き、本文を加工せず subagent context 内で扱う。**読んだ全文を戻り値に再掲しない** (集約段が肥大化する。逐語が要るのは source_excerpt と done 候補の evidence_quote だけ)。`
  const openTasksSection = (openTasksList && openTasksList.length)
    ? `既存タスクノート一覧 (done 候補検出の突き合わせ素材。これ以外を done 候補にしない):\n${openTasksList.map((t) => `- ${t.path}${t.title ? ` — ${t.title}` : ''}`).join('\n')}`
    : '既存タスクノート一覧: (なし。done 候補は 0 件のまま返す)'
  return `あなたは vault inbox 排出 (drain) の **タスク抽出 + 完了 (done) 検出担当**。以下の inbox ノート 1 件を読み、(a) notes/ へ新規昇格させる **タスク (未着手の行動) 候補** と (b) 既存タスクの **完了 (done) 候補** を構造化して返せ。ファイルへの書き込みは一切しない (Read/Grep/Glob のみ。Write は呼び出し元の責務)。

vault: ${VAULT}
inbox ノート: ${f.path}
${bodySection}

${openTasksSection}

**責務の限定 (Phase 3 で分離された タスク done パート)**:
- あなたは **タスク (未着手の行動) と done 候補のみ** を返す。schema enum で task_promotions の kind は タスク 以外を表現できないが、念のため指示。
- 気づき (主観的な学び・判断・教訓・方針) は **skill 本体側 (drain SKILL.md) の気づき抽出担当の責務**なので本 agent では切り出さない。
- 作業レポート・事実 (調査記録・1:1 昇格対象) は **並行する reportExtract agent の責務**なので本 agent では切り出さない。
- 同一 inbox は reportExtract と並列 (workflow 内) ＋ skill 本体側の気づき抽出と並列 (workflow 外) で処理される——あなたの戻りに気づき/作業レポートを混ぜない (他 agent と重複する)。

**責務の順序強制と排他**:
- まず **done 検出**: Read した inbox 本文と上の既存タスクノート一覧を突き合わせ、完了示唆 (「X 完了」「やった」「実装した」「やることが満たされた」等が plain に読める) のあるタスクを done_candidates に返す。evidence_quote は **inbox 本文中の逐語引用** (要約・言い換えは集約段の包含照合に落ちる)。basis は「やることのどの項目が満たされたか」の説明。quote_verified は **subagent 自身が evidence_quote の inbox 本文への包含を確認した真偽** (true なら集約段の再照合も通る前提・false なら確認に落ちた)。inbox_origin は処理中の inbox path = \`${f.path}\` を埋める。
- **残り**で タスク 候補を組み立てる: done 検出で拾った既存タスクの完了示唆は **task_promotions に含めない**。それ以外の素材から新規タスク候補を組み立てる。
- **排他指示**: 同じ記述を done_candidates と task_promotions の両方に出さない。done 候補に該当する記述は done_candidates にだけ出す (集約段で同じ inbox_origin から両者が出ると DUPLICATE_DETECTED が立つ)。
- task_promotions の各候補に inbox_origin = \`${f.path}\` を埋める (集約段の DUPLICATE_DETECTED 照合キー)。

手順:
1. **done 検出を最初に行う** (上記順序強制)。既存タスクノート一覧から完了示唆のあるものを done_candidates として返す。
2. 残りの記述から、未着手の行動を kind=タスク で抽出する。ラベルは ① 明示 TODO (「TODO」「未実施」「やる」等が plain にある) / ② 次タスク候補 (「次は〜」等の先送り表明) / ③ ノート分析で出た課題 (論理ギャップ・矛盾・未解決。why_important 必須)。
3. 各タスク候補について vault 既存ノードを突き合わせ、関連ノート・既出を洗う。一次索引は MCP tool 経由で動的に引く (常時ロードのカタログは持たない・subagent には届かない)。
   - タイトル一致・意味近傍: \`mcp__vault-catalog__search_hybrid(query=候補タイトル, limit=12)\` を呼ぶ。返る hits の path/title/tags/body_snippet を見て当たりを付ける (index は section 粒度で同一ノートが複数 hit を占めるため、limit は distinct ノート数より多めに取る)。
   - 既存タスクとの突き合わせ: 上記 open_tasks 一覧も近傍判定の入口にする。同一物の確認は Read して本文を見る。
   - fold 判定や本文確認が要るものだけ Read する (全 notes の Grep fan-out はしない)。
   - **MCP 結果は近傍候補であって fold 判定の根拠ではない**。fold を判断するなら必ず本文を Read して同一物であることを確認する (MCP の曖昧 hit を fold 根拠に取り違えない)。
   - MCP 該当が無く Read でも既存に該当が見つからなければ新しい主題＝新規候補。
4. 新規タスク候補は content に frontmatter＋本文の完成形を書く (## やること を「- 」箇条書きで・チェックボックス \`- [ ]\` 禁止・ラベル ③ は ## 元ノート(なぜ重要) を含む)。関連既存ノード側からの逆リンク 1 行を backlink_edits に列挙する (双方向リンク。関連が実在するものだけ・弱い繋がりを強引に張らない)。
5. この inbox のファイル名が昇格で変わる/分割される場合に元 inbox 名を wikilink で指す既存ノートの洗い出し (old_name_referrers) は **reportExtract agent の責務** (本 agent では行わない・Phase 4 で drainExtract が廃止されて以降 reportExtract が唯一の referrers 供給源)。

捏造補完しない: 素材に無い感覚・詳細を想像で埋めない。

MCP 不達時の fallback: MCP tool 呼び出しで exception が出た場合 (network error / server down / timeout / unreachable 等) は Grep (\`rg '<query>' ${VAULT}/notes\` 等) に retreat し処理を継続する。失敗したまま止めない。fallback した呼び出しごとに \`log('MCP_FALLBACK: <tool> <reason>')\` を 1 行出してから続行する (script 側でカウンタを持たないので grep で頻度を後から数える)。
${rulesRef('vault 規約', '命名規約 (kind 共通の核)')}`
}

function backfillPrompt() {
  return `あなたは backfill (過去期間の遡り蒸留) の素材収集担当。ファイルへの書き込みは一切しない (Read/Grep/Glob のみ)。

vault: ${VAULT}
対象期間: ${PERIOD.from} 〜 ${PERIOD.to}

手順:
1. notes/ の frontmatter createdAt が期間内のノートを Grep で洗い、period_pages に path / 1 行要旨 (gist) / frontmatter tags の全要素 (tags) / 本文の逐語 (body) を返す (createdAt を正とする。filesystem の時刻は使わない——mv で birthtime がずれる)。body は done sweep の証拠照合の母体になるので要約・truncate せず原文全文を返す (長大でも省略しない。完了記述が truncate されると後段 done 判定の引用が照合に落ちる)。
2. 期間内の notes/<YYYY-MM-DD>.md の「## 作業メモ」に手書き記述があれば journal_notes に抜粋を返す (空の日も多い。空を想像で埋めない)。
3. タスク抽出は ① 明示 TODO のみ (ノート本文に TODO/未実施/やる 等が plain にある未着手記述)。②③ は抽出しない (過去日の感覚を想像で埋める捏造リスク。schema 上も ① しか表現できない)。

気づき(A) の新規ノード化はこのモードでは行わない (会話文脈が無く捏造になる)。過去 journal を埋めることもしない。done 判定はこの agent では行わない (後段の専用 done agent が period_pages の body を素材に証拠ベースで判定する)。
${rulesRef('vault 規約', '命名規約 (kind 共通の核)')}`
}

function insightPrompt(newNotesList, extraMaterial) {
  const backfillFocus =
    MODE === 'backfill'
      ? `

backfill の主眼 (このモードの洞察の取り分): 即時 drain は新着ノードが片足でも乗る関係を発火時に回収済み。backfill が拾うのはその残差——全構成ノードが過去に drain 済みで「今になって繋がって見える」創発メタ・既存洞察の束ね直し・高次の再発パターンである。具体的には (a) 期間内に独立して立った複数の気づき/洞察が後から見ると同じ機序を指している束ね直し、(b) 過去の洞察と同じ筋の再発それ自体を一段上の「再発パターン」として名指す洞察、を主に探す。単発で発火しなかった narrow な創発だけが残差なので、無理に数を作らない (0 件も正当)。`
      : ''
  return `あなたは洞察(B) の検出担当。「個別には既知だが、繋ぐと第三の知見が出る」関係だけを洞察候補として返せ。ファイルへの書き込みは一切しない (Read/Grep/Glob のみ)。

vault: ${VAULT}

今回の新規/更新ノード (タスクは素材に含めない——層が違う。タスク由来の論点は背景の元ノート側を素材にする):
${newNotesList || '(なし)'}

${extraMaterial}
${backfillFocus}

手順:
1. 繋がりを探す対象は (a) 今回の新規ノード同士 (上記「今回の新規/更新ノード」の #気づき/#洞察 を束ねる)、(b) 新規ノードと既存ノート (notes/ の #気づき #洞察・概念ノート) の両方。同じバッチで立った新規 #気づき も source 候補に含めてよい——特に drain は 1 inbox から複数の気づきが同時に立つので、それらを束ねた洞察がこのフェーズの主な取り分になる (新規気づきはまだファイル化されていないが、承認後に notes/ に作られる前提で source 候補にしてよい)。入口は MCP tool 経由で動的に引く (常時ロードのカタログは持たない・subagent には届かない)。
   - 新規ノードの claim・タイトルを query にして \`mcp__vault-catalog__search_hybrid(query=claim, limit=12)\` を呼び、関連既存ノードを取得する (index は section 粒度で同一ノートが複数 hit を占めるため、limit は distinct ノート数より多めに取る)。
   - タグ近傍で気づき/洞察ノードを洗うときは \`mcp__vault-catalog__search_by_tag(tags=["気づき"], limit=20)\` / \`mcp__vault-catalog__search_by_tag(tags=["洞察"], limit=20)\` を呼ぶ。
   - MCP で近傍を絞ってから、繋がりの確証に要るノートだけ Read する (全 notes の Grep fan-out はしない)。**MCP 結果は近傍候補であって洞察の根拠ではない**——claim の元になる繋がりは Read した本文で確証する。
   - MOC/洞察.md (Dataview 集約) は MCP に乗らないため、束ね起点として要るときは Read で入口に使う。
   - backfill mode では上記に加え、期間素材の path/gist を入口に Grep/Read で本文を辿る (backfillFocus 節と整合)。
2. 単一観測・単一ノートの感想は洞察ではない (それは気づき止まり)。繋いで初めて見える第三の知見だけ。既出洞察の焼き直しも作らない。「過去の洞察と同じ筋」の再発はそれ自体が再発パターンの洞察になりうる。
3. 各候補: claim に洞察を一文で言い切る (複文可)。**title は claim からでなく、手順 5(3) で導く derivation.common_axis を判断軸の形で言い切ったものにする** (claim 起点は失敗形/内的手順に流れ命名ゲートを通らない——common_axis を先に確定させてから命名する。順序: derivation→common_axis→命名)。connected_notes に繋いだ実在ノートの path (実在を Read で確認する)。content は templates/insight.md の構造 (AI Context callout / ## 見えた洞察 / ## なぜ重要 / ## 応用・次アクション) で frontmatter＋本文の完成形。source: に繋いだ元ノートを '  - "[[ノート名]]"' 形式で列挙。
4. source の規律 (満たせない候補は出さない):
   - 洞察は複数 (2 件以上) の #気づき / #洞察 ノードから生まれる。単一ノート由来は洞察ではない (気づき止まり)。source に列挙できるのは #気づき / #洞察 ノードだけで、タスク・作業レポート・事実/仕様ノートは source にしない (それらを本文 wikilink や connected_notes で参照するのは可)。**同じバッチの新規 #気づき / #洞察 もこの「#気づき / #洞察 ノード」に含む**——source: には wikilink (\`[[タイトル]]\`) で、connected_notes には承認後の path (\`notes/<タイトル>.md\`) で列挙する。この新規分だけは Read 実在確認を免除する (newNotesList に在ることが実在の代わり。既存ノートは従来どおり Read で実在確認)。
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

命名訂正事例集: \`~/.claude/skills/drain/naming-corrections.md\` を Read し、収載された訂正ペアの訂正方向 (何が指摘され、どう直ったか) にだけ倣って命名する (事例の主張内容はなぞらない)。命名の確定前に「別の cycle で観察したらどう書くか」を自問し、今回の素材に固有の語彙へ張り付いた命名を避ける。

繋がりが弱ければ 0 件が正当な出力 (「A 止まりですらない」もありうる)。無理に B をでっち上げない。

MCP 不達時の fallback: MCP tool 呼び出しで exception が出た場合は Grep に retreat し処理を継続する (Obsidian 起動時は \`obsidian tag name=気づき / name=洞察\` で実タグ索引、未起動なら frontmatter 形式に当てる multiline rg: \`rg -l --multiline -U '(?s)^---\\n(.*?\\n)*?tags:\\n(\\s*-\\s+[^\\n]*\\n)*\\s*-\\s+気づき' ${VAULT}/notes\` — inline #気づき タグだけを当てる \`rg -l '#気づき'\` は frontmatter 形式を取り逃すので使わない)。失敗したまま止めない。fallback した呼び出しごとに \`log('MCP_FALLBACK: <tool> <reason>')\` を 1 行出してから続行する。
${rulesRef('vault 規約', '命名規約 (kind 共通の核)', '洞察の命名')}`
}

function donePrompt(corpus) {
  // タグ列挙コマンドと progress 判定手段は script が決定論で解決する (起動判定は呼び出し側が渡した flag)。agent は実行のみ。
  const taskListing = OBSIDIAN_AVAILABLE
    ? 'obsidian tag name=タスク の ^notes/ 行で tags に タスク を含むノートを洗い (実タグ索引で速く・過剰一致しない)'
    : 'notes/ を Grep して tags に タスク を含むノートを洗い'
  const progressCheck = OBSIDIAN_AVAILABLE ? 'obsidian property:read name=progress path=<path> または各ノートの frontmatter を Read' : '各ノートの frontmatter を Read'
  return `あなたは既存タスクの完了検出担当。vault の未完了タスクノートを洗い、下の作業素材に完了の証拠があるものだけ返せ。書き込みはしない。

vault: ${VAULT}
未完了タスクの洗い方: ${taskListing}、progress が done でないものを特定し (progress 判定は ${progressCheck})、各ノートの ## やること を Read する。

作業素材 (この中の逐語引用だけが証拠になる):
--- 素材ここから ---
${corpus}
--- 素材ここまで ---

判定は証拠ベース: 「やることが満たされた」「〜は完了した」と読める記述の逐語引用を evidence_quote に返す (script が素材への包含を機械照合する。要約・言い換えは照合に落ちる)。推測で done 候補にしない。該当なしなら空配列が正当。`
}

// ============================================================
phase('素材整理')
log(`mode=${MODE} / 素材: ${MODE === 'drain' ? INBOX_FILES.length + ' inbox files' : `${PERIOD.from}〜${PERIOD.to}`}`)

let candidates = []
let linkRewrites = []
let backfillMaterial = null
let corpus = '' // done 検出の証拠照合用テキスト (script が手元に持つ素材だけが照合対象)。drain では未使用 (taskDoneExtract subagent が素材整理段で並列に done 検出する)
let drainDoneCandidates = [] // drain mode の done 候補は taskDoneExtract subagent が返したものを flatten する (donePrompt は呼ばない)
// Phase 4: drainExtract (気づき) は skill 本体側に移管したので flags.extraction_failed は廃止。
// report_extraction_failed / task_done_extraction_failed の 2 軸で workflow 側の失敗を追う。
// 気づき抽出 / 洞察検出の失敗は skill 本体側で追跡する (workflow には流れない)。
const flags = { report_extraction_failed: [], task_done_extraction_failed: [], report_referrers_skipped: [], insight_failed: false, done_failed: false, done_skipped_no_reports: false }

if (MODE === 'drain') {
  // Phase 4: drainExtract (気づき) は skill 本体側に移管 (命名は抽出 prompt 内 self-check + shape コード検査)。
  // workflow は taskDoneExtract (タスク+done) / reportExtract (作業レポート・事実) の 2 並列で
  // inbox ごとに fan-out する (Phase 3 の 3 並列から Phase 4 で 2 並列に縮小)。
  // 2 agent の戻りが揃った時点で promotions を merge して命名ゲートに流す (他 inbox の抽出を待たない)。
  // 各 agent の戻りは独立に処理し、いずれかが失敗してもこの inbox の処理を止めない (フォールバック構造)。
  await pipeline(
    INBOX_FILES,
    async (f) => {
      const [tex, rex] = await Promise.all([
        agent(taskDoneExtractPrompt(f, OPEN_TASKS), {
          schema: TASK_DONE_EXTRACT_SCHEMA,
          model: M_EXTRACT,
          label: `taskDoneExtract:${f.path.split('/').pop()}`,
          phase: '素材整理',
        }),
        agent(reportExtractPrompt(f), {
          schema: REPORT_EXTRACT_SCHEMA,
          model: M_EXTRACT,
          label: `reportExtract:${f.path.split('/').pop()}`,
          phase: '素材整理',
        }),
      ])
      return { tex, rex }
    },
    async ({ tex, rex }, f) => {
      const mergedPromotions = []
      const mergedOldNameReferrers = new Set()
      const doneCands = []

      if (!tex) {
        flags.task_done_extraction_failed.push(f.path)
      } else {
        for (const c of tex.task_promotions || []) {
          // inbox_origin はプロンプトで埋めさせているが、念のため script 側でも保証する (集約段の DUPLICATE_DETECTED 照合キー・belt-and-suspenders)
          if (!c.inbox_origin) c.inbox_origin = f.path
          mergedPromotions.push(c)
        }
        for (const d of tex.done_candidates || []) {
          if (!d.inbox_origin) d.inbox_origin = f.path
          doneCands.push(d)
        }
      }

      if (!rex) {
        flags.report_extraction_failed.push(f.path)
      } else {
        for (const c of rex.report_promotions || []) {
          if (!c.inbox_origin) c.inbox_origin = f.path
          // 純関数で関連認定 / fold 候補認定 (LLM の「当たり付け」判断を script の決定論判定に置換)。
          // agent 戻りの related_hits が undefined のときも空配列に正規化してから scoreRelatedness に渡す (欠落耐性)。
          const sr = scoreRelatedness(c.related_hits || [])
          c.related = sr.related
          c.fold_candidates = sr.fold_candidates
          // finding 1 fix: agent は related_hits の全 distinct path に backlink_edits を機械生成するため、
          // c.related (純関数で閾値判定済みの path 集合) でフィルタしないと、閾値未満で関連認定されなかった hit にも
          // frontmatter `related:` への追記が走る。plan.md Acceptance「機械判定された関連リストを受け取り backlink_edits を生成する」
          // と直接矛盾するため、ここで閾値未満の hit を機械的に drop する。
          c.backlink_edits = (c.backlink_edits || []).filter((be) => c.related.includes(be.path))
          mergedPromotions.push(c)
        }
        // Phase 4: drainExtract 廃止後は reportExtract が唯一の referrers 供給源
        for (const ref of rex.old_name_referrers || []) mergedOldNameReferrers.add(ref)
        // R2-8 / R3-11: referrers_scanned=false (skip 申告) は「scan して 0 件」と区別不能なので、rex 成功時でも
        // archive 退避除外対象として flag に push する (rename を伴う昇格は次回 drain へ持ち越し)。
        // R3-11 で `report_extraction_failed` (真の rex 失敗) と `report_referrers_skipped` (referrers 走査 skip) を 1 軸に
        // 乗せていた混在計上を解消し、archive 退避除外は両 flag の和集合で判定する (skill 本体側 4.7 step 4 で合算)。
        if (rex.referrers_scanned === false) flags.report_referrers_skipped.push(f.path)
      }

      // 同一 inbox の候補 (taskDoneExtract+reportExtract の merge) は揃った時点で即ゲートに流す (他 inbox の抽出を待たない)
      await parallel(mergedPromotions.filter(needsGate).map((c) => () => runGate(c)))
      candidates.push(...mergedPromotions)
      drainDoneCandidates.push(...doneCands)
      if (mergedOldNameReferrers.size) linkRewrites.push({ inbox: f.path, referrers: [...mergedOldNameReferrers] })
    },
  )
} else {
  // backfill: 期間素材を収集し、done sweep の corpus を作業レポート系ノート本文から script が組む
  const r = await agent(backfillPrompt(), { schema: BACKFILL_SCHEMA, model: M_EXTRACT, label: 'backfill-collect', phase: '素材整理' })
  if (!r) throw new Error('backfill 素材収集 agent が結果を返さなかった')
  const periodPages = r.period_pages || []
  backfillMaterial = { period_pages: periodPages, journal_notes: r.journal_notes }
  // done sweep の corpus: 作業レポート系ノート (気づき/洞察/タスク タグを持たない無印) の本文だけを
  // script が決定論フィルタで組む (LLM に「どれが作業レポートか」を委ねない)。証跡は揮発しない期間内 notes 本文。
  const reportPages = periodPages.filter((p) => !(p.tags || []).some((t) => LAYER_TAGS.includes(t)))
  corpus = reportPages.map((p) => `===== ${p.path} =====\n${p.body || ''}`).join('\n')
  // backfill の主眼は done reconcile。作業レポート系ノートが期間内に 0 件だと corpus 空で done-scan が走れない。
  // 「走査して 0 件」と「対象ゼロで走らせていない」を戻りで区別するため明示フラグを立てる (decision: 決定論の件数判定)。
  if (reportPages.length === 0) flags.done_skipped_no_reports = true
  // schema enum (['①']) で ②③ は表現不能だが、script 側でも二重に防御する
  candidates = r.candidates.filter((c) => c.kind !== 'タスク' || c.label === '①')
  await parallel(candidates.filter(needsGate).map((c) => () => runGate(c)))
  log(`done sweep corpus: 作業レポート系 ${reportPages.length} 件 / 期間内 notes ${periodPages.length} 件`)
  if (flags.done_skipped_no_reports) log('期間内に作業レポート系ノート (無印) が無く done sweep をスキップ (reconcile 対象ゼロ)')
}
log(`素材整理: 候補 ${candidates.length} 件 (うち fold ${candidates.filter((c) => c.fold_into).length})`)

// ============================================================
// Phase 4: drain の洞察検出は skill 本体側に移管した (Agent tool で insight-detect agent を spawn。命名は
// prompt 内 self-check + shape コード検査)。workflow では backfill mode のみ洞察検出を実行する。
phase('洞察検出')
if (MODE === 'drain') {
  log('drain mode: 洞察検出は skill 本体の責務 (insight-detect agent を skill 側で spawn) — workflow ではスキップ')
} else {
  // backfill: 期間素材を入口に洞察検出を回す。新規ノード一覧 (period_pages の #気づき/#洞察 起点) を素材として渡す。
  const nonTask = candidates.filter((c) => c.kind !== 'タスク')
  const newNotesList = nonTask
    .map((c) => `- [${c.kind}] ${c.title}${c.fold_into ? ` (→ ${c.fold_into} へ畳む)` : ''}`)
    .join('\n')
  // body 全量は注入しない (done sweep の証跡照合は corpus 側が full body で担うので insight に body は不要)。
  // period_pages を {path, gist} に絞った軽量版＋journal_notes だけ渡す (広期間でのトークン肥大を避ける)。
  const lightMaterial = {
    period_pages: (backfillMaterial.period_pages || []).map((p) => ({ path: p.path, gist: p.gist })),
    journal_notes: backfillMaterial.journal_notes,
  }
  const extraMaterial = `期間素材 (path と 1 行要旨の一覧。これを入口に Grep/Read で本文を辿る):\n${JSON.stringify(lightMaterial, null, 2)}`

  const ir = await agent(insightPrompt(newNotesList, extraMaterial), {
    schema: INSIGHT_SCHEMA,
    model: M_INSIGHT,
    label: 'insight-detect',
    phase: '洞察検出',
  })
  if (!ir) {
    flags.insight_failed = true
  } else {
    const insights = ir.insights
    for (const i of insights) {
      i.kind = '洞察'
      i.label = 'none'
      i.fold_into = ''
      // 命名は common_axis から導く (title=判断軸)。命名点検 (nameGate) の元記述に claim でなく common_axis を渡す
      // ——claim 起点だと失敗形/内的手順に流れ命名ゲートを通らない (失敗接地 2026-06-15: ID8 を claim/手元の像で
      // 命名し④内的手順・存在論言い直しで 2R 未解決→common_axis 起点で 2R 通過)。common_axis 欠落時のみ claim に退避。
      i.source_excerpt = i.derivation && i.derivation.common_axis && i.derivation.common_axis.trim() ? i.derivation.common_axis : i.claim
      // 導出チェックリストが毎回実施されたかを機械チェック (自己申告でなく出力の充足で検証)。
      // source_avoidances は 2 件以上 (洞察は 2+ source)・common_point/common_axis 非空。未充足は triage で明示する。
      const d = i.derivation || {}
      i.derivation_ok =
        Array.isArray(d.source_avoidances) &&
        d.source_avoidances.filter((s) => s && s.trim()).length >= 2 &&
        !!(d.common_point && d.common_point.trim()) &&
        !!(d.common_axis && d.common_axis.trim())
    }
    await parallel(insights.map((i) => () => runGate(i)))
    candidates.push(...insights)
  }
  log(`洞察検出: ${ir ? ir.insights.length : '失敗'} 件`)
}

// ============================================================
phase('タスク・完了検出')
let doneCandidates = []
let duplicateDetected = []
if (MODE === 'drain') {
  // drain は素材整理段で taskDoneExtract subagent が done 検出責務を担う (Phase 3 で drainExtract から分離・並列実行)。
  // donePrompt 呼び出しは廃止 (v6 plan)。quote_verified は taskDoneExtract subagent の自己申告のみ。workflow 側の再照合は
  // v6 plan で廃止 (drain mode では full inbox 本文が workflow に流れず再包含照合できない・本格的な再照合 Read agent は
  // YAGNI で別 cycle 候補)。schema で quote_verified は boolean 確定済みなのでそのまま使う。
  doneCandidates = drainDoneCandidates
  // DUPLICATE_DETECTED: 同じ inbox_origin から done_candidates と task_promotions の両方が候補を出した場合の重複検出ログ。
  // taskDoneExtract agent 内 order 強制 + 排他指示のフェイルセーフ。
  // Phase 3 narrow: 母集団を task_promotions ↔ done_candidates の 2 系統交差に絞った (作業レポート・気づき由来の共起は
  // 層違いの false positive なので除外する・plan L178)。Phase 2 までは全 promotions を母集団にしていたが、reportExtract
  // 分離で false positive 母集団が拡大したため Phase 3 で narrow。
  const taskPromotions = candidates.filter((c) => c.kind === 'タスク')
  for (const d of doneCandidates) {
    const hits = taskPromotions
      .filter((c) => c.inbox_origin === d.inbox_origin)
      .map((c) => ({ kind: c.kind, title: c.title }))
    if (hits.length) {
      duplicateDetected.push({ inbox_origin: d.inbox_origin, done_task_path: d.task_path, conflicting_promotions: hits })
    }
  }
  // 統計: quote_verified 件数と evidence_quote 長さ分布
  const verifiedCount = doneCandidates.filter((d) => d.quote_verified).length
  const quoteLengths = doneCandidates.map((d) => (d.evidence_quote || '').length)
  const avgQuoteLen = quoteLengths.length ? Math.round(quoteLengths.reduce((a, b) => a + b, 0) / quoteLengths.length) : 0
  log(
    `done 候補 (drain・taskDoneExtract 出力): ${doneCandidates.length} 件 (quote_verified true ${verifiedCount} / evidence_quote 平均長 ${avgQuoteLen})`,
  )
  if (duplicateDetected.length) {
    log(`DUPLICATE_DETECTED: ${duplicateDetected.length} 件 (task_promotions と done_candidates が同じ inbox_origin から出た組)`)
    for (const dup of duplicateDetected) {
      log(`  - inbox=${dup.inbox_origin} done=${dup.done_task_path} task_promotions=${dup.conflicting_promotions.map((p) => p.title).join(', ')}`)
    }
  }
} else {
  // backfill は期間内作業レポート本文が corpus。corpus が空なら done sweep をスキップ (証拠ゼロ)。
  if (corpus) {
    const dr = await agent(donePrompt(corpus), { agentType: 'Explore', schema: DONE_SCHEMA, model: 'sonnet', label: 'done-scan', phase: 'タスク・完了検出' })
    if (!dr) {
      flags.done_failed = true
    } else {
      doneCandidates = dr.done_candidates.map((d) => ({
        ...d,
        quote_verified: !!d.evidence_quote && corpus.includes(d.evidence_quote.trim()),
      }))
    }
  }
  if (flags.done_skipped_no_reports) {
    log('done 候補: 走査せず (期間内に作業レポート系ノートが無く reconcile 対象ゼロ)')
  } else {
    log(`done 候補: ${doneCandidates.length} 件 (引用照合落ち ${doneCandidates.filter((d) => !d.quote_verified).length})`)
  }
}

// ============================================================
phase('集計')
// 候補またぎの旧タイトル参照を最終タイトルへ一括張り替え。
// renameCandidate は自候補内 (content/backlink_edits) しか直さないため、別候補が旧タイトルで張ったリンク
// (作業レポートの本文リンク・洞察の source/connected_notes・他候補への backlink_edits.path) が残る。
// 命名ゲート確定後に全候補へ全 rename ペアを冪等適用する (自候補分の再適用は無害)。fix 前に行い fix 入力を正にする。
const renamePairs = candidates
  .filter((c) => c.gate && c.gate.initial_title && c.gate.initial_title !== c.title)
  .map((c) => ({ from: c.gate.initial_title, to: c.title }))
if (renamePairs.length) {
  // path 置換は境界一致で行う (失敗接地: 単純 split('${from}.md') では from='メタ' で
  // 'notes/古いメタ.md' も誤マッチして 'notes/古い<to>.md' に書き換わる。Phase 4 で
  // rename 頻度が上がるほど影響が広がるため、from の直前が path 先頭 (^) または
  // path separator (/) の場合のみ置換する)。RegExp は pre-compile で hot path のコスト縮約。
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // to を escape: $ を $$ に置換 (replace template の $ 補間回避)。$1 capture-group reference は意図的なので保持。
  // 失敗接地: simplify で pre-compile した path 置換が String.prototype.replace の第 2 引数で template 解釈され、
  // to に `$&` `$$` `$1`〜`$9` が含まれると展開されて誤書換になる (R2-1)。
  const renameOps = renamePairs.map(({ from, to }) => ({
    wikiFrom: `[[${from}]]`,
    wikiTo: `[[${to}]]`,
    pathRegex: new RegExp('(^|/)' + escapeRegex(from) + '\\.md', 'g'),
    pathTo: '$1' + to.replace(/\$/g, '$$$$') + '.md',
  }))
  const swapRefs = (s) => {
    if (!s) return s
    for (const op of renameOps) {
      s = s.split(op.wikiFrom).join(op.wikiTo) // wikilink (本文・source frontmatter・add_line)
      // ファイルパス (backlink_edits.path・connected_notes): from の直前が ^ または / の場合のみ置換 (境界一致)。
      s = s.replace(op.pathRegex, op.pathTo)
    }
    return s
  }
  for (const c of candidates) {
    c.content = swapRefs(c.content)
    for (const e of c.backlink_edits || []) {
      e.add_line = swapRefs(e.add_line)
      e.path = swapRefs(e.path)
    }
    if (Array.isArray(c.connected_notes)) c.connected_notes = c.connected_notes.map(swapRefs)
  }
}
await parallel(candidates.map((c) => () => fixAndRevalidate(c)))
candidates.forEach((c, i) => {
  c.id = i + 1
})

const totals = {
  count: candidates.length,
  kizuki: candidates.filter((c) => c.kind === '気づき' && !c.fold_into).length,
  insights: candidates.filter((c) => c.kind === '洞察').length,
  tasks: candidates.filter((c) => c.kind === 'タスク').length,
  reports: candidates.filter((c) => c.kind === '作業レポート・事実').length,
  folds: candidates.filter((c) => c.fold_into).length,
  renamed: candidates.filter((c) => c.gate && c.gate.final_title !== c.gate.initial_title).length,
  gate_unresolved: candidates.filter((c) => c.gate && (c.gate.unresolved || c.gate.undecidable)).length,
  validation_failed: candidates.filter((c) => (c.validation_errors || []).length).length,
  insights_derivation_incomplete: candidates.filter((c) => c.kind === '洞察' && !c.derivation_ok).length,
  kizuki_derivation_incomplete: candidates.filter((c) => c.kind === '気づき' && !c.fold_into && !c.derivation_ok).length,
  done_candidates: doneCandidates.length,
  duplicate_detected: duplicateDetected.length,
}
if (flags.report_extraction_failed.length) log(`REPORT_EXTRACTION_FAILED: ${flags.report_extraction_failed.length} 件 (rex agent が結果を返さなかった inbox)`)
if (flags.report_referrers_skipped.length) log(`REPORT_REFERRERS_SKIPPED: ${flags.report_referrers_skipped.length} 件 (rex 成功・referrers 走査 skip の inbox・rename を伴う昇格は次回 drain へ持ち越し)`)
if (flags.task_done_extraction_failed.length) log(`TASK_DONE_EXTRACTION_FAILED: ${flags.task_done_extraction_failed.length} 件 (失敗した inbox)`)
// Phase 4: 集計 log を mode 別に書き分ける。drain mode では workflow を流れるのが reports + tasks のみで
// 気づき・洞察 は skill 本体側で処理される (workflow の totals.kizuki / totals.insights は 0 確定)。
// 外部 tool (運用ログ追跡) が「気づき・洞察 0 件」を恒常的に拾わないよう、drain と backfill で log 文言を分ける。
if (MODE === 'drain') {
  log(
    `集計: ${totals.count} 候補 (タスク ${totals.tasks} / レポート・事実 ${totals.reports} / fold ${totals.folds}) 再命名 ${totals.renamed} / ゲート未解決 ${totals.gate_unresolved} / 検証落ち ${totals.validation_failed} / 重複検出 ${totals.duplicate_detected} ※気づき・洞察 は skill 本体側で算出 (workflow 経路では totals.kizuki / totals.insights とも 0 確定)`,
  )
} else {
  log(
    `集計: ${totals.count} 候補 (気づき ${totals.kizuki} / 洞察 ${totals.insights} / タスク ${totals.tasks} / レポート・事実 ${totals.reports} / fold ${totals.folds}) 再命名 ${totals.renamed} / ゲート未解決 ${totals.gate_unresolved} / 検証落ち ${totals.validation_failed} / 洞察導出未完 ${totals.insights_derivation_incomplete} / 気づき導出未完 ${totals.kizuki_derivation_incomplete} / 重複検出 ${totals.duplicate_detected}`,
  )
}

// Phase 2: LLM Wiki パート (作業レポート・事実) の per_part metric を確定。Phase 2 受入条件 (plan.md L162-166):
// 命名ゲート通過率系・renamer 起動 0 件の確認系・規約検証エラー率系を、実装で観測可能な項目として埋める。
const reportItems = candidates.filter((c) => c.kind === '作業レポート・事実')
const reportNonFold = reportItems.filter((c) => !c.fold_into)
const reportGated = reportNonFold.filter((c) => c.gate)
const llmWikiMetrics = {
  count: reportItems.length,
  fold_count: reportItems.length - reportNonFold.length,
  gate_total: reportGated.length,
  gate_passed: reportGated.filter((c) => !c.gate.unresolved && !c.gate.undecidable).length,
  gate_unresolved: reportGated.filter((c) => c.gate.unresolved).length,
  gate_undecidable: reportGated.filter((c) => c.gate.undecidable).length,
  // light gate のサニティチェック: rounds は常に 1・renamer は呼ばれないので initial_title === final_title が常に成り立つ
  gate_rounds_max: reportGated.reduce((m, c) => Math.max(m, c.gate.rounds || 0), 0),
  renamer_invocations: reportGated.filter((c) => c.gate.final_title !== c.gate.initial_title).length,
  validation_failed: reportItems.filter((c) => (c.validation_errors || []).length).length,
}

// Phase 3: タスク done パートの per_part metric を確定。Phase 3 受入条件 (plan.md L179):
// quote_verified false 率系・done/task 件数系・DUPLICATE_DETECTED 系を、実装で観測可能な項目として埋める。
// 構造は llm_wiki と類似 (件数 / fold / gate 通過分布 + kind 固有の failure 件数) だが、項目構成は kind 特性 (done quote_verified / duplicate_detected / task_done_extraction_failed) に応じて llm_wiki とは異なる。
// drain mode では taskDoneExtract 由来・backfill mode では backfillPrompt + donePrompt 由来の候補が同 metric に集計される
// (task_count / done_count とも mode 非依存で kind=タスク 件数・done_candidates 件数を数えるため、backfill mode でも非零になる)。
// duplicate_detected / task_done_extraction_failed は drain mode のみ非零 (DUPLICATE_DETECTED 計算と flag push が drain branch 限定)。
const taskItems = candidates.filter((c) => c.kind === 'タスク')
const taskNonFold = taskItems.filter((c) => !c.fold_into)
const taskGated = taskNonFold.filter((c) => c.gate)
const doneVerifiedTrue = doneCandidates.filter((d) => d.quote_verified).length
const taskDoneMetrics = {
  task_count: taskItems.length,
  task_fold_count: taskItems.length - taskNonFold.length,
  task_gate_total: taskGated.length,
  task_gate_passed: taskGated.filter((c) => !c.gate.unresolved && !c.gate.undecidable).length,
  task_gate_unresolved: taskGated.filter((c) => c.gate.unresolved).length,
  done_count: doneCandidates.length,
  done_quote_verified_true: doneVerifiedTrue,
  done_quote_verified_false: doneCandidates.length - doneVerifiedTrue,
  duplicate_detected: duplicateDetected.length,
  task_done_extraction_failed: flags.task_done_extraction_failed.length,
}

// Phase 4: 整形・出力パートの per_part metric を確定。Phase 4 plan L188-205 で整形パートの物理配置を
// **workflow script 段に残す**選択を採った (option a・Phase 1-3 の集計ロジックがすでに workflow にあり移植コストが最小)。
// 整形パートは workflow が見える範囲 (reportExtract + taskDoneExtract 由来の candidates・命名ゲート後の rename swap・
// 規約検証・DUPLICATE_DETECTED 計算) で観測可能な値を埋める。
// 気づき・洞察 由来の candidates は skill 本体側で並列に走り workflow には流れないので、整形パートの metric は
// workflow が処理した promotion (reports + tasks) と done 検出に限定される (skill 本体側 candidates の追加 metric は
// kizuki_insight に分離して skill 側で計算する)。
const formatOutputMetrics = {
  workflow_candidate_total: candidates.length, // drain では reports + tasks (backfill では tasks + insights)
  rename_swap_pairs: renamePairs.length, // 候補またぎの旧→新タイトル置換ペア数 (整形 phase の責務)
  validation_failed: candidates.filter((c) => (c.validation_errors || []).length).length, // 機械検証で残ったエラーを持つ候補数
  duplicate_detected: duplicateDetected.length, // drain mode のみ非零 (task_promotions ↔ done_candidates 交差)
  inbox_seen: MODE === 'drain' ? INBOX_FILES.length : 0, // drain で整形パートが見た inbox 件数 (extract 成否を問わない総和。正味の extract 成功数は inbox_seen - report_extraction_failed - task_done_extraction_failed で算出可能。report_referrers_skipped は extract 成功・referrers 走査 skip のみで引き算しない)
  report_extraction_failed: flags.report_extraction_failed.length,
  // R3-11: report_extraction_failed (真の rex 失敗) と report_referrers_skipped (referrers 走査 skip) を 1 軸に乗せていた
  // 混在計上を解消。前者は agent が結果を返さなかった件数・後者は agent が結果を返したが referrers 走査を放棄した件数で性質が異なる。
  // archive 退避除外の hold 判定は両 flag の和集合 (skill 本体側 4.7 step 4 で合算)。
  report_referrers_skipped: flags.report_referrers_skipped.length,
  task_done_extraction_failed: flags.task_done_extraction_failed.length,
}

return {
  mode: MODE,
  candidates,
  link_rewrites: linkRewrites,
  done_candidates: doneCandidates,
  duplicate_detected: duplicateDetected, // drain mode のみ非空。Phase 3 narrow 後は task_promotions ↔ done_candidates の 2 系統交差のみ
  totals,
  flags,
  // 4 パート (LLM Wiki / タスク done / 気づき・洞察 / 整形・出力) の metric。Phase 4 で全パートが実値を持つ。
  // kizuki_insight は skill 本体側で計算され、運用ログ記録時に書き出される (workflow からは空 dict を返す——気づき抽出 / 洞察検出が
  // workflow に流れないため、件数集計が skill 側でしか観測できないため)。drain SKILL.md step 7 (完了報告と運用ログ) で
  // 気づき件数・洞察件数・derivation_ok 率・self-check 指標 (self_flagged / title_human_edits 等) を skill 本体が埋めて 運用ログに書き出す。
  per_part_metrics: { llm_wiki: llmWikiMetrics, task_done: taskDoneMetrics, kizuki_insight: {}, format_output: formatOutputMetrics },
}
