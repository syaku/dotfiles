export const meta = {
  name: 'skill-review-pipeline',
  description: 'skill-review の評価パイプライン: 抽出→静的批評/トレース分析(並列)→逐語裏取り→支持判定→畳み込み。引用の実在照合・破棄・格上げ・件数集計は script がコードで実行し、自己申告に依存しない',
  whenToUse: 'skill-review スキル本体 (SKILL.md) から scriptPath 指定で起動される。単体起動は想定しない',
  phases: [
    { title: '抽出', detail: '対象 SKILL.md の委譲・subagent・外部 IO の抽出と引用の機械照合' },
    { title: '批評', detail: '静的批評とトレース分析の独立並列実行' },
    { title: '裏取り', detail: '引用の機械照合と支持判定 (高・トレース由来は悉皆)' },
    { title: '畳み込み', detail: '重複統合・格上げ・集計' },
  ],
}

// ---- 入力 ----
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (e) {
    throw new Error('args が JSON として解釈できない文字列で渡された: ' + e.message)
  }
}
if (!input || !input.skill_name || !input.skill_md_path || !input.skill_md_text) {
  throw new Error('args に skill_name / skill_md_path / skill_md_text が必要 (mode / max_trace_sessions は任意)')
}
const NAME = input.skill_name
const TARGET = input.skill_md_path
const SKILL_MD_TEXT = input.skill_md_text // main が step 0 で Read 済みの対象 SKILL.md 全文。抽出 agent に再エコーさせない (output token ボトルネック回避)
const MODE = input.mode === 'static' ? 'static' : 'full'
const MAX_SESSIONS = Number.isInteger(input.max_trace_sessions) && input.max_trace_sessions > 0 ? input.max_trace_sessions : 5
const CLAUDE_DIR = TARGET.split('/skills/')[0] // 例: /Users/syaku/.claude
const SKILLS_DIR = CLAUDE_DIR + '/skills'
const PLUGINS_GLOB = CLAUDE_DIR + '/plugins/marketplaces/*/skill-sources'
const PROJECTS_DIR = CLAUDE_DIR + '/projects'

// ---- 照合ヘルパ (空白差を吸収した逐語包含。捏造引用はここで構造的に落ちる) ----
// markdown 装飾記号 (バッククォート・強調 */_) を削除でなく空白に置換 → 空白正規化 (順序が
// load-bearing: 記号置換で生じた連続空白を後段の \s+ 畳み込み＋trim で吸収する)。空白置換により
// トークン境界が保たれ (raw_text→raw text、融合させない)、snake_case/glob を含む引用の誤一致を防ぐ。
// 両辺対称にかかるため本文捏造は依然 includes で落ちる。
const norm = (s) => (s || '').replace(/[`*_]/g, ' ').replace(/\s+/g, ' ').trim()
const quoteIn = (hay, needle) => !!norm(needle) && norm(hay).includes(norm(needle))

const AXES = ['フェーズ設計・委譲構造', 'プロンプト・指示の品質', '失敗・抜け穴の堅牢性', '成果・目的整合']
const SEV_RANK = { high: 3, medium: 2, low: 1 }
const SEV_UP = { low: 'medium', medium: 'high', high: 'high' }

// ---- schema ----
const QUOTED_REF = {
  type: 'object',
  required: ['line', 'quote'],
  properties: {
    line: { type: 'integer', description: '対象 SKILL.md の該当行番号' },
    quote: { type: 'string', description: '該当行の逐語引用 (原文ママ・300 文字以内)。機械照合される' },
  },
}
const EXTRACT_SCHEMA = {
  type: 'object',
  required: ['skill_delegations', 'subagent_usages', 'external_io', 'delegate_texts'],
  properties: {
    skill_delegations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'line', 'quote', 'role', 'readable', 'path'],
        properties: {
          name: { type: 'string' },
          line: QUOTED_REF.properties.line,
          quote: QUOTED_REF.properties.quote,
          role: { enum: ['call', 'example-or-note'], description: '実際の呼び出しか、例示・注記・対比か' },
          readable: { enum: ['self', 'plugin', 'none'], description: 'self=自作 skill / plugin=plugin 配下 / none=SKILL.md 不在で精読不可' },
          path: { type: 'string', description: '精読可なら SKILL.md の実パス。不可なら空文字' },
        },
      },
    },
    subagent_usages: {
      type: 'array',
      items: { type: 'object', required: ['line', 'quote', 'note'], properties: { line: QUOTED_REF.properties.line, quote: QUOTED_REF.properties.quote, note: { type: 'string', description: 'subagent_type 等の補足' } } },
    },
    external_io: {
      type: 'array',
      items: { type: 'object', required: ['kind', 'line', 'quote'], properties: { kind: { type: 'string', description: 'Bash / WebFetch / Write 先など' }, line: QUOTED_REF.properties.line, quote: QUOTED_REF.properties.quote } },
    },
    delegate_texts: {
      type: 'array',
      items: { type: 'object', required: ['name', 'path'], properties: { name: { type: 'string' }, path: { type: 'string', description: '委譲先 SKILL.md の実パス。本文はここに含めない (批評 agent が Read で取得する)' } } },
    },
  },
}

const FINDING_ITEM = {
  type: 'object',
  required: ['axis', 'summary', 'severity', 'file', 'line', 'quote', 'improvement'],
  properties: {
    axis: { enum: AXES },
    summary: { type: 'string', description: '指摘の自然言語要約 (1-2 文)' },
    severity: { enum: ['high', 'medium', 'low'], description: '高=ガード破り・データ/context ロスト・目的不達成 (成果物が下流で覆された・作り直しになった)。中=指示の曖昧さ・冗長・住み分け不明。低=文体・可読性' },
    file: { type: 'string', description: '引用元ファイルの実パス' },
    line: { type: 'integer', description: '引用の行番号 (jsonl 等で特定困難なら 0)' },
    quote: { type: 'string', description: '根拠の逐語引用 (原文ママ・300 文字以内)。機械照合され、原文に無い引用は破棄される' },
    improvement: { type: 'string', description: '改修可能な改善提案' },
  },
}
const CRITIQUE_SCHEMA = { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: FINDING_ITEM } } }

const TRACE_DISCOVERY_SCHEMA = {
  type: 'object',
  required: ['sessions', 'needle_hits_total', 'excluded_no_launch'],
  properties: {
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'mtime', 'has_subagents', 'evidence'],
        properties: {
          path: { type: 'string', description: 'メインセッション jsonl の実パス (subagents 配下でのヒットは親セッションに丸める)' },
          mtime: { type: 'string', description: 'ISO 形式。新しい順ソートの根拠' },
          has_subagents: { type: 'boolean' },
          evidence: {
            type: 'object',
            required: ['file', 'raw_text'],
            properties: {
              file: { type: 'string', description: '実走イベント行がある jsonl の実パス (親セッション jsonl 自身か subagents 配下)' },
              raw_text: { type: 'string', description: '実走イベント行の逐語原文 300 文字以内。needle を含むこと。機械照合される' },
            },
          },
        },
      },
    },
    needle_hits_total: { type: 'integer', description: 'needle の Grep ヒット総数 (セッション丸め・除外の前のファイル数)' },
    excluded_no_launch: { type: 'integer', description: '実走イベントゼロと判定して除外したセッション数' },
  },
}

const ECHO_SCHEMA = {
  type: 'object',
  required: ['found', 'raw_text', 'supports', 'reason'],
  properties: {
    found: { type: 'boolean' },
    raw_text: { type: 'string', description: '見つけた実イベント行の原文をそのまま貼る (要約しない)。見つからなければ空文字' },
    supports: { type: 'boolean' },
    reason: { type: 'string' },
  },
}
const TRACE_VERIFY_SCHEMA = {
  type: 'object',
  required: ['found', 'raw_text', 'supports', 'reason', 'addressed_in_current', 'current_quote'],
  properties: {
    found: { type: 'boolean' },
    raw_text: { type: 'string', description: '見つけた該当箇所の原文をそのまま貼る (要約しない)。見つからなければ空文字' },
    supports: { type: 'boolean' },
    reason: { type: 'string' },
    addressed_in_current: { type: 'boolean', description: '指摘が示す失敗様式に現行 SKILL.md が既に対処済みか (実走当時のバージョンでなく現行文面で判定する)。不確かなら false' },
    current_quote: { type: 'string', description: '対処済みの根拠となる現行 SKILL.md の逐語引用 (原文ママ・300 文字以内)。機械照合され、照合に落ちたら対処済み扱いにならない。addressed_in_current=false なら空文字' },
  },
}
const QUOTE_ECHO_SCHEMA = {
  type: 'object',
  required: ['found', 'raw_text'],
  properties: {
    found: { type: 'boolean' },
    raw_text: { type: 'string', description: '見つけた該当箇所の原文を 300 文字以内でそのまま貼る (要約・整形しない・改行を含んで良い・引用全体を内包するようにする)。見つからなければ空文字' },
  },
}
const SUPPORT_SCHEMA = {
  type: 'object',
  required: ['supports', 'reason'],
  properties: { supports: { type: 'boolean' }, reason: { type: 'string' } },
}
const DEDUP_SCHEMA = {
  type: 'object',
  required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      items: { type: 'object', required: ['ids', 'note'], properties: { ids: { type: 'array', items: { type: 'integer' } }, note: { type: 'string' } } },
    },
  },
}

// ============================================================
phase('抽出')
const EXTRACT_PROMPT = `あなたは read-only の抽出担当。評価対象 skill「${NAME}」の SKILL.md (${TARGET}) を Read し、以下を構造化して返せ。対象や委譲先を一切変更しない。

1. skill_delegations: 本文中の skill 委譲 (「Skill tool で X」等の参照) を全て抽出する。各項目に該当行番号と逐語引用 (原文ママ) を必ず併記する。引用文が「実際の呼び出し」か「例示・注記・類似処理の対比」かを role で判別せよ (call / example-or-note)。例示・注記・対比を call にしない (失敗接地: develop SKILL.md の「Skill: implement ではなく Agent で…」のような注記は対比であり実呼び出しではない)。
   各委譲先の実在を 2 系統で判定する: (i) ${SKILLS_DIR}/<name>/SKILL.md → readable: self、(ii) ${PLUGINS_GLOB}/<name>/SKILL.md を Glob で動的解決 (marketplace 名は固定しない) → readable: plugin。両方不在は readable: none (ビルトイン等で精読不可)。
2. subagent_usages: Agent / subagent_type の言及 (行番号＋逐語引用)。
3. external_io: Bash / WebFetch 等の外部呼び出し、Edit / Write による永続化先への書き込み、評価対象外ファイルの Read/Glob/Grep の言及 (種類＋行番号＋逐語引用)。
4. delegate_texts: readable が self / plugin の委譲先について name / path のみ返す (本文は不要。批評 agent が後段で Read する)。`

function unverifiedExtractionItems(ex) {
  const items = []
  for (const d of ex.skill_delegations) if (!quoteIn(SKILL_MD_TEXT, d.quote)) items.push({ kind: 'skill_delegation', name: d.name, line: d.line, quote: d.quote })
  for (const u of ex.subagent_usages) if (!quoteIn(SKILL_MD_TEXT, u.quote)) items.push({ kind: 'subagent', line: u.line, quote: u.quote })
  for (const io of ex.external_io) if (!quoteIn(SKILL_MD_TEXT, io.quote)) items.push({ kind: 'external_io', line: io.line, quote: io.quote })
  return items
}

let extract = await agent(EXTRACT_PROMPT, { agentType: 'Explore', schema: EXTRACT_SCHEMA, label: 'extract', phase: '抽出' })
if (!extract) throw new Error('抽出エージェントが結果を返さなかった')
let extractionUnverified = unverifiedExtractionItems(extract)
if (extractionUnverified.length) {
  log('抽出引用の機械照合に ' + extractionUnverified.length + ' 件失敗。再抽出を 1 回実施')
  const retry = await agent(
    EXTRACT_PROMPT + `\n\n前回の抽出では以下の引用が対象 SKILL.md 原文への機械照合 (空白差を吸収した包含判定) に失敗した。引用は該当行の原文をそのまま貼ること:\n${JSON.stringify(extractionUnverified, null, 2)}`,
    { agentType: 'Explore', schema: EXTRACT_SCHEMA, label: 'extract:retry', phase: '抽出' },
  )
  if (retry) {
    extract = retry
    extractionUnverified = unverifiedExtractionItems(extract)
  }
}

// 縮退判定 (コードで決める。critic の自己申告に依存しない)
const callDelegations = extract.skill_delegations.filter((d) => d.role === 'call')
let degenerate = 'none'
if (!callDelegations.length && !extract.subagent_usages.length) {
  degenerate = extract.external_io.length ? 'no-delegation' : 'dialog-only'
}
log(`抽出完了: skill 委譲 ${callDelegations.length} (うち精読不可 ${callDelegations.filter((d) => d.readable === 'none').length}) / subagent ${extract.subagent_usages.length} / 外部 IO ${extract.external_io.length} / 縮退=${degenerate}`)

// ============================================================
phase('批評')
const CRITIQUE_POLICY = `批評方針 (厳守):
- 指摘の数より質。各指摘は対象の特定の文・行に紐づき、改修可能な提案に繋がること。指摘ゼロの軸があってもそれは正当な出力。「軸ごとに 1 件以上」の網羅はしない (観点インフレを起こさない)。
- 各指摘の quote には根拠箇所の逐語引用 (原文ママ・300 文字以内) を必ず入れる。行番号だけの根拠は不採用。引用は機械照合され、原文に存在しない引用は破棄される。
- 4 軸はこれ以外に広げない: フェーズ設計・委譲構造 (フェーズ分割の妥当性、skill 委譲・subagent 起動・外部 IO の住み分け、context の受け渡し) / プロンプト・指示の品質 (指示の曖昧さ・冗長・抜け) / 失敗・抜け穴の堅牢性 (ガード破り、データ／context ロスト、暴走の余地) / 成果・目的整合 (skill の成果物が SKILL.md 冒頭の目的を達成したか。規約遵守とは独立に評価する)。`

const delegatePathBlock = extract.delegate_texts.length
  ? `精読可能な委譲先 SKILL.md (本文は agent 側で Read tool で取得すること。引用は機械照合される):\n${extract.delegate_texts.map((t) => `- ${t.name} (${t.path})`).join('\n')}`
  : '(精読可能な委譲先なし)'
const staticThunk = () =>
  agent(
    `あなたは skill 評価の静的批評担当。評価対象 skill「${NAME}」を 3 軸で批評し findings を返せ。何も変更しない。
${CRITIQUE_POLICY}
- 引用元 (file) は評価対象 SKILL.md (${TARGET}) か下記の精読可能な委譲先パスに限る。提供されていないファイルを根拠にしない。
- 精読不可の委譲先 (抽出テーブルで readable: none) は呼び出し記述と description のみで評価し、踏み込んだ断定をしない。
- 委譲先 SKILL.md を根拠に挙げる場合は Read tool で当該ファイルを読み、quote には該当箇所の原文 (300 文字以内) を入れること。引用は後段で機械照合される (原文に無い引用は破棄)。
- 成果・目的整合の軸は、静的には「SKILL.md が成果物の良し悪しを観測可能に定義しているか (final 条件・受入条件・承認ゲートの有無)」だけを評価する。成果物の実物は静的批評では見えないため、それ以上に広げない。

評価対象 SKILL.md (${TARGET}) 全文:
---
${SKILL_MD_TEXT}
---

抽出テーブル (機械照合済み):
${JSON.stringify({ skill_delegations: extract.skill_delegations, subagent_usages: extract.subagent_usages, external_io: extract.external_io }, null, 2)}

${delegatePathBlock}`,
    { schema: CRITIQUE_SCHEMA, label: 'critic:static', phase: '批評' },
  )

let traceInfo = {
  sessions_found: 0, // 実走判定を通過して scout が返した件数 (旧: needle ヒット数)
  sessions_analyzed: 0,
  sessions_dropped: 0, // 検証通過分のうち上限超過で未分析 (旧: found との差)
  analyzed_paths: [],
  analyst_failures: 0,
  dedup_removed: 0, // path 重複で除去した件数
  evidence_rejected_script: 0, // scout 証跡が script 照合 (マーカー包含・セッション配下) で落ちた件数
  evidence_rejected_echo: 0, // echo 独立確認で落ちた件数 (found=false / supports=false / quoteIn 失敗)
  evidence_echo_failures: 0, // echo 不応答の件数 (fail-closed で不通過)
  scout_needle_hits: 0, // scout 申告: needle の Grep ヒット総数 (第 1 層除外の可視化。機械照合対象外)
  scout_excluded_no_launch: 0, // scout 申告: 実走イベントゼロと判定して除外した件数 (同上)
  skipped: MODE === 'static' ? 'static-mode' : '',
}
let traceDiscoveryFailed = false

// 自己参照汚染ガード: needle「Launching skill: <name>」は実 Skill tool の実行イベントにも、評価
// workflow 自身の agent プロンプト内の文字列引用にも現れる (2026-07-02 の sear-me 評価で、実走を
// 含まないメタセッションが最新実走として拾われた実発生あり)。2026-07-03 の実 jsonl 検分
// (2026-06-09〜07-03 の 10 セッション) で確認した構造差: 実行イベントは tool_result の content が
// 丁度 needle の行として記録され、トップレベル JSON に MARKER 断片が非エスケープで現れる。
// プロンプト内引用は別の文字列フィールド内にエスケープ (\") されて現れるため MARKER を含まない。
const NEEDLE = `Launching skill: ${NAME}`
const MARKER = `"content":"${NEEDLE}"`
const subagentsDir = (jsonlPath) => jsonlPath.replace(/\.jsonl$/, '') + '/subagents/'
const traceThunk = async () => {
  if (MODE === 'static') return []
  const disc = await agent(
    `評価対象 skill「${NAME}」の実走トレースを探す read-only 調査。${PROJECTS_DIR} 配下の *.jsonl を「${NEEDLE}」で Grep し (cwd を限定しない。jsonl path は cwd 依存のディレクトリ名なので特定 cwd に絞ると他 cwd セッションを取りこぼす)、下記の判別基準で実走セッションだけをメインセッション jsonl に丸めて mtime 降順 (新しい順) で返せ。subagents/agent-*.jsonl でのヒットは親セッションの jsonl に丸める。各セッションの <session-id>/subagents/ ディレクトリの有無も返す。中身の分析はしない (実走判別と証跡取得のみ)。

判別基準 (自己参照汚染ガード): 「${NEEDLE}」は (a) Skill tool の実行イベント (tool_result の content が丁度この文字列である行) と (b) agent プロンプトや自由文中の文字列引用の両方に現れ、grep では区別できない。実走に数えるのは (a) だけ。実行イベント行はトップレベル JSON に非エスケープの断片 ${MARKER} を含む (引用は文字列内にエスケープされて現れるため含まない)。(b) しか無いセッション (例: skill 評価の実行自身のメタセッション) は sessions に入れず excluded_no_launch に数える。

evidence: sessions の各項目に実走イベント行の逐語証跡を付ける。file は実走イベント行がある jsonl の実パス (親セッション jsonl 自身か subagents 配下)、raw_text は該当行の原文から上記断片を含む範囲を 300 文字以内でそのまま切り出す (要約・整形しない)。機械照合される。

集計: needle_hits_total には Grep でヒットした jsonl ファイルの総数 (セッション丸め・除外の前)、excluded_no_launch には実走イベントゼロと判定して除外したセッション数を返す。`,
    { agentType: 'Explore', schema: TRACE_DISCOVERY_SCHEMA, label: 'trace:discovery', phase: '批評' },
  )
  if (!disc) {
    traceDiscoveryFailed = true
    return []
  }
  traceInfo.sessions_found = disc.sessions.length
  traceInfo.scout_needle_hits = disc.needle_hits_total
  traceInfo.scout_excluded_no_launch = disc.excluded_no_launch

  // 1. dedup: mtime 降順をコードで保証してから path で unique 化 (先頭 = 最新を残す)
  const sorted = [...disc.sessions].sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0))
  const seenPaths = new Set()
  const unique = []
  for (const s of sorted) {
    if (seenPaths.has(s.path)) continue
    seenPaths.add(s.path)
    unique.push(s)
  }
  traceInfo.dedup_removed = sorted.length - unique.length

  // 2. scout 証跡の純コード照合: 実行イベントの構造マーカー包含 (needle 包含を内包) と、証跡
  //    ファイルがそのセッション配下 (親 jsonl 自身か subagents/ 配下) にあること。空証跡もここで落ちる
  const evidenceInSession = (s) =>
    s.evidence.file === s.path || (s.evidence.file || '').startsWith(subagentsDir(s.path))
  const screened = unique.filter((s) => s.evidence && quoteIn(s.evidence.raw_text, MARKER) && evidenceInSession(s))
  traceInfo.evidence_rejected_script = unique.length - screened.length

  // 3. echo 独立確認: 候補窓 MAX_SESSIONS * 2 に並列で当て、script が quoteIn で照合。不応答・
  //    不一致・supports=false は不通過 (fail-closed)。窓は広げ直さない (リトライをループで持たない)
  const windowSessions = screened.slice(0, MAX_SESSIONS * 2)
  const echoes = await parallel(
    windowSessions.map((s, i) => () =>
      agent(
        `あなたは実走確認担当 (read-only・反証視点)。セッション ${s.path}${s.has_subagents ? ` と ${subagentsDir(s.path)} 配下の agent-*.jsonl` : ''} に、評価対象 skill「${NAME}」の実走イベントが実在するかを独立に確認せよ。
1. 「${NEEDLE}」を Grep し、Skill tool の実行イベント行 (tool_result の content が丁度この文字列である行。トップレベル JSON に非エスケープの断片 ${MARKER} を含む) を探す。見つけた行の原文を raw_text にそのまま貼る (要約・整形しない。該当断片を含む範囲を 300 文字以内で切り出してよい)。見つからなければ found=false で空文字。
2. その行が本当に Skill tool の実行イベントか、agent プロンプト・自由文中の文字列引用 (エスケープされた出現) に過ぎないかを反証視点で判定し supports / reason を返す。引用しか見つからない・不確かなら supports=false に倒す。`,
        { agentType: 'Explore', schema: ECHO_SCHEMA, label: `trace:echo${i + 1}`, phase: '批評' },
      ),
    ),
  )
  const passed = []
  windowSessions.forEach((s, i) => {
    const v = echoes[i]
    if (!v) {
      traceInfo.evidence_echo_failures++
      return
    }
    if (!(v.found && quoteIn(v.raw_text, NEEDLE) && v.supports)) {
      traceInfo.evidence_rejected_echo++
      return
    }
    passed.push(s)
  })

  // 4. picked = 通過セッションの先頭 MAX_SESSIONS 件 (mtime 降順は保持済み)
  const picked = passed.slice(0, MAX_SESSIONS)
  traceInfo.sessions_dropped = passed.length - picked.length
  const excluded = traceInfo.dedup_removed + traceInfo.evidence_rejected_script + traceInfo.evidence_rejected_echo + traceInfo.evidence_echo_failures
  if (excluded > 0) log(`自己参照ガード除外: dedup ${traceInfo.dedup_removed} / script 照合 ${traceInfo.evidence_rejected_script} / echo 確認 ${traceInfo.evidence_rejected_echo} / echo 不応答 ${traceInfo.evidence_echo_failures}`)
  if (traceInfo.sessions_dropped > 0) log(`トレース ${traceInfo.sessions_dropped} 件は上限 ${MAX_SESSIONS} 件 (新しい順) の外で未分析`)
  if (picked.length < MAX_SESSIONS && windowSessions.length > passed.length) log(`検証通過が ${picked.length} 件 (< 上限 ${MAX_SESSIONS})。通過分のみ分析する (窓は広げ直さない)`)
  const results = await parallel(
    picked.map((s, i) => () =>
      agent(
        `あなたは skill 評価のトレース分析担当。評価対象 skill「${NAME}」の実走セッション 1 件を読み、詰まり・無駄・フェーズ間の引き継ぎロスト・ガード破り・成果と目的の不整合を findings として返せ。何も変更しない。
対象: ${s.path} (1 行 1 イベントの jsonl。大きければ Grep で「${NAME}」関連イベントに当たりを付けてから周辺を読む)${s.has_subagents ? `\n併せて ${subagentsDir(s.path)} 配下の agent-*.jsonl も対象。` : ''}
${CRITIQUE_POLICY}
- quote には該当 jsonl イベントの逐語テキスト (要約でなく原文の抜粋・300 文字以内)、file にはその jsonl の実パスを入れる。読んでいないイベントを主張しない。
- 成果・目的整合の軸では、このセッションで skill が生んだ成果物 (premise.md / plan.md / レポート等) と、その下流の運命 (承認・訂正回数・差し戻し・放棄・次フェーズでの再定義) を追う。成果物ファイルのパスが trace に残っていれば Read してよい (その場合 quote と file は成果物側から取ってよい)。ゲートの採否比率のような観測可能な数字も成果の接地になる。下流の運命が見えるのは同一セッション内まで——セッションを跨いだ帰結を推測で主張しない。
- バージョン境界: セッション内にエコーされた SKILL 文面は実走当時のバージョンであり、現行版と同一とは限らない。下記の現行 SKILL.md 全文と突き合わせ、現行版が既に対処済みの失敗様式を現行への指摘として出さない (対処済みか判断が割れる場合は指摘に残してよい。後段の検証が現行版突合を行う)。
- これは 1 件のケーススタディである。統計的一般化をしない (「いつも」「毎回」と書かない)。

現行 SKILL.md (${TARGET}) 全文 (成果・目的整合の錨、およびバージョン突合用):
---
${SKILL_MD_TEXT}
---`,
        { agentType: 'Explore', schema: CRITIQUE_SCHEMA, label: `trace:s${i + 1}`, phase: '批評' },
      ),
    ),
  )
  traceInfo.sessions_analyzed = picked.length
  traceInfo.analyzed_paths = picked.map((s) => s.path)
  traceInfo.analyst_failures = results.filter((r) => !r).length
  return results.filter(Boolean).flatMap((r) => r.findings)
}

// barrier が正当なケース: 裏取り対象の選定 (needSupport) が静的・トレース両方の母数を必要とする
const [staticRes, traceFindingsRaw] = await parallel([staticThunk, traceThunk])
const traceFindingsList = traceFindingsRaw || []

let findings = []
function addFinding(raw, source) {
  findings.push({
    id: findings.length + 1,
    axis: raw.axis,
    summary: raw.summary,
    severity: raw.severity,
    escalated: false,
    sources: [source],
    file: raw.file,
    line: raw.line,
    quote: raw.quote,
    quote_verified: false,
    support_checked: false,
    addressed_in_current: false,
    improvement: raw.improvement,
    merged_ids: [],
  })
}
for (const raw of staticRes ? staticRes.findings : []) addFinding(raw, 'static')
for (const raw of traceFindingsList) addFinding(raw, 'trace')
log(`批評完了: 静的 ${staticRes ? staticRes.findings.length : '取得失敗'} / トレース ${traceFindingsList.length} 件`)

// ============================================================
phase('裏取り')
let dropped = []
function applyDrops() {
  for (const f of findings) {
    if (f.to_drop) dropped.push({ id: f.id, axis: f.axis, summary: f.summary, source: f.sources.join('+'), reason: f.to_drop })
  }
  findings = findings.filter((f) => !f.to_drop)
}

// 静的指摘の引用照合:
// - 対象 SKILL.md (file === TARGET) は args 経由で得た SKILL_MD_TEXT に対し quoteIn でコード判定
// - 委譲先その他 (file !== TARGET) は echo agent で当該ファイルから原文を取得し quoteIn で照合
//   (delegate_texts[].text の事前エコーをやめて output token を減らすため。原文取得は finding 単位で並列化)
const staticEchoTargets = []
for (const f of findings) {
  if (!f.sources.includes('static')) continue
  if (f.file === TARGET) {
    f.quote_verified = quoteIn(SKILL_MD_TEXT, f.quote)
    if (!f.quote_verified) f.to_drop = 'quote-not-in-source (引用が原文への機械照合に失敗)'
  } else {
    staticEchoTargets.push(f)
  }
}
applyDrops()

let echoIncomplete = 0
if (staticEchoTargets.length) {
  await parallel(
    staticEchoTargets.map((f) => async () => {
      const v = await agent(
        `あなたは引用確認担当 (read-only)。ファイル ${f.file} に下記の引用と一致するテキストが実在するか Grep / Read で確認し、見つけた該当箇所の原文を raw_text にそのまま貼る (要約・整形しない・改行を含んで良い・引用全体を内包するように 300 文字以内で)。見つからなければ found=false で空文字。
引用: ${f.quote}`,
        { agentType: 'Explore', schema: QUOTE_ECHO_SCHEMA, label: `echo:F${f.id}`, phase: '裏取り' },
      )
      if (!v) {
        echoIncomplete++
        return
      }
      if (!v.found || !quoteIn(v.raw_text, f.quote)) {
        f.to_drop = 'quote-not-in-source (echo agent の実読原文に引用が含まれない)'
        return
      }
      f.quote_verified = true
    }),
  )
  applyDrops()
}

// 支持判定 (悉皆): 全トレース由来＋全 severity:high。サンプル化しない
let supportIncomplete = 0
const needSupport = findings.filter((f) => f.sources.includes('trace') || f.severity === 'high')
await parallel(
  needSupport.map((f) => async () => {
    if (f.sources.includes('trace')) {
      const v = await agent(
        `あなたは検証担当 (反証視点)。以下のトレース指摘の裏取りをせよ。
1. ファイル ${f.file} に下記の引用と一致する記述が実在するか Grep / Read で確認し、見つけた該当箇所の原文を raw_text にそのまま貼る (要約・整形をしない)。見つからなければ found=false。
2. 実在した場合、その記述は指摘を実際に支持するか (牽強付会・文脈の取り違えでないか) を反証視点で判定し supports / reason を返す。不確かなら supports=false に倒す。
3. supports=true の場合、下記の現行 SKILL.md 全文と突き合わせ、指摘が示す失敗様式に現行版が既に対処済みか (トレースは過去バージョンの実走でありうる。セッション内にエコーされた SKILL 文面を現行版と混同しない) を判定し addressed_in_current を返す。true なら対処している現行文面の逐語引用を current_quote に貼る (機械照合される)。不確かなら false に倒す (指摘は現行への指摘として残る)。
指摘: ${f.summary}
引用: ${f.quote}
改善提案: ${f.improvement}

現行 SKILL.md 全文:
---
${SKILL_MD_TEXT}
---`,
        { agentType: 'Explore', schema: TRACE_VERIFY_SCHEMA, label: `verify:F${f.id}`, phase: '裏取り' },
      )
      if (!v) {
        supportIncomplete++
        return
      }
      if (!v.found || !quoteIn(v.raw_text, f.quote)) {
        f.to_drop = 'trace-quote-not-found (検証 agent の実読原文に引用が含まれない)'
        return
      }
      f.quote_verified = true
      if (!v.supports) {
        f.to_drop = 'not-supported: ' + v.reason
        return
      }
      f.support_checked = true
      // 現行版突合: current_quote が現行文面への機械照合を通過したときだけ対処済み扱い (落ちたら指摘を生かす側に倒す)
      if (v.addressed_in_current && quoteIn(SKILL_MD_TEXT, v.current_quote)) f.addressed_in_current = true
    } else {
      const v = await agent(
        `あなたは検証担当 (反証視点)。以下の指摘について、引用 (原文に実在することは機械照合済み) がその指摘を実際に支持するかを判定せよ。引用の前後の文脈が必要なら ${f.file} を Read してよい。牽強付会・文脈の取り違えと判断したら supports=false。不確かなら supports=false に倒す。
指摘: ${f.summary}
引用: ${f.quote}
改善提案: ${f.improvement}`,
        { agentType: 'Explore', schema: SUPPORT_SCHEMA, label: `verify:F${f.id}`, phase: '裏取り' },
      )
      if (!v) {
        supportIncomplete++
        return
      }
      if (!v.supports) {
        f.to_drop = 'not-supported: ' + v.reason
        return
      }
      f.support_checked = true
    }
  }),
)
applyDrops()
log(`裏取り完了: 生存 ${findings.length} / 破棄 ${dropped.length} / echo 未完 ${echoIncomplete} / 支持判定未完 ${supportIncomplete}`)

// ============================================================
phase('畳み込み')
// 格上げ: 機械照合＋支持判定を通過したトレース由来のみ 1 段格上げ (コードで適用)。現行版対処済みは
// 格上げしない (stale 指摘の増幅防止。失敗接地: 2026-07-03 sear-me 回帰評価で旧版由来の前提不成立
// 指摘 2 件が high 化して提示された)
for (const f of findings) {
  if (f.sources.includes('trace') && f.quote_verified && f.support_checked && !f.addressed_in_current) {
    const up = SEV_UP[f.severity]
    if (up !== f.severity) {
      f.severity = up
      f.escalated = true
    }
  }
}

// 重複統合: 統合候補の判定のみ agent、統合の実行と制約 (同一軸内のみ) はコードで強制
let dedupFailed = false
if (findings.length > 1) {
  const DEDUP_PROMPT = `以下の skill 評価指摘リストから「同一軸かつ同一の根拠箇所／同一の挙動を指す」重複グループだけを挙げよ。判断が割れるものはグループに含めない (グループ化されなかった指摘はそのまま残る)。統合そのものは行わない (判定のみ)。
${JSON.stringify(findings.map((f) => ({ id: f.id, axis: f.axis, file: f.file, line: f.line, summary: f.summary })), null, 2)}`
  let d = await agent(DEDUP_PROMPT, { schema: DEDUP_SCHEMA, label: 'dedup', phase: '畳み込み' })
  if (!d) {
    // 1 回だけリトライ (失敗接地: 2026-07-03、session limit で dedup 1 発失敗 → 重複未統合 16 件提示)
    log('dedup agent が結果を返さなかった。1 回リトライ')
    d = await agent(DEDUP_PROMPT, { schema: DEDUP_SCHEMA, label: 'dedup:retry', phase: '畳み込み' })
  }
  if (!d) {
    dedupFailed = true
  } else {
    for (const g of d.groups || []) {
      const members = findings.filter((f) => (g.ids || []).includes(f.id))
      if (members.length < 2) continue
      if (new Set(members.map((m) => m.axis)).size !== 1) continue // 同一軸内のみ統合
      members.sort((a, b) => a.id - b.id)
      const head = members[0]
      const removeIds = []
      for (const m of members.slice(1)) {
        head.sources = Array.from(new Set([...head.sources, ...m.sources]))
        if (SEV_RANK[m.severity] > SEV_RANK[head.severity]) head.severity = m.severity
        head.escalated = head.escalated || m.escalated
        head.quote_verified = head.quote_verified && m.quote_verified
        head.addressed_in_current = head.addressed_in_current && m.addressed_in_current // 静的由来 (現行文面が根拠) と統合されたら現行の指摘に戻る
        head.merged_ids.push(m.id)
        removeIds.push(m.id)
      }
      findings = findings.filter((f) => !removeIds.includes(f.id))
    }
  }
}

// 集計 (コード)
const byAxis = {}
for (const a of AXES) byAxis[a] = findings.filter((f) => f.axis === a).length
const totals = {
  count: findings.length,
  high: findings.filter((f) => f.severity === 'high').length,
  medium: findings.filter((f) => f.severity === 'medium').length,
  low: findings.filter((f) => f.severity === 'low').length,
  addressed_in_current: findings.filter((f) => f.addressed_in_current).length,
  by_axis: byAxis,
  dropped: dropped.length,
}
log(`畳み込み完了: ${totals.count} 件 (high ${totals.high} / medium ${totals.medium} / low ${totals.low}) うち現行版対処済み ${totals.addressed_in_current} 件 / 破棄 ${totals.dropped} 件`)

return {
  extraction: {
    skill_delegations: extract.skill_delegations,
    subagent_usages: extract.subagent_usages,
    external_io: extract.external_io,
    unreadable_delegates: callDelegations.filter((d) => d.readable === 'none').map((d) => d.name),
    unverified_quotes: extractionUnverified,
    degenerate,
  },
  findings,
  dropped,
  traces: traceInfo,
  totals,
  flags: {
    static_failed: !staticRes,
    trace_discovery_failed: traceDiscoveryFailed,
    dedup_failed: dedupFailed,
    extract_unverified: extractionUnverified.length > 0,
    support_verify_incomplete: supportIncomplete,
    static_echo_incomplete: echoIncomplete,
  },
}
