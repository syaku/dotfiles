export const meta = {
  name: 'plan-pipeline',
  description: 'plan スキルの計画作成パイプライン: 調査→起草→検証/レビュー(並列)→出典付き訂正→リトライ収束。件数・状態の集計は script がコードで計算し、自己申告に依存しない',
  whenToUse: 'plan スキル本体 (SKILL.md) から scriptPath 指定で起動される。単体起動は想定しない',
  phases: [
    { title: '調査', detail: '対象リポジトリの関連ファイル・再利用候補・現状挙動を構造化' },
    { title: '起草', detail: 'plan.md 全文の起草' },
    { title: '検証・レビュー', detail: '事実 grounding と計画妥当性の独立並列評価' },
    { title: '取り込み・収束', detail: '出典付き訂正の適用とリトライ収束ループ' },
  ],
}

// ---- 入力 ----
// args: { plan_path, repo_path, request, premise_path?, skill_review_report_path? }
// 呼び出し側が JSON 文字列で渡してしまった場合の fallback (本来は実 JSON object で渡す)
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (e) {
    throw new Error('args が JSON として解釈できない文字列で渡された: ' + e.message)
  }
}
if (!input || !input.plan_path || !input.repo_path || !input.request) {
  throw new Error('args に plan_path / repo_path / request が必要 (premise_path は任意)')
}
const PLAN_PATH = input.plan_path
const REPO = input.repo_path
const REQUEST = input.request
const PREMISE = input.premise_path || null
const SKILL_REVIEW_REPORT = input.skill_review_report_path || null // 既存 skill 改修の pre-plan 評価レポート (任意の参照入力。premise と並ぶ別チャネル)

// ---- schema (enum に null を使わず 'none' を番兵にする) ----
const EXPLORE_SCHEMA = {
  type: 'object',
  required: ['relevant_files', 'reusable_utilities', 'current_behavior', 'notes'],
  properties: {
    relevant_files: { type: 'array', items: { type: 'object', required: ['path', 'why'], properties: { path: { type: 'string' }, why: { type: 'string' } } } },
    reusable_utilities: { type: 'array', items: { type: 'object', required: ['path', 'symbol', 'on_integration_branch', 'branch_note'], properties: { path: { type: 'string' }, symbol: { type: 'string' }, on_integration_branch: { type: 'boolean' }, branch_note: { type: 'string' } } } },
    current_behavior: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
  },
}

const DRAFT_SCHEMA = {
  type: 'object',
  required: ['plan_md'],
  properties: { plan_md: { type: 'string' } },
}

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['mismatches'],
  properties: {
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'reality', 'how_verified', 'severity', 'has_source', 'source', 'corrected_text'],
        properties: {
          claim: { type: 'string' },
          reality: { type: 'string' },
          how_verified: { type: 'string' },
          severity: { enum: ['high', 'medium', 'low'] },
          has_source: { type: 'boolean' },
          source: { type: 'string', description: 'origin/master 上の path:line / sha。出典が無ければ空文字' },
          corrected_text: { type: 'string', description: '出典に基づく訂正文。出典が無ければ空文字' },
        },
      },
    },
  },
}

const FINDING_ITEM = {
  type: 'object',
  required: ['summary', 'status', 'severity', 'subtype', 'quote_text'],
  properties: {
    summary: { type: 'string', description: '指摘の自然言語要約 (1-2 文)。plan の特定の文・節に紐づけること' },
    status: { enum: ['problem', 'problem-none'] },
    severity: { enum: ['high', 'medium', 'low', 'none'], description: 'status=problem のとき high/medium/low。problem-none のとき none' },
    subtype: { enum: ['deferred-by-design', 'none'], description: 'status=problem-none で observe-driven の故意の未決のときのみ deferred-by-design' },
    quote_text: { type: 'string', description: 'subtype=deferred-by-design のとき、plan 本文の observe-driven 宣言の逐語抜粋 (200 文字以内)。それ以外は空文字' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: { findings: { type: 'array', items: FINDING_ITEM } },
}

const REREVIEW_SCHEMA = {
  type: 'object',
  required: ['prior_judgments', 'new_findings'],
  properties: {
    prior_judgments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'resolved', 'note'],
        properties: {
          id: { type: 'integer' },
          resolved: { type: 'boolean' },
          note: { type: 'string', description: 'resolved の根拠 (plan のどの変更で解消したか) / 未解消の理由' },
        },
      },
    },
    new_findings: { type: 'array', items: FINDING_ITEM },
  },
}

const REVISE_SCHEMA = {
  type: 'object',
  required: ['plan_md', 'change_notes'],
  properties: {
    plan_md: { type: 'string' },
    change_notes: { type: 'array', items: { type: 'string' } },
  },
}

// ---- 共有プロンプト断片 ----
const REVIEW_POLICY = `
レビュー方針 (厳守):
- 指摘の数より質を優先せよ。各指摘は plan の特定の文・節に紐づき、改修可能なアクションに紐づくこと。指摘ゼロでも問題なければそれは正当な出力。「観点 N 個ずつ何か言う」「観点ごとに 1 件以上」の網羅はしない (観点を増やすほど指摘下限が機械的に上がる観点インフレを起こさない)。
- status=problem-none の項目 (supportive / 変更不要 / 観測前提の未決) も findings に必ず含める。「指摘事項」だけを返すと母数が縮む。
- severity の基準: high = plan の Verification が不可能になる / スコープ外の再計画が必要 / plan の前提を覆す。medium = 改修すべきだが Verification は通る。low = nice-to-have。
- レビューは plan の内部整合 (前提と Verification の噛み合い・Approach の依存関係) に限定し、リポジトリを独自に調べない (repo level の事実確認は検証エージェントの領分)。
- deferred-by-design: plan が observe-driven 設計で v1 観測前提の未決を故意に残している論点は、status=problem-none, subtype=deferred-by-design とする。「決め切っていない」を「曖昧 → medium」と読み替えない。付ける場合は plan 本文の observe-driven 宣言 (「観測してから決める」等) を quote_text に逐語抜粋すること (200 文字以内・原文ママ)。抜粋できなければ deferred-by-design を付けない。quote_text は機械照合される (plan に含まれない抜粋は demote される)。`

function findingsTable(items) {
  return items.map((f) => `- F${f.id} [${f.severity}] ${f.summary}`).join('\n')
}

// ---- ヘルパ ----
let findings = []
function addFindings(rawList, round) {
  for (const raw of rawList) {
    findings.push({
      id: findings.length + 1,
      round,
      summary: raw.summary,
      status: raw.status,
      severity: raw.status === 'problem' ? (raw.severity === 'none' ? 'medium' : raw.severity) : 'none',
      subtype: raw.status === 'problem-none' ? raw.subtype : 'none',
      quote_text: raw.quote_text || '',
      quote_verified: false,
      resolved: false,
      resolved_round: null,
    })
  }
}
function verifyQuotes(plan) {
  for (const f of findings) {
    if (f.subtype === 'deferred-by-design') {
      f.quote_verified = !!f.quote_text && plan.includes(f.quote_text.trim())
    }
  }
}
function openProblems() {
  return findings.filter((f) => f.status === 'problem' && !f.resolved)
}
function openTotals() {
  const open = openProblems()
  return { high: open.filter((f) => f.severity === 'high').length, total: open.length }
}

// ============================================================
phase('調査')
const explore = await agent(
  `対象リポジトリ: ${REPO}
依頼: ${REQUEST}
${PREMISE ? `前提整理 (premise.md): ${PREMISE} を Read して Goal / Scope / Open questions を踏まえること。` : ''}
${SKILL_REVIEW_REPORT ? `skill-review レポート: ${SKILL_REVIEW_REPORT} を Read し、既存 skill の改善点 (逐語引用付き findings) を改善対象として踏まえること。機械照合は skill-review 側で済んでいるので再照合は不要、散文として読めばよい。` : ''}

この依頼の計画立案に必要な現状調査を行い、構造化して返せ:
- relevant_files: 変更・参照対象になりそうなファイル (path と理由)
- reusable_utilities: 再利用できる既存実装。各項目について統合ブランチ (既定 origin/master) 上に実在するかを確認し on_integration_branch に boolean で返す。作業ツリーや未マージの feature ブランチ・並走 worktree を根拠に「実在」と断定しない (確認手段は git -C <repo> grep -n <symbol> origin/master 等、裁量でよい)。branch_note に所在ブランチ・未マージなら「先行マージ待ちか自前新設か」の所見を書く。
- current_behavior: 依頼に関係する現状挙動の要点
- notes: 計画立案者に伝えるべき注意点・未決事項

調査のみ行う。コード変更・計画の提案はしない。`,
  { agentType: 'Explore', schema: EXPLORE_SCHEMA, label: 'explore', phase: '調査' },
)
if (!explore) throw new Error('調査エージェントが結果を返さなかった')
log(`調査完了: 関連 ${explore.relevant_files.length} files / 再利用候補 ${explore.reusable_utilities.length} 件`)

// ============================================================
phase('起草')
const draft = await agent(
  `あなたは計画起草担当。以下の入力から plan.md 全文 (markdown) を起草して plan_md として返せ。ファイルへの書き込みはしない (Write は呼び出し元の責務)。

依頼: ${REQUEST}
対象リポジトリ: ${REPO}
${PREMISE ? `前提整理 (premise.md): ${PREMISE} を Read して踏まえること。premise の Open questions は調査・起草で解消し、解消できなかったものだけ plan の Risks に繰り越す。` : ''}
${SKILL_REVIEW_REPORT ? `skill-review レポート: ${SKILL_REVIEW_REPORT} を Read し、既存 skill の改善点を計画の改善対象として踏まえること (散文として読む。再照合不要)。` : ''}
出力先 (参考情報): ${PLAN_PATH}

調査結果 (構造化済み):
${JSON.stringify(explore, null, 2)}

plan.md の構成:
- Context: 背景と目的 (なぜこの変更が必要か)
- Approach: 推奨案のみ。代替案は載せない
- Critical files: 変更対象のファイル (パターンが繰り返されるなら 1 回説明＋代表パス数件)
- Reusable utilities: 再利用する既存実装 (パス付き)。on_integration_branch=false のものは「先行マージ待ち」か「自前新設」かを Approach に明記する
- Verification: 実行・テスト方法
- Risks: 未解消の Open questions・前提リスク

調査結果に無い事実主張を足す場合は自分で Read/Glob/Grep で確認してから書く。learning loop 設計で v1 観測前提の未決を故意に残す論点は「観測してから決める」と明文化する。`,
  { schema: DRAFT_SCHEMA, label: 'draft', phase: '起草' },
)
if (!draft) throw new Error('起草エージェントが結果を返さなかった')
let plan = draft.plan_md

// ============================================================
phase('検証・レビュー')
// barrier が正当なケース: 訂正適用とレビュー集計の両方が両結果を必要とする
const [verify, review1] = await parallel([
  () =>
    agent(
      `対象リポジトリ: ${REPO}
以下の plan の各事実主張を実コードと照合し、不一致だけを mismatches で返せ。

照合規約:
- 照合対象は「現状こうなっている」という現状認識の主張 (Critical files のパス実在・Reusable utilities の所在/シグネチャ・現状挙動の前提) に限る。Approach / 編集案の「変更後こうする」という文は未施行の提案であり、現状ファイルに無くて当然＝不一致ではない (事実誤りに数えない)。
- アプローチの良し悪しは判断しない。
- 「実在」「再利用可」の確認は統合ブランチ (既定 origin/master) を基準にする。作業ツリーや並走 worktree の grep で「実在」と断定しない。
- 訂正に出典を出せる場合のみ has_source=true とし、source に origin/master 上の path:line / sha、corrected_text に訂正文を書く。出典を出せなければ has_source=false (source / corrected_text は空文字) とする。それらしい推測で訂正文を作らない。

--- plan ここから ---
${plan}
--- plan ここまで ---`,
      { agentType: 'Explore', schema: VERIFY_SCHEMA, label: 'verify', phase: '検証・レビュー' },
    ),
  () =>
    agent(
      `以下の plan をレビューせよ。ラウンド 1 の観点は「計画全体の前提」と「Verification の十分性」を重点に見る。
${REVIEW_POLICY}

元の依頼: ${REQUEST}

--- plan ここから ---
${plan}
--- plan ここまで ---`,
      { schema: REVIEW_SCHEMA, label: 'review:r1', phase: '検証・レビュー' },
    ),
])

const flags = { verify_failed: !verify, review_failed: !review1 }
addFindings(review1 ? review1.findings : [], 1)
verifyQuotes(plan)
log(`検証: 不一致 ${verify ? verify.mismatches.length : '取得失敗'} / レビュー: findings ${findings.length} 件`)

// ============================================================
phase('取り込み・収束')
const allMismatches = verify ? verify.mismatches : []
const sourced = allMismatches.filter((m) => m.has_source && m.source)
const unverified = allMismatches.filter((m) => !m.has_source || !m.source)
let correctionsApplied = []

async function revise(label, instruction) {
  const r = await agent(
    `あなたは plan の改稿担当。以下の指示の範囲だけ plan を書き直し、全文を plan_md として返せ。指示に無い変更 (自己判断の改善・レビュー観点の先回り反映・文体調整) を混ぜない。変更点を change_notes に列挙すること。

${instruction}

--- plan ここから ---
${plan}
--- plan ここまで ---`,
    { schema: REVISE_SCHEMA, label, phase: '取り込み・収束' },
  )
  if (r) plan = r.plan_md
  return r
}

if (sourced.length || unverified.length) {
  const r = await revise(
    'revise:corrections',
    `1. 出典付き訂正の適用 (これのみ plan の主張を書き換えてよい):
${JSON.stringify(sourced, null, 2)}
2. 出典の無い不一致は書き換えず、当該主張の直後に「(要確認: <実態の要約>)」マークを付ける:
${JSON.stringify(unverified, null, 2)}`,
  )
  if (r) correctionsApplied = sourced
}

// ---- リトライ収束ループ (severity:high が残る間。質的減少で停止・ハードリミット 2 回) ----
const MAX_RETRY = 2
let retries = 0
let secondaryDone = false
let stoppedBy = 'no-problem-high'
let reviewRounds = 1

async function reReview(label, lensNote) {
  const open = openProblems()
  const rr = await agent(
    `以下の plan は前ラウンドの指摘を受けて改稿された (または出典付き事実訂正が適用された)。
1. prior_judgments: 下記の未解決指摘それぞれについて、現在の plan で解消されたか resolved を判定し、根拠を note に書く。
2. new_findings: ${lensNote} 新しい観点を持ち込まない。既出指摘と同一論点を new_findings に再掲しない。
${REVIEW_POLICY}

未解決指摘:
${findingsTable(open)}

元の依頼: ${REQUEST}

--- plan ここから ---
${plan}
--- plan ここまで ---`,
    { schema: REREVIEW_SCHEMA, label, phase: '取り込み・収束' },
  )
  if (!rr) return false
  reviewRounds++
  for (const j of rr.prior_judgments) {
    const f = findings.find((x) => x.id === j.id)
    if (f && j.resolved) {
      f.resolved = true
      f.resolved_round = reviewRounds
      f.resolved_note = j.note
    }
  }
  addFindings(rr.new_findings, reviewRounds)
  verifyQuotes(plan)
  return true
}

while (openTotals().high > 0) {
  if (retries >= MAX_RETRY) {
    stoppedBy = 'hard-limit-2'
    break
  }
  retries++
  const prev = openTotals()
  const highs = openProblems().filter((f) => f.severity === 'high')
  await revise(
    `revise:retry-${retries}`,
    `前提を覆す指摘 (severity:high) への対応。以下の指摘を解消するように plan を書き直す:
${findingsTable(highs)}
medium / low の指摘はユーザ判断に委ねるため、この改稿では触らない。`,
  )
  const ok = await reReview(`review:r${reviewRounds + 1}`, '改稿で新たに生じた懸念のみを挙げる (残懸念観点)。')
  if (!ok) {
    stoppedBy = 'review-failed'
    break
  }
  const curr = openTotals()
  log(`リトライ ${retries}: open high ${prev.high}→${curr.high} / open total ${prev.total}→${curr.total}`)
  if (!(prev.high > curr.high) || !(prev.total >= curr.total)) {
    stoppedBy = 'quality-decrease-broken'
    break
  }
}

// ---- 修正起点の二次整合チェック (出典付き訂正があった場合に 1 回だけ) ----
if (correctionsApplied.length && stoppedBy === 'no-problem-high' && !secondaryDone) {
  secondaryDone = true
  const ok = await reReview('review:post-correction', '事実訂正の適用で新たに生じた整合性の懸念のみを挙げる。')
  if (ok) {
    stoppedBy = 'nested-recheck-done'
    // 二次チェックで high が立ったらリトライ枠に戻す (ハードリミットは共有)
    while (openTotals().high > 0 && retries < MAX_RETRY) {
      retries++
      const prev = openTotals()
      const highs = openProblems().filter((f) => f.severity === 'high')
      await revise(`revise:retry-${retries}`, `前提を覆す指摘 (severity:high) への対応:\n${findingsTable(highs)}`)
      const ok2 = await reReview(`review:r${reviewRounds + 1}`, '改稿で新たに生じた懸念のみを挙げる (残懸念観点)。')
      if (!ok2) {
        stoppedBy = 'review-failed'
        break
      }
      const curr = openTotals()
      if (!(prev.high > curr.high) || !(prev.total >= curr.total)) {
        stoppedBy = 'quality-decrease-broken'
        break
      }
    }
    if (openTotals().high > 0 && retries >= MAX_RETRY) stoppedBy = 'hard-limit-2'
  }
}

// ============================================================
// 4 状態の確定 (script の決定論計算。件数保存則は構造的に成立する)
for (const f of findings) {
  if (f.status === 'problem') {
    f.state = f.resolved ? '対応済み' : '要判断'
  } else if (f.subtype === 'deferred-by-design') {
    f.state = f.quote_verified ? '保留-設計上意図' : '要判断'
  } else {
    f.state = '対応不要'
  }
}
const totals = {
  count: findings.length,
  resolved: findings.filter((f) => f.state === '対応済み').length,
  needs_decision: findings.filter((f) => f.state === '要判断').length,
  no_action: findings.filter((f) => f.state === '対応不要').length,
  deferred: findings.filter((f) => f.state === '保留-設計上意図').length,
}
log(`収束: ${totals.count} 件 (対応済み ${totals.resolved} / 要判断 ${totals.needs_decision} / 対応不要 ${totals.no_action} / 保留 ${totals.deferred}) stopped_by=${stoppedBy}`)

return {
  plan_md: plan,
  corrections_applied: correctionsApplied,
  unverified_marks: unverified,
  findings,
  totals,
  retry_log: { rounds_executed: reviewRounds, retries, stopped_by: stoppedBy },
  flags,
}
