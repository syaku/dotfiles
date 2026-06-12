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
if (!input || !input.skill_name || !input.skill_md_path) {
  throw new Error('args に skill_name / skill_md_path が必要 (mode / max_trace_sessions は任意)')
}
const NAME = input.skill_name
const TARGET = input.skill_md_path
const MODE = input.mode === 'static' ? 'static' : 'full'
const MAX_SESSIONS = Number.isInteger(input.max_trace_sessions) && input.max_trace_sessions > 0 ? input.max_trace_sessions : 5
const CLAUDE_DIR = TARGET.split('/skills/')[0] // 例: /Users/syaku/.claude
const SKILLS_DIR = CLAUDE_DIR + '/skills'
const PLUGINS_GLOB = CLAUDE_DIR + '/plugins/marketplaces/*/skill-sources'
const PROJECTS_DIR = CLAUDE_DIR + '/projects'

// ---- 照合ヘルパ (空白差を吸収した逐語包含。捏造引用はここで構造的に落ちる) ----
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
const quoteIn = (hay, needle) => !!norm(needle) && norm(hay).includes(norm(needle))

const AXES = ['フェーズ設計・委譲構造', 'プロンプト・指示の品質', '失敗・抜け穴の堅牢性']
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
  required: ['target_text', 'skill_delegations', 'subagent_usages', 'external_io', 'delegate_texts'],
  properties: {
    target_text: { type: 'string', description: '対象 SKILL.md の全文 (原文ママ)' },
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
      items: { type: 'object', required: ['name', 'path', 'text'], properties: { name: { type: 'string' }, path: { type: 'string' }, text: { type: 'string', description: '委譲先 SKILL.md の全文 (原文ママ)' } } },
    },
  },
}

const FINDING_ITEM = {
  type: 'object',
  required: ['axis', 'summary', 'severity', 'file', 'line', 'quote', 'improvement'],
  properties: {
    axis: { enum: AXES },
    summary: { type: 'string', description: '指摘の自然言語要約 (1-2 文)' },
    severity: { enum: ['high', 'medium', 'low'], description: '高=ガード破り・データ/context ロスト。中=指示の曖昧さ・冗長・住み分け不明。低=文体・可読性' },
    file: { type: 'string', description: '引用元ファイルの実パス' },
    line: { type: 'integer', description: '引用の行番号 (jsonl 等で特定困難なら 0)' },
    quote: { type: 'string', description: '根拠の逐語引用 (原文ママ・300 文字以内)。機械照合され、原文に無い引用は破棄される' },
    improvement: { type: 'string', description: '改修可能な改善提案' },
  },
}
const CRITIQUE_SCHEMA = { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: FINDING_ITEM } } }

const TRACE_DISCOVERY_SCHEMA = {
  type: 'object',
  required: ['sessions'],
  properties: {
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'mtime', 'has_subagents'],
        properties: {
          path: { type: 'string', description: 'メインセッション jsonl の実パス (subagents 配下でのヒットは親セッションに丸める)' },
          mtime: { type: 'string', description: 'ISO 形式。新しい順ソートの根拠' },
          has_subagents: { type: 'boolean' },
        },
      },
    },
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

1. target_text: 対象 SKILL.md の全文を原文ママで返す。
2. skill_delegations: 本文中の skill 委譲 (「Skill tool で X」等の参照) を全て抽出する。各項目に該当行番号と逐語引用 (原文ママ) を必ず併記する。引用文が「実際の呼び出し」か「例示・注記・類似処理の対比」かを role で判別せよ (call / example-or-note)。例示・注記・対比を call にしない (失敗接地: develop SKILL.md の「Skill: implement ではなく Agent で…」のような注記は対比であり実呼び出しではない)。
   各委譲先の実在を 2 系統で判定する: (i) ${SKILLS_DIR}/<name>/SKILL.md → readable: self、(ii) ${PLUGINS_GLOB}/<name>/SKILL.md を Glob で動的解決 (marketplace 名は固定しない) → readable: plugin。両方不在は readable: none (ビルトイン等で精読不可)。
3. subagent_usages: Agent / subagent_type の言及 (行番号＋逐語引用)。
4. external_io: Bash / WebFetch 等の外部呼び出し、Edit / Write による永続化先への書き込み、評価対象外ファイルの Read/Glob/Grep の言及 (種類＋行番号＋逐語引用)。
5. delegate_texts: readable が self / plugin の委譲先 SKILL.md は全文を読み込み name / path / text で返す。`

function unverifiedExtractionItems(ex) {
  const items = []
  for (const d of ex.skill_delegations) if (!quoteIn(ex.target_text, d.quote)) items.push({ kind: 'skill_delegation', name: d.name, line: d.line, quote: d.quote })
  for (const u of ex.subagent_usages) if (!quoteIn(ex.target_text, u.quote)) items.push({ kind: 'subagent', line: u.line, quote: u.quote })
  for (const io of ex.external_io) if (!quoteIn(ex.target_text, io.quote)) items.push({ kind: 'external_io', line: io.line, quote: io.quote })
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
- 3 軸はこれ以外に広げない: フェーズ設計・委譲構造 (フェーズ分割の妥当性、skill 委譲・subagent 起動・外部 IO の住み分け、context の受け渡し) / プロンプト・指示の品質 (指示の曖昧さ・冗長・抜け) / 失敗・抜け穴の堅牢性 (ガード破り、データ／context ロスト、暴走の余地)。`

const delegateTextBlock = extract.delegate_texts.map((t) => `--- 委譲先 ${t.name} (${t.path}) ---\n${t.text}`).join('\n\n')
const staticThunk = () =>
  agent(
    `あなたは skill 評価の静的批評担当。評価対象 skill「${NAME}」を 3 軸で批評し findings を返せ。何も変更しない。
${CRITIQUE_POLICY}
- 引用元 (file) は評価対象 SKILL.md (${TARGET}) か下記の精読済み委譲先に限る。提供されていないファイルを根拠にしない。
- 精読不可の委譲先 (抽出テーブルで readable: none) は呼び出し記述と description のみで評価し、踏み込んだ断定をしない。

評価対象 SKILL.md (${TARGET}) 全文:
---
${extract.target_text}
---

抽出テーブル (機械照合済み):
${JSON.stringify({ skill_delegations: extract.skill_delegations, subagent_usages: extract.subagent_usages, external_io: extract.external_io }, null, 2)}

${delegateTextBlock || '(精読可能な委譲先なし)'}`,
    { schema: CRITIQUE_SCHEMA, label: 'critic:static', phase: '批評' },
  )

let traceInfo = { sessions_found: 0, sessions_analyzed: 0, sessions_dropped: 0, analyzed_paths: [], analyst_failures: 0, skipped: MODE === 'static' ? 'static-mode' : '' }
let traceDiscoveryFailed = false
const traceThunk = async () => {
  if (MODE === 'static') return []
  const disc = await agent(
    `評価対象 skill「${NAME}」の実走トレースを探す read-only 調査。${PROJECTS_DIR} 配下の *.jsonl を「Launching skill: ${NAME}」で Grep し (cwd を限定しない。jsonl path は cwd 依存のディレクトリ名なので特定 cwd に絞ると他 cwd セッションを取りこぼす)、ヒットしたメインセッション jsonl を mtime 降順 (新しい順) で返せ。subagents/agent-*.jsonl でのヒットは親セッションの jsonl に丸める。各セッションの <session-id>/subagents/ ディレクトリの有無も返す。中身の分析はしない (一覧のみ)。`,
    { agentType: 'Explore', schema: TRACE_DISCOVERY_SCHEMA, label: 'trace:discovery', phase: '批評' },
  )
  if (!disc) {
    traceDiscoveryFailed = true
    return []
  }
  traceInfo.sessions_found = disc.sessions.length
  const picked = disc.sessions.slice(0, MAX_SESSIONS)
  traceInfo.sessions_dropped = disc.sessions.length - picked.length
  if (traceInfo.sessions_dropped > 0) log(`トレース ${traceInfo.sessions_dropped} 件は上限 ${MAX_SESSIONS} 件 (新しい順) の外で未分析`)
  const results = await parallel(
    picked.map((s, i) => () =>
      agent(
        `あなたは skill 評価のトレース分析担当。評価対象 skill「${NAME}」の実走セッション 1 件を読み、詰まり・無駄・フェーズ間の引き継ぎロスト・ガード破りを findings として返せ。何も変更しない。
対象: ${s.path} (1 行 1 イベントの jsonl。大きければ Grep で「${NAME}」関連イベントに当たりを付けてから周辺を読む)${s.has_subagents ? `\n併せて ${s.path.replace(/\.jsonl$/, '')}/subagents/ 配下の agent-*.jsonl も対象。` : ''}
${CRITIQUE_POLICY}
- quote には該当 jsonl イベントの逐語テキスト (要約でなく原文の抜粋・300 文字以内)、file にはその jsonl の実パスを入れる。読んでいないイベントを主張しない。
- これは 1 件のケーススタディである。統計的一般化をしない (「いつも」「毎回」と書かない)。`,
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

// 静的指摘: 保持テキスト (対象＋精読済み委譲先) への機械照合。コードで実行され全件に必ず掛かる
const heldTexts = [extract.target_text, ...extract.delegate_texts.map((t) => t.text)]
for (const f of findings) {
  if (f.sources.includes('static')) {
    f.quote_verified = heldTexts.some((t) => quoteIn(t, f.quote))
    if (!f.quote_verified) f.to_drop = 'quote-not-in-source (引用が原文への機械照合に失敗)'
  }
}
applyDrops()

// 支持判定 (悉皆): 全トレース由来＋全 severity:high。サンプル化しない
let supportIncomplete = 0
const needSupport = findings.filter((f) => f.sources.includes('trace') || f.severity === 'high')
await parallel(
  needSupport.map((f) => async () => {
    if (f.sources.includes('trace')) {
      const v = await agent(
        `あなたは検証担当 (反証視点)。以下のトレース指摘の裏取りをせよ。
1. ファイル ${f.file} に下記の引用と一致するイベントが実在するか Grep / Read で確認し、見つけた実イベント行の原文を raw_text にそのまま貼る (要約・整形をしない)。見つからなければ found=false。
2. 実在した場合、そのイベントは指摘を実際に支持するか (牽強付会・文脈の取り違えでないか) を反証視点で判定し supports / reason を返す。不確かなら supports=false に倒す。
指摘: ${f.summary}
引用: ${f.quote}`,
        { agentType: 'Explore', schema: ECHO_SCHEMA, label: `verify:F${f.id}`, phase: '裏取り' },
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
log(`裏取り完了: 生存 ${findings.length} / 破棄 ${dropped.length} / 支持判定未完 ${supportIncomplete}`)

// ============================================================
phase('畳み込み')
// 格上げ: 機械照合＋支持判定を通過したトレース由来のみ 1 段格上げ (コードで適用)
for (const f of findings) {
  if (f.sources.includes('trace') && f.quote_verified && f.support_checked) {
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
  const d = await agent(
    `以下の skill 評価指摘リストから「同一軸かつ同一の根拠箇所／同一の挙動を指す」重複グループだけを挙げよ。判断が割れるものはグループに含めない (グループ化されなかった指摘はそのまま残る)。統合そのものは行わない (判定のみ)。
${JSON.stringify(findings.map((f) => ({ id: f.id, axis: f.axis, file: f.file, line: f.line, summary: f.summary })), null, 2)}`,
    { schema: DEDUP_SCHEMA, label: 'dedup', phase: '畳み込み' },
  )
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
  by_axis: byAxis,
  dropped: dropped.length,
}
log(`畳み込み完了: ${totals.count} 件 (high ${totals.high} / medium ${totals.medium} / low ${totals.low}) 破棄 ${totals.dropped} 件`)

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
  },
}
