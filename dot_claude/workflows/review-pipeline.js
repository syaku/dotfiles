export const meta = {
  name: 'review-pipeline',
  description: 'develop のレビュー収束パイプライン: 観点別の並列レビュー→反証点検と重複統合→修正→再レビューを、修正対象ゼロ / 前進なし / ラウンド上限のいずれか早い方まで回す。修正対象の絞り込み・ラウンド計数・前進判定・件数集計は script がコードで計算し、自己申告に依存しない。bundled の /code-review がモデルから起動できない (disable-model-invocation) ため収束ゲートの計器を自前で持つ',
  whenToUse: 'develop スキル本体 (SKILL.md) から scriptPath 指定で起動される。単体起動は想定しない',
  phases: [
    { title: 'レビュー', detail: '実装差分を観点別の agent が並列にレビューし、findings を出す' },
    { title: '点検', detail: '反証点検で偽陽性を落とし、重複を統合し、再現条件を名指しできるかで verdict を決める' },
    { title: '収束', detail: '修正対象の指摘だけを修正 → 再レビューを、対象ゼロ / 前進なし / ラウンド上限まで繰り返す' },
  ],
}

// ---- 入力 ----
// args: { request, worktree_cwd, side_effect_ban, plan_path?, changed_files?, max_rounds?, wide_net?, source_note? }
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (e) {
    throw new Error('args が JSON として解釈できない文字列で渡された: ' + e.message)
  }
}
if (!input || !input.request || !input.worktree_cwd || !input.side_effect_ban) {
  throw new Error('args に request / worktree_cwd / side_effect_ban が必要 (plan_path / changed_files / max_rounds / wide_net は任意)')
}
const REQUEST = input.request
const WORKTREE = input.worktree_cwd
const SIDE_EFFECT_BAN = input.side_effect_ban
const PLAN_PATH = input.plan_path || null
const CHANGED_FILES = Array.isArray(input.changed_files) ? input.changed_files : []
// ラウンド上限。既定 5。agent 数は Round 1 が 6 個 (観点 4 + 点検 1 + 修正 1)、以降が 2 個 (再レビュー・修正) で、
// 上限 5 なら最大 14 個 (workflow size guideline の medium = 15 未満の範囲)
const MAX_ROUNDS = Number.isInteger(input.max_rounds) && input.max_rounds > 0 ? input.max_rounds : 5
// 網の広さ。既定は確信のあるものだけ (偽陽性を減らす)。true で確信の薄い候補も拾う
const WIDE_NET = input.wide_net === true
// 修正 agent に渡す「正本の所在」注意。skill トラックでは chezmoi source を指す文を呼び出し元が渡す。
// トラック固有の規約を script にハードコードしないための引数
const SOURCE_NOTE = typeof input.source_note === 'string' ? input.source_note : ''

// ---- schema ----
const FINDING_ITEM = {
  type: 'object',
  required: ['short_summary', 'summary', 'failure_scenario', 'category', 'severity', 'pre_existing', 'file', 'evidence'],
  properties: {
    short_summary: { type: 'string', description: '60 文字以内のラベル。主張だけを書き、理由や影響の節を付けない' },
    summary: { type: 'string', description: '欠陥を 1 文で述べる' },
    failure_scenario: { type: 'string', description: '具体的な入力・状態 → 誤った出力・クラッシュ。「〜の可能性がある」で終わらせず、何を渡すとどう壊れるかを名指しする。書けない指摘は出さない' },
    category: { enum: ['correctness', 'security', 'boundary', 'regression', 'convention'], description: 'correctness=ロジック誤り / security=データ保護・認可 / boundary=境界とエラー経路 / regression=既存挙動の破壊 / convention=CLAUDE.md や rules 由来の規約違反' },
    severity: { enum: ['high', 'medium', 'low'], description: 'high=本番で壊れる・データを壊す・情報が漏れる / medium=直すべき欠陥 / low=直せば良くなる程度。category=convention は原則 low' },
    pre_existing: { type: 'boolean', description: 'この差分が持ち込んだものではなく、以前からコードベースにある欠陥なら true。差分の外にある不備はここで true にする' },
    file: { type: 'string', description: '指摘対象のファイルパス' },
    line: { type: 'integer', description: '該当行 (特定できないときは 0)' },
    evidence: { type: 'string', description: '該当コードの逐語抜粋 (200 文字以内)。命名からの推測ではなく実コードを引く。抜粋できない指摘は出さない' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: { findings: { type: 'array', items: FINDING_ITEM } },
}

const TRIAGE_SCHEMA = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'verdict', 'reason', 'duplicate_of'],
        properties: {
          id: { type: 'integer' },
          verdict: { enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'], description: 'CONFIRMED=失敗に至る入力・状態を実コードで名指しできる / PLAUSIBLE=否定できないが再現条件を名指しできない / REFUTED=問題でないと実コードで確認できた' },
          reason: { type: 'string', description: '判定の根拠。実コードのどこを見たか。指摘の言い換えで済ませない' },
          duplicate_of: { type: 'integer', description: '同一論点の先行指摘があればその id。無ければ 0' },
        },
      },
    },
  },
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
          note: { type: 'string', description: 'resolved の根拠 (どの変更で解消したか) / 未解消の理由' },
        },
      },
    },
    new_findings: { type: 'array', items: FINDING_ITEM },
  },
}

const FIX_SCHEMA = {
  type: 'object',
  required: ['summary', 'changed_files', 'self_check'],
  properties: {
    summary: { type: 'string', description: '対応概要 (指摘ごとに何をしたか)' },
    changed_files: { type: 'array', items: { type: 'string' }, description: '修正で触れたファイルの絶対パス一覧' },
    self_check: { type: 'string', description: '修正後の自己確認結果 (各指摘に対応できたか・他を壊していないか)' },
  },
}

// ---- 共有プロンプト断片 ----
const FINDING_BAR = `
指摘のバー (厳守):
- **failure_scenario を書けない指摘は出さない。** 「具体的な入力・状態 → 誤った出力・クラッシュ」の形で、何を渡すとどう壊れるかを名指しする。「〜の可能性がある」「〜が考慮されていない恐れ」で終わる指摘は出さない。
- **evidence は実コードの逐語抜粋。** 命名や型からの推測で挙動を主張しない。
- 探すのは本番で壊れるもの。整形の好み・命名の趣味・テストカバレッジの不足は対象外 (品質のクリーンアップは実装工程で済んでいる)。
- **差分が持ち込んだ欠陥と、以前からある欠陥を区別する。** 以前からあるものは pre_existing=true にする (修正対象から外れ、報告に回る。スコープ外の修正でラウンドを浪費しないため)。
- CLAUDE.md や rules 由来の規約違反は category=convention・severity=low とする (直す価値はあるがマージを止めるものではない)。
- severity は「放置したら何が起きるか」で決める。直せば良くなる程度のものを high にしない。
- 指摘ゼロは正当な出力。「観点ごとに 1 件以上」の網羅はしない (観点を増やすほど指摘下限が機械的に上がる観点インフレを起こさない)。
${WIDE_NET ? '- 網は広く取る。確信が薄い候補も挙げてよい (後段の点検で落ちる)。' : '- **確信のあるものだけ挙げる。** 迷う候補は挙げない (偽陽性 1 件がユーザーの往復 1 回分のコストになる)。'}`

// 観点別のレビュー agent。公式 Code Review が「複数 agent が別クラスの問題を並列に探し、
// 検証段が偽陽性を落とし、重複を統合して severity 順に並べる」構成を採っているのに倣う。
const LENSES = [
  {
    key: 'correctness',
    focus: `ロジックの誤り。条件の反転・オフバイワン・取り違えた変数・誤った演算順序・状態遷移の抜け・非同期処理の競合。分岐を実際に辿って、意図した値が出るかを確かめる。`,
  },
  {
    key: 'boundary',
    focus: `境界とエラー経路。空・null・0 件・1 件・上限超過・型境界の扱い。例外が投げられたときに何が起きるか、途中で失敗したときに中途半端な状態が残らないか。エラーを握り潰して成功として返す経路。`,
  },
  {
    key: 'security',
    focus: `データ保護と認可。認可チェックの欠落・他人のデータが見える経路・ログや例外メッセージへの個人情報の混入・入力の検証漏れ・SQL や外部コマンドへの値の埋め込み。`,
  },
  {
    key: 'regression',
    focus: `既存挙動の破壊。共有されている関数・DTO・SQL・設定を変えたことで、この差分が触っていない呼び出し元が壊れないか。差分の外にある利用箇所を grep で洗い、前提が崩れていないか確かめる。`,
  },
]

function diffBlock() {
  return `対象の差分を自分で確認する。作業ツリー (cwd): ${WORKTREE}
git diff と git status --porcelain で変更内容を把握する (未追跡ファイルは git diff に出ないので git status で拾い、Read で本文を読む)。
${CHANGED_FILES.length ? `実装工程が申告した変更ファイル (起点情報。これだけを見て済ませず、差分の実体を自分で確認する):\n${CHANGED_FILES.map((f) => `- ${f}`).join('\n')}` : ''}
${PLAN_PATH ? `計画 (背景の参照用。計画との突合そのものは別工程の担当): ${PLAN_PATH}` : ''}
元の依頼: ${REQUEST}`
}

// ---- ヘルパ ----
let findings = []
function addFindings(rawList, round, lens) {
  for (const raw of rawList) {
    findings.push({
      id: findings.length + 1,
      round,
      lens: lens || 'rereview',
      short_summary: (raw.short_summary || '').slice(0, 60),
      summary: raw.summary,
      failure_scenario: raw.failure_scenario,
      category: raw.category,
      // category=convention は severity を low に正規化する (規約違反でマージを止めない方針をコードで担保)
      severity: raw.category === 'convention' ? 'low' : raw.severity,
      pre_existing: raw.pre_existing === true,
      file: raw.file,
      line: Number.isInteger(raw.line) ? raw.line : 0,
      evidence: (raw.evidence || '').slice(0, 200),
      verdict: 'PLAUSIBLE',
      triage_reason: '',
      duplicate_of: 0,
      resolved: false,
      resolved_round: null,
      resolved_note: '',
    })
  }
}

// 修正対象の判定はコードが持つ (agent の申告に委ねない)。
// 対象は「この差分が持ち込んだ」かつ「high または medium」かつ「偽陽性でも重複でもない」もの。
// low (nit) と pre_existing を対象から外すのは、それらが残るだけでラウンドを食い潰す構造を断つため。
// PLAUSIBLE は high のみ対象 (再現条件を名指しできない medium で修正を走らせない)。
function isFixTarget(f) {
  if (f.resolved || f.verdict === 'REFUTED' || f.duplicate_of) return false
  if (f.pre_existing) return false
  if (f.severity === 'low') return false
  if (f.verdict === 'PLAUSIBLE' && f.severity !== 'high') return false
  return true
}
function fixTargets() {
  return findings.filter(isFixTarget)
}
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }
function bySeverity(a, b) {
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id - b.id
}
function findingsTable(items) {
  return items.map((f) => `- F${f.id} [${f.severity}/${f.category}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.summary}\n  失敗の筋道: ${f.failure_scenario}`).join('\n')
}
function emptyResult(stoppedBy, flags) {
  return {
    findings: [],
    totals: { count: 0, fix_targets: 0, resolved: 0, refuted: 0, duplicates: 0, pre_existing: 0, nits: 0, remaining: 0 },
    fixes: [],
    changed_files: [],
    rounds: [],
    converged: false,
    stopped_by: stoppedBy,
    flags,
  }
}

// ============================================================
phase('レビュー')
// 観点別に並列で走らせる。barrier が正当なケース: 次段の点検が全観点の findings を一度に見て重複を統合する
const lensResults = await parallel(
  LENSES.map((lens) => () =>
    agent(
      `あなたはコードレビュー担当。直前の実装で入った差分を、下記の観点に絞ってレビューし findings を返せ。コードの修正・編集はしない (Read/Glob/Grep と読み取りの Bash のみ)。

担当する観点: ${lens.focus}
この観点の外にあるものは他の担当が見るので挙げない。
${FINDING_BAR}

${diffBlock()}`,
      { agentType: 'Explore', schema: REVIEW_SCHEMA, label: `review:${lens.key}`, phase: 'レビュー' },
    ),
  ),
)
const lensOk = lensResults.filter(Boolean).length
if (!lensOk) {
  log('全観点のレビュー agent が結果を返さなかった (review_failed)')
  return emptyResult('review-failed', { review_failed: true, triage_failed: false, fix_failed: false, lenses_missing: LENSES.length })
}
lensResults.forEach((r, i) => {
  if (r) addFindings(r.findings, 1, LENSES[i].key)
})
const lensesMissing = LENSES.length - lensOk
log(`Round 1 レビュー: ${lensOk}/${LENSES.length} 観点が完了 / findings ${findings.length} 件${lensesMissing ? `（${lensesMissing} 観点は取得失敗）` : ''}`)

// ============================================================
phase('点検')
// 自前計器は bundled の /code-review より偽陽性が出やすいため、独立 agent が反証側から点検し重複を統合する。
// 2 ラウンド目以降は再レビューが同じ役割を兼ねる (前ラウンドで点検済みの母数に対する差分評価になる)。
let triageFailed = false
if (findings.length) {
  const triage = await agent(
    `あなたは指摘の点検担当。下記のレビュー指摘それぞれについて、実コードを見て verdict を決め、重複を統合せよ。コードの修正・編集はしない。

verdict の決め方:
- **CONFIRMED** — 失敗に至る入力・状態を実コードで名指しできる。その筋道を reason に書く。
- **PLAUSIBLE** — 否定はできないが、再現条件を名指しできない。
- **REFUTED** — 実際には問題でないと実コードで確認できた。何がそれを担保しているかを reason に書く。

- **迷ったら PLAUSIBLE に留める。** REFUTED は「担保している実装を名指しできる」ときだけ。
- よくある偽陽性: 呼び出し元で既に検証済みの入力を未検証と見ている / 到達しない分岐を問題と見ている / 別レイヤが担保している前提を欠落と見ている / 命名から挙動を推測している。
- 複数の観点担当が同じ論点を別の言葉で挙げていることがある。**同一論点なら、最も具体的な 1 件を残し、他は duplicate_of にその id を入れる** (重複した指摘に別々の修正を当てさせないため)。

作業ツリー (cwd): ${WORKTREE}

指摘一覧:
${JSON.stringify(
  findings.map((f) => ({ id: f.id, lens: f.lens, category: f.category, severity: f.severity, file: f.file, line: f.line, summary: f.summary, failure_scenario: f.failure_scenario, evidence: f.evidence })),
  null,
  2,
)}`,
    { agentType: 'Explore', schema: TRIAGE_SCHEMA, label: 'triage:r1', phase: '点検' },
  )
  if (!triage) {
    triageFailed = true
    log('点検 agent が結果を返さなかった (triage_failed)。全指摘を PLAUSIBLE のまま続行')
  } else {
    for (const v of triage.verdicts) {
      const f = findings.find((x) => x.id === v.id)
      if (!f) continue
      f.verdict = v.verdict
      f.triage_reason = v.reason
      // 自己参照・前方参照の duplicate_of は無効にする (id は採番順なので先行 id のみ有効)
      if (Number.isInteger(v.duplicate_of) && v.duplicate_of > 0 && v.duplicate_of < f.id) f.duplicate_of = v.duplicate_of
    }
    log(
      `点検: CONFIRMED ${findings.filter((f) => f.verdict === 'CONFIRMED').length} / PLAUSIBLE ${findings.filter((f) => f.verdict === 'PLAUSIBLE').length} / REFUTED ${findings.filter((f) => f.verdict === 'REFUTED').length} / 重複 ${findings.filter((f) => f.duplicate_of).length}`,
    )
  }
}
log(`修正対象: ${fixTargets().length} 件（low と pre_existing は報告のみ）`)

// ============================================================
phase('収束')
const fixes = []
const rounds = [{ round: 1, new_findings: findings.length, fix_targets: fixTargets().length }]
let changedFiles = []
let round = 1
let stoppedBy = fixTargets().length ? 'in-progress' : 'no-fix-targets'
let fixFailed = false
let reviewFailed = false

while (fixTargets().length) {
  if (round >= MAX_ROUNDS) {
    stoppedBy = 'round-limit'
    break
  }
  const prevTargets = fixTargets().length

  // --- 修正 ---
  const targets = fixTargets().sort(bySeverity)
  const fix = await agent(
    `あなたは修正担当。下記のレビュー指摘への対応のみ行う。指摘に無い改善・リファクタ・自己判断の変更を混ぜない。

依頼: ${REQUEST}
${PLAN_PATH ? `計画: ${PLAN_PATH} — 修正がこの計画の決定事項と矛盾しないことを確認せよ。\n` : ''}作業ツリー (cwd): ${WORKTREE} — すべての編集はこのツリー内で行う。
副作用禁止: ${SIDE_EFFECT_BAN}
${SOURCE_NOTE}

指摘は severity の高い順に並んでいる。上から対応する。
${findingsTable(targets)}

各指摘の failure_scenario が起きなくなることを対応の基準にする。表面的に条件を足して塞ぐのではなく、その筋道が成立しない形にする。
修正後、修正したファイルを読み直して自己確認する: (a) 各指摘の failure_scenario が解消したか (b) 他を壊していないか。結果を self_check に書く。
返却: summary (対応概要) / changed_files (修正で触れたファイルの絶対パス一覧) / self_check。`,
    { schema: FIX_SCHEMA, label: `fix:r${round}`, phase: '収束' },
  )
  if (!fix) {
    fixFailed = true
    stoppedBy = 'fix-failed'
    log(`Round ${round} 修正 agent が結果を返さなかった (fix_failed)。指摘は残置`)
    break
  }
  fixes.push({ round, summary: fix.summary, changed_files: fix.changed_files || [], self_check: fix.self_check })
  changedFiles = Array.from(new Set([...changedFiles, ...(fix.changed_files || [])]))

  // --- 再レビュー ---
  round++
  const rr = await agent(
    `以下の作業ツリーは、前ラウンドのレビュー指摘を受けて修正された。
1. prior_judgments: 下記の未解決指摘それぞれについて、**failure_scenario が成立しなくなったか**を実コードで判定し、resolved と根拠を返す。表面的な条件追加で筋道が残っているなら resolved=false にする。
2. new_findings: 修正で新たに生じた欠陥のみを挙げる。**severity=high 相当のものだけに絞る** (初回で挙げ切れなかった軽微な指摘をここで足すと収束しない)。既出指摘と同一論点を再掲しない。新しい観点を持ち込まない。

${FINDING_BAR}

未解決指摘:
${findingsTable(targets)}

${diffBlock()}`,
    { agentType: 'Explore', schema: REREVIEW_SCHEMA, label: `review:r${round}`, phase: '収束' },
  )
  if (!rr) {
    reviewFailed = true
    stoppedBy = 'review-failed'
    log(`Round ${round} 再レビュー agent が結果を返さなかった (review_failed)`)
    break
  }
  for (const j of rr.prior_judgments) {
    const f = findings.find((x) => x.id === j.id)
    if (f && j.resolved) {
      f.resolved = true
      f.resolved_round = round
      f.resolved_note = j.note
    }
  }
  // 再レビューの新規指摘は点検を通っていないため CONFIRMED を名乗らせない (既定の PLAUSIBLE のまま)。
  // isFixTarget により、PLAUSIBLE は high だけが次ラウンドの修正対象になる
  addFindings(rr.new_findings, round, 'rereview')
  const remaining = fixTargets().length
  rounds.push({ round, new_findings: rr.new_findings.length, fix_targets: remaining })
  log(`Round ${round}: 修正対象 ${prevTargets} → ${remaining}`)

  if (!remaining) {
    stoppedBy = 'converged'
    break
  }
  // 前進なしの早期停止: 修正対象が前ラウンドから厳密に減っていなければ、修正の空転か計画側の誤りのシグナル。
  // 上限を待たずに止めて本体からユーザーへ報告させる
  if (!(remaining < prevTargets)) {
    stoppedBy = 'no-progress'
    break
  }
}

findings.sort(bySeverity)
const totals = {
  count: findings.length,
  fix_targets: fixTargets().length,
  resolved: findings.filter((f) => f.resolved).length,
  refuted: findings.filter((f) => f.verdict === 'REFUTED').length,
  duplicates: findings.filter((f) => f.duplicate_of).length,
  // 報告に回る 2 種 (修正対象から外したもの)。マージ前にユーザーが目で見る対象
  pre_existing: findings.filter((f) => f.pre_existing && !f.duplicate_of && f.verdict !== 'REFUTED').length,
  nits: findings.filter((f) => f.severity === 'low' && !f.pre_existing && !f.duplicate_of && f.verdict !== 'REFUTED').length,
}
totals.remaining = totals.fix_targets
log(
  `収束: ${totals.count} 件 (解消 ${totals.resolved} / 偽陽性 ${totals.refuted} / 重複 ${totals.duplicates} / 既存 ${totals.pre_existing} / nit ${totals.nits} / 未対応 ${totals.fix_targets}) rounds=${rounds.length} stopped_by=${stoppedBy}`,
)

return {
  findings,
  totals,
  fixes,
  changed_files: changedFiles,
  rounds,
  converged: stoppedBy === 'converged' || stoppedBy === 'no-fix-targets',
  stopped_by: stoppedBy,
  flags: { review_failed: reviewFailed, triage_failed: triageFailed, fix_failed: fixFailed, lenses_missing: lensesMissing },
}
