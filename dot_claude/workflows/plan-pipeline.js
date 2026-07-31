export const meta = {
  name: 'plan-pipeline',
  description: 'plan スキルの検証・レビューパイプライン: 本体が起草した plan を検証/レビュー(並列)→出典付き訂正→リトライ収束に掛ける。件数・状態の集計は script がコードで計算し、自己申告に依存しない。起草は本体 (main) の直営で、この workflow は plan を作らない',
  whenToUse: 'plan スキル本体 (SKILL.md) から scriptPath 指定で起動される。単体起動は想定しない',
  phases: [
    { title: '検証・レビュー', detail: '事実 grounding と計画妥当性 (目的整合・設計・Phase・検証) の独立並列評価' },
    { title: '取り込み・収束', detail: '出典付き訂正の適用とリトライ収束ループ' },
  ],
}

// ---- 入力 ----
// args: { plan_md, repo_path, request, premise_path? }
// plan_md は本体が起草した plan.md の全文 (workflow script は filesystem を読めないため、パスでなく本文を渡す)
// 呼び出し側が JSON 文字列で渡してしまった場合の fallback (本来は実 JSON object で渡す)
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (e) {
    throw new Error('args が JSON として解釈できない文字列で渡された: ' + e.message)
  }
}
if (!input || !input.plan_md || !input.repo_path || !input.request) {
  throw new Error('args に plan_md / repo_path / request が必要 (premise_path は任意)')
}
const REPO = input.repo_path
const REQUEST = input.request
const PREMISE = input.premise_path || null

// ---- schema (enum に null を使わず 'none' を番兵にする) ----
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
          source: { type: 'string', description: 'origin/main 上の path:line / sha。出典が無ければ空文字' },
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
- レビューはリポジトリを独自に調べない (repo level の事実確認は検証エージェントの領分)。

評価観点 (plan の節構成に応じて該当するもののみ評価。該当節が無い観点で指摘を作らない):
- 目的整合 (premise.md がある場合のみ評価): premise.md の Purpose (目的) / Acceptance (受入条件) と plan の Context / Verification / Approach / Design / Phase が対応しているか。premise.md の Purpose / Acceptance を plan の本体側で再定義していないか (sear-me が正本)。
- 設計妥当性 (Design 節があるときのみ評価): 責務境界の妥当性・依存方向・抽象の粒度・再利用判断 (Reusable utilities との整合)・YAGNI 違反・複雑度。
- Phase 妥当性 (Phase 節があるときのみ評価): 粒度・順序・依存関係・各 Phase の独立検証可能性・可逆性・落としどころ。
- 暗黙の設計判断 (常時評価): 選択肢が複数ありうる設計分岐を、plan が分岐の記録なしに片方へ暗黙に倒している箇所を指摘する。設計判断レコードに並ぶ分岐が全て同じ前提 (既存構造の温存・特定の格納方式など) を共有している場合、その前提自体が暗黙の選択でないかも見る。指摘の summary には分岐の選択肢を簡潔な a/b/c の形 (各選択肢の trade-off を 1 句ずつ) で含め、ユーザが承認ゲートで判断できる形にする。Design 節の設計判断レコードに記録済みの分岐は指摘しない (記録があれば plan の判断として尊重し、記録の妥当性は設計妥当性の観点で見る)。
- 検証十分性 (常時評価): Verification 節が Approach / Design / Phase の各成果を覆えているか。Phase 節があれば Phase 別に検証可能か。逆方向も同じ観点で評価する——検証装置が成果物より大きい・Acceptance の観測に不要な検証基盤の新設は過大として指摘する (検証の比例性)。変更がテスト可能なロジックを含むのに Verification が TDD 適用/不適用のどちらも宣言していない、または不適用の理由が立っていない場合も指摘する。
- 内部整合 (常時評価): Context・Approach・Design・Phase・Verification の前提が噛み合っているか。
- 前提の出典 (常時評価): Approach・Design・Phase の決定が依存する運用前提 (配備・リリースの順序・migration の実行系・DB 設定・外部システムの挙動) に、plan 内の出典 (path:line / 実測) が併記されているか。出典の無い運用前提の上に決定が載っていれば指摘する (一般常識からの推測は出典にならない)。plan 自身が Risks で「未検証前提」と明示しているものは指摘しない (明示があること自体が対応)。

severity の基準:
- high: 目的を達成しない設計 / 致命的な手戻り構造 (Phase 順序が不可逆性を壊す等) / Verification が不可能になる / plan の前提を覆す事実誤認 / スコープ外の再計画が必要。
- medium: 改修すべきだが上記の致命性は無い。
- low: nice-to-have。

deferred-by-design: plan が observe-driven 設計で v1 観測前提の未決を故意に残している論点は、status=problem-none, subtype=deferred-by-design とする。「決め切っていない」を「曖昧 → medium」と読み替えない。付ける場合は plan 本文の observe-driven 宣言 (「観測してから決める」等) を quote_text に逐語抜粋すること (200 文字以内・原文ママ)。抜粋できなければ deferred-by-design を付けない。quote_text は機械照合される (plan に含まれない抜粋は demote される)。`

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

let plan = input.plan_md

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
- 設計判断レコードの選択理由・却下理由・既定採用の根拠に埋まった事実主張 (ライブラリやフレームワークの挙動・呼び出し関係・既存流儀の実在) も照合対象とする。理由の中の事実が誤っていると、決定そのものが空の根拠に載る。
- アプローチの良し悪しは判断しない。
- 「実在」「再利用可」の確認は統合ブランチ (既定 origin/main) を基準にする。作業ツリーや並走 worktree の grep で「実在」と断定しない。
- 訂正に出典を出せる場合のみ has_source=true とし、source に origin/main 上の path:line / sha、corrected_text に訂正文を書く。出典を出せなければ has_source=false (source / corrected_text は空文字) とする。それらしい推測で訂正文を作らない。

--- plan ここから ---
${plan}
--- plan ここまで ---`,
      { agentType: 'Explore', schema: VERIFY_SCHEMA, label: 'verify', phase: '検証・レビュー' },
    ),
  () =>
    agent(
      `以下の plan をレビューせよ。

評価手順:
1. plan の節構成を確認する (Design 節の有無 / Phase 節の有無 / premise.md の有無)。
2. 該当する観点だけを評価する。該当節が無い観点で指摘を作らない (例: Design 節が無い軽量 plan で責務境界を指摘しない・Phase 節が無い plan で順序の可逆性を指摘しない)。
3. 該当節がある場合、設計妥当性 / Phase 妥当性は重点的に評価する (この plan の核なので、無評価で通さない)。
4. 内部整合と検証十分性は常時評価する。

${REVIEW_POLICY}

元の依頼: ${REQUEST}
${PREMISE ? `前提整理 (premise.md): ${PREMISE} を Read し、目的整合の評価軸とせよ (premise の Purpose / Acceptance と plan の Context / Verification / Phase 別受入の対応を見る。Verification と Phase 別受入は Acceptance を辿れる粒度か、Context は Purpose を抜き書きで反映しているかを判定軸にする)。` : '前提整理 (premise.md) は存在しない。目的整合の観点はスキップする。'}

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
    `あなたは plan の改稿担当。以下の指示の範囲だけ plan を書き直し、全文を plan_md として返せ。指示に無い変更 (自己判断の改善・レビュー観点の先回り反映・既存文の文体調整) を混ぜない。ただし、指示された訂正・指摘の対象が plan 内の複数箇所に再記述されている場合は、その全箇所に同じ訂正を当てる (片方だけ直して plan 内部の矛盾を残さない。これは指示の範囲内)。変更点を change_notes に列挙すること。新たに書き足す地の文は ~/.claude/output-style.md を Read してその規約に従わせる (即席の合成名詞で概念を圧縮しない等。既存文には手を付けない)。

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
    `severity:high の指摘 (目的未達設計・致命的手戻り構造・Verification 不可能化・前提誤認等) への対応。以下の指摘を解消するように plan を書き直す。指摘の解消に必要な範囲なら Design / Phase 節の新設・改変を行ってよい:
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
