export const meta = {
  name: 'review-pipeline',
  description: 'develop のレビュー収束パイプライン: bundled の code-review workflow を名指しで呼んで観点別レビューと独立検証を委譲し、本家に無い security 観点だけ自前で並走させ、修正→再レビューを対象ゼロ / 前進なし / ラウンド上限まで回す。規模判定・cap 到達検出・修正対象の絞り込み・前進判定・件数集計は script がコードで計算し、自己申告に依存しない',
  whenToUse: 'develop スキル本体 (SKILL.md) から scriptPath 指定で起動される。単体起動は想定しない',
  phases: [
    { title: 'レビュー', detail: 'bundled code-review を呼び、本家に無い security 観点と呼び出し元が渡した追加観点を並走させる。失敗時は自前の観点別 finder に落ちる' },
    { title: '点検', detail: '本家の検証を通っていない候補だけを点検し、本家 findings との重複を統合する' },
    { title: '収束', detail: '修正対象の指摘だけを修正 → 再レビューを、対象ゼロ / 前進なし / ラウンド上限まで繰り返す' },
  ],
}

// ---- 入力 ----
// args: { request, worktree_cwd, side_effect_ban, plan_path?, changed_files?, changed_files_actual?,
//         diff_stat?, diff_command?, max_rounds?, source_note? }
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (e) {
    throw new Error('args が JSON として解釈できない文字列で渡された: ' + e.message)
  }
}
if (!input || !input.request || !input.worktree_cwd || !input.side_effect_ban) {
  throw new Error('args に request / worktree_cwd / side_effect_ban が必要 (plan_path / changed_files / changed_files_actual / diff_stat / diff_command / max_rounds / source_note は任意)')
}
const REQUEST = input.request
const WORKTREE = String(input.worktree_cwd).replace(/\/+$/, '')
const SIDE_EFFECT_BAN = input.side_effect_ban
const PLAN_PATH = input.plan_path || null
// 実装工程の自己申告。起点情報にとどめ、pre_existing 判定の正本にはしない
const CHANGED_FILES = Array.isArray(input.changed_files) ? input.changed_files : []
// git diff --name-only の実測。pre_existing 判定の正本。呼び出し元 (develop) が Bash で取って渡す
const CHANGED_FILES_ACTUAL = Array.isArray(input.changed_files_actual) ? input.changed_files_actual : []
// git diff --numstat の集計 { files, insertions, deletions }。規模判定の入力
const DIFF_STAT = input.diff_stat && typeof input.diff_stat === 'object' ? input.diff_stat : null
// 本家に渡す diff コマンド。渡されなければ worktree の未コミット差分を既定にする。
// Scope agent の推測に任せず逐語で指定するのは、Round 1 と再レビューが見る母数を揃えるため
const DIFF_COMMAND = typeof input.diff_command === 'string' && input.diff_command ? input.diff_command : `git -C ${WORKTREE} diff HEAD`
const MAX_ROUNDS = Number.isInteger(input.max_rounds) && input.max_rounds > 0 ? input.max_rounds : 5
const SOURCE_NOTE = typeof input.source_note === 'string' ? input.source_note : ''
// 追加の観点。本家の角度 A〜E と cleanup 5 レンズに無いものを Round 1 に並走させる。
// script にハードコードせず呼び出し元から受けるのは、業務固有の規約・思想を同期される正本に置かないため。
// 並走なので本家の maxFindings / perAngle cap の影響を受けない。
//   key    ラベル
//   focus  観点の本文（何を探すか。具体名で書くほど効く）
//   category 'correctness'=修正ループに入る / 'cleanup'=報告のみ（既定）
//   context 参照させたい情報（docs のルート・索引・規約の所在など）
//   requires_rationale  true なら乖離の理由の所在も返させ、理由が無いものを収束の妨げとして扱う
const EXTRA_LENSES = (Array.isArray(input.extra_lenses) ? input.extra_lenses : [])
  .filter((l) => l && typeof l.key === 'string' && typeof l.focus === 'string' && l.key && l.focus)
  .map((l) => ({
    key: l.key,
    focus: l.focus,
    category: l.category === 'correctness' ? 'correctness' : 'cleanup',
    context: typeof l.context === 'string' ? l.context : '',
    requires_rationale: l.requires_rationale === true,
  }))

// ---- 規模判定 ----
// 既定は xhigh。high に落とすのは「角度を絞っても取りこぼしが出ない」と言える規模だけに限る。
// 誤分類のコストが非対称 (重すぎ = token 浪費 / 軽すぎ = 見逃したまま無人で PR まで進む) なので重い方へ倒す。
// 閾値の根拠: 実測で 1 ファイル 38 行の差分が high の perAngle cap (6) に張り付いた。
// その半分程度なら角度が絞られずに働くという外挿で、確定値ではなく計装の初期設定。
const HIGH_MAX_FILES = 1
const HIGH_MAX_LINES = 20
function decideLevel() {
  if (!DIFF_STAT) return { level: 'xhigh', reason: 'diff_stat 無し (判定材料が無いので重い方へ)' }
  const files = Number(DIFF_STAT.files)
  const ins = Number(DIFF_STAT.insertions)
  const del = Number(DIFF_STAT.deletions)
  if (!Number.isFinite(files) || !Number.isFinite(ins) || !Number.isFinite(del)) {
    return { level: 'xhigh', reason: 'diff_stat の値が数値として解釈できない' }
  }
  const lines = ins + del
  if (files > HIGH_MAX_FILES) return { level: 'xhigh', reason: `変更ファイル ${files} 個 > ${HIGH_MAX_FILES}`, files, lines }
  if (lines > HIGH_MAX_LINES) return { level: 'xhigh', reason: `変更行 ${lines} 行 > ${HIGH_MAX_LINES}`, files, lines }
  return { level: 'high', reason: `変更ファイル ${files} 個 / 変更行 ${lines} 行 (どちらも閾値内)`, files, lines }
}
const LEVEL_DECISION = decideLevel()
const LEVEL = LEVEL_DECISION.level

// ---- schema ----
// 自前 finder に severity / pre_existing / evidence を申告させない。
// severity は修正対象の足切りに使わない (verdict + category で決める)。
// pre_existing は差分との照合でコードが決める。evidence は点検段の責務 (recall 側に倒した finder に
// 「抜粋できない指摘は出すな」を課すと網が狭まるため)。
const CANDIDATE_ITEM = {
  type: 'object',
  required: ['summary', 'failure_scenario', 'category', 'file'],
  properties: {
    summary: { type: 'string', description: '欠陥を 1 文で述べる' },
    failure_scenario: { type: 'string', description: '具体的な入力・状態 → 誤った出力・クラッシュ。何を渡すとどう壊れるかを名指しする' },
    category: { enum: ['correctness', 'cleanup'], description: 'correctness=本番で壊れる欠陥 / cleanup=直す価値はあるがマージを止めないもの' },
    file: { type: 'string', description: '指摘対象のファイルパス' },
    line: { type: 'integer', description: '該当行 (特定できないときは 0)' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: { findings: { type: 'array', items: CANDIDATE_ITEM } },
}

// 乖離の理由の所在。docs や設計文書との食い違いを見る観点で使う。
// 「違反」ではなく「乖離」として扱うのは、文書が古い可能性があるため。どちらを直すかは人が決める。
// 理由が plan にある＝ゲート (a) を通った承認済みの判断で、コード内のコメントとは承認の重みが違う。
const RATIONALE_ITEM = {
  type: 'object',
  required: ['found', 'source', 'quote'],
  properties: {
    found: { type: 'boolean', description: '乖離の理由がどこかに記録されているか' },
    source: { enum: ['plan', 'comment', 'none'], description: 'plan=承認済みの計画に記載 / comment=コード内のコメントや実装の記録 / none=どこにも無い' },
    quote: { type: 'string', description: '理由の逐語引用。found=false なら空文字' },
  },
}

const CANDIDATE_ITEM_WITH_RATIONALE = {
  type: 'object',
  required: ['summary', 'failure_scenario', 'category', 'file', 'rationale'],
  properties: { ...CANDIDATE_ITEM.properties, rationale: RATIONALE_ITEM },
}

const REVIEW_SCHEMA_WITH_RATIONALE = {
  type: 'object',
  required: ['findings'],
  properties: { findings: { type: 'array', items: CANDIDATE_ITEM_WITH_RATIONALE } },
}

const TRIAGE_SCHEMA = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'verdict', 'reason', 'evidence', 'duplicate_of'],
        properties: {
          id: { type: 'integer' },
          verdict: { enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] },
          reason: { type: 'string', description: '判定の根拠。実コードのどこを見たか。指摘の言い換えで済ませない' },
          evidence: { type: 'string', description: '該当コードの逐語抜粋 (200 文字以内)' },
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
    new_findings: { type: 'array', items: CANDIDATE_ITEM },
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
// Round 1 と再レビューでバーを分ける。Round 1 は網を広く取って点検段で落とす (半信の候補を
// finder に自己検閲させない)。再レビューは逆で、絞りを効かせないと新規指摘が毎ラウンド流入して収束しない。
const ROUND1_BAR = `
指摘のバー (厳守):
- **failure_scenario を書けない指摘は出さない。** 「具体的な入力・状態 → 誤った出力・クラッシュ」の形で、何を渡すとどう壊れるかを名指しする。
- **名指しできる限り、確信が薄くても挙げる。** 独立した点検担当が次段で判定するので、ここで自己検閲して落とさない。タイミング・環境・設定に依存して再現条件が不確実なものも挙げてよい。
- 探すのは本番で壊れるもの。整形の好み・命名の趣味・テストカバレッジの不足は対象外。
- 指摘ゼロは正当な出力。観点ごとに 1 件以上といった網羅はしない。`

// requires_rationale の観点に足す指示。docs や設計文書との食い違いを扱うための枠。
const RATIONALE_BAR = `
乖離として扱う (厳守):
- **違反と断定しない。** 参照先の記述が古い可能性と、差分の実装が誤っている可能性の両方を検討し、どちらが更新されるべきかの見立てを failure_scenario に含める。参照先のどの記述と差分のどの箇所が食い違うかを両方引く。
- **理由の所在を返す。** その食い違いに理由が記されているかを探す。計画に書かれていればその逐語を source='plan' で、コード内のコメントや実装の記録にあれば source='comment' で返す。どこにも見つからなければ found=false・source='none' とする。**理由を推測で補わない** — 書かれていないなら none。
- 参照先に該当する記述が無い場合は何も挙げない。`

const REREVIEW_BAR = `
指摘のバー (厳守):
- **failure_scenario を書けない指摘は出さない。**
- **修正が新たに生じさせた欠陥だけを挙げる。** 初回で挙げ切れなかった軽微な指摘をここで足すと収束しない。
- 既出指摘と同一論点を再掲しない。新しい観点を持ち込まない。
- 本番で壊れる重大なものだけに絞る。迷う候補は挙げない。`

// 点検の判定ラダー。REFUTED を「コードから構成できるとき」に限り、realistic な状態依存を
// speculative として落とさない。入口で絞らず出口で落とす設計に合わせて recall 側へ倒す。
const VERDICT_LADDER = `
verdict の決め方:
- **CONFIRMED** — 失敗に至る入力・状態を実コードで名指しできる。その筋道を reason に書く。
- **PLAUSIBLE** — 機構は実在するが、トリガーが不確実 (タイミング・環境・設定)。何があれば確定できるかを reason に書く。
- **REFUTED** — 実コードから反証を構成できる。事実として誤り (該当行を引く) / 型や不変条件で起こり得ない (それを示す) / この差分の中で既に手当てされている (そのガードを引く) / 観測可能な影響が無い純粋な様式の問題。

- **既定は PLAUSIBLE。** 「推測的だから」「実行時の状態に依存するから」を理由に REFUTED にしない。並行処理の競合、稀だが到達するパス (エラーハンドラ・コールドキャッシュ・省略可能フィールドの欠落) の null、0 を未設定として扱う判定、コードが除外していない境界のオフバイワン、リトライの集中、アンカーを失った正規表現やホワイトリスト — これらは PLAUSIBLE。
- 複数の担当が同じ論点を別の言葉で挙げていることがある。**同一論点なら、最も具体的な 1 件を残し、他は duplicate_of にその id を入れる。**`

// 本家 (bundled code-review) に無い観点。角度 A〜E に認可漏れ専門のものはなく、
// Angle D に SQL injection が混ざる程度なので、ここだけ自前で並走させる。
const SECURITY_FOCUS = `データ保護と認可。認可チェックの欠落・他人のデータが見える経路・ログや例外メッセージへの個人情報の混入・入力の検証漏れ・SQL や外部コマンドへの値の埋め込み。
あわせて部分失敗の原子性も見る: 途中で失敗したときに中途半端な状態が残らないか、エラーを握り潰して成功として返す経路が無いか。`

// フォールバック用の観点。本家が使えないときだけ走る (security は常に並走しているので除く)
const FALLBACK_LENSES = [
  { key: 'correctness', focus: 'ロジックの誤り。条件の反転・オフバイワン・取り違えた変数・誤った演算順序・状態遷移の抜け・非同期処理の競合。分岐を実際に辿って、意図した値が出るかを確かめる。' },
  { key: 'boundary', focus: '境界とエラー経路。空・null・0 件・1 件・上限超過・型境界の扱い。例外が投げられたときに何が起きるか。' },
  { key: 'regression', focus: '既存挙動の破壊。共有されている関数・DTO・SQL・設定を変えたことで、この差分が触っていない呼び出し元が壊れないか。差分の外にある利用箇所を grep で洗う。' },
]

function diffBlock() {
  return `対象の差分を自分で確認する。作業ツリー (cwd): ${WORKTREE}
差分の取得: ${DIFF_COMMAND}
未追跡ファイルは差分に出ないので git status --porcelain で拾い、Read で本文を読む。
${CHANGED_FILES.length ? `実装工程が申告した変更ファイル (起点情報。これだけを見て済ませず、差分の実体を自分で確認する):\n${CHANGED_FILES.map((f) => `- ${f}`).join('\n')}` : ''}
${PLAN_PATH ? `計画 (背景の参照用。計画との突合そのものは別工程の担当): ${PLAN_PATH}` : ''}
元の依頼: ${REQUEST}`
}

// ---- パス正規化 ----
// bundled は finder の出力形式によって絶対パスと相対パスを混在させる (canonFile の suffix 正規化が
// 効かないケースがある)。pre_existing 判定より前に揃えないと、同一ファイルを別物として扱って誤判定する。
function relPath(p) {
  if (!p) return ''
  let s = String(p).replace(/\\/g, '/')
  const base = WORKTREE.replace(/\\/g, '/') + '/'
  if (s.startsWith(base)) s = s.slice(base.length)
  return s
}

// ---- pre_existing 判定 ----
// 差分が触ったファイルの一覧との照合でコードが決める (agent の自己申告に委ねない)。
// 正本は git diff --name-only の実測。無ければ実装工程の申告に落ち、それも無ければ判定しない。
// 判定しないときに false を選ぶのは、真正な指摘を報告送りにして取りこぼすより、
// 修正対象に残してラウンドを使う方が安全側だから。
const CHANGED_SET = new Set((CHANGED_FILES_ACTUAL.length ? CHANGED_FILES_ACTUAL : CHANGED_FILES).map(relPath).filter(Boolean))
const PRE_EXISTING_BASIS = CHANGED_FILES_ACTUAL.length ? 'git diff --name-only' : CHANGED_FILES.length ? '実装工程の申告 (正本ではない)' : '判定材料なし'
function isPreExistingFile(file) {
  if (!CHANGED_SET.size) return false
  return !CHANGED_SET.has(relPath(file))
}

// ---- bundled の merge 注記のパース ----
// `[same root cause also at: a.ts:1, b.ts:2]` は assembler がコードで構成する決定的文字列なので、
// 件数を数えて cap 到達の検出に使える。表示は冗長なので本文からは剥がす。
const ALSO_RE = /\s*\[same root cause also at:\s*([^\]]*)\]\s*$/
function splitAlso(summary) {
  const s = String(summary || '')
  const m = s.match(ALSO_RE)
  if (!m) return { text: s, locs: [] }
  const locs = m[1].split(',').map((x) => x.trim()).filter(Boolean)
  return { text: s.slice(0, m.index), locs }
}

// ---- ヘルパ ----
let findings = []
function normCategory(c) {
  const s = String(c || '').toLowerCase()
  return s === 'cleanup' || s === 'convention' || s === 'conventions' ? 'cleanup' : 'correctness'
}
// verified=true は独立した検証を通ったもの (bundled の verifier、または自前の点検段)。
// false のものだけが点検の対象になる
function pushFinding(raw, { round, lens, verdict, verified, evidence, alsoAt, forceCategory }) {
  const file = relPath(raw.file)
  findings.push({
    id: findings.length + 1,
    round,
    lens,
    summary: raw.summary,
    failure_scenario: raw.failure_scenario,
    // 追加観点は観点側で category を決める（何を修正ループに載せるかは呼び出し元の判断）
    category: forceCategory || normCategory(raw.category),
    rationale: raw.rationale && typeof raw.rationale === 'object' ? { found: raw.rationale.found === true, source: raw.rationale.source || 'none', quote: String(raw.rationale.quote || '').slice(0, 300) } : null,
    file,
    line: Number.isInteger(raw.line) ? raw.line : 0,
    also_at: Array.isArray(alsoAt) ? alsoAt.map(relPath) : [],
    pre_existing: isPreExistingFile(file),
    verdict: verdict || 'PLAUSIBLE',
    verified: verified === true,
    triage_reason: '',
    evidence: (evidence || '').slice(0, 200),
    duplicate_of: 0,
    resolved: false,
    resolved_round: null,
    resolved_note: '',
  })
}

// 修正対象の判定はコードが持つ。severity を廃し verdict + category で決める。
// bundled の戻り値に severity が無く、あっても自己申告なので足切りの根拠にできない。
// cleanup を外すのは、それが残るだけでラウンドを食い潰す構造を断つため (報告には残る)。
// verified を条件にするのは、独立した検証を通っていない指摘を修正 agent へ流さないため
// (bundled が verdict の付かなかった候補を drop するのと同じ方針)。
function isFixTarget(f) {
  if (f.resolved || f.verdict === 'REFUTED' || f.duplicate_of) return false
  if (!f.verified) return false
  if (f.pre_existing) return false
  if (f.category === 'cleanup') return false
  return true
}
function fixTargets() {
  return findings.filter(isFixTarget)
}
// bundled のランク付けに合わせる: CONFIRMED correctness → PLAUSIBLE correctness → cleanup
function rankOf(f) {
  return (f.category === 'cleanup' ? 2 : 0) + (f.verdict === 'PLAUSIBLE' ? 1 : 0)
}
function byRank(a, b) {
  return rankOf(a) - rankOf(b) || a.id - b.id
}
function findingsTable(items) {
  return items.map((f) => `- F${f.id} [${f.verdict}/${f.category}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.summary}\n  失敗の筋道: ${f.failure_scenario}`).join('\n')
}

const flags = {
  upstream_used: false,
  upstream_error: null,
  fallback_used: false,
  security_failed: false,
  extra_lenses_missing: 0,
  unexplained_findings: 0,
  triage_failed: false,
  fix_failed: false,
  review_failed: false,
  lenses_missing: 0,
  cap_reached: false,
  cap_hit_correctness: false,
  cap_shortfall: null,
  pre_existing_basis: PRE_EXISTING_BASIS,
}
let upstreamStats = null

function result(stoppedBy, extra) {
  // 理由の記されていない乖離。requires_rationale の観点だけが rationale を持つ
  flags.unexplained_findings = findings.filter((f) => f.rationale && f.rationale.found === false && f.verdict !== 'REFUTED' && !f.duplicate_of).length
  // category が cleanup だと修正ループに入らないので、放っておくと converged で通ってしまう。
  // 理由が記されていない乖離は「気づかずに設計判断から外れた」可能性が高いので、ここで収束を止めて人に渡す。
  // 理由があるもの (plan でもコメントでも) は報告に載せるだけで収束を妨げない
  let sb = stoppedBy
  if (flags.unexplained_findings > 0 && (sb === 'converged' || sb === 'no-fix-targets')) sb = 'unexplained-divergence'
  const totals = {
    count: findings.length,
    fix_targets: fixTargets().length,
    resolved: findings.filter((f) => f.resolved).length,
    refuted: findings.filter((f) => f.verdict === 'REFUTED').length,
    duplicates: findings.filter((f) => f.duplicate_of).length,
    pre_existing: findings.filter((f) => f.pre_existing && !f.duplicate_of && f.verdict !== 'REFUTED').length,
    cleanup: findings.filter((f) => f.category === 'cleanup' && !f.pre_existing && !f.duplicate_of && f.verdict !== 'REFUTED').length,
    // 点検が届かず修正対象から外れたもの。報告には残るので人が見る対象
    unverified: findings.filter((f) => !f.verified && !f.duplicate_of && f.verdict !== 'REFUTED').length,
    // 理由の記されていない乖離。収束を止める
    unexplained: flags.unexplained_findings,
  }
  totals.remaining = totals.fix_targets
  findings.sort(byRank)
  return {
    findings,
    totals,
    converged: sb === 'converged' || sb === 'no-fix-targets',
    stopped_by: sb,
    flags,
    // 計装。閾値は 1 サンプルからの外挿なので、実行ごとにこの 3 つを貯めて後から見直す
    level_decision: LEVEL_DECISION,
    upstream_stats: upstreamStats,
    diff_stat: DIFF_STAT,
    ...extra,
  }
}

// ---- 点検 (未検証の候補だけを対象にする) ----
async function triageUnverified(label) {
  const targets = findings.filter((f) => !f.verified && f.verdict !== 'REFUTED' && !f.resolved)
  if (!targets.length) return true
  const known = findings.filter((f) => f.verified && !f.duplicate_of)
  const t = await agent(
    `あなたは指摘の点検担当。下記の未検証の指摘それぞれについて、実コードを見て verdict を決め、重複を統合せよ。コードの修正・編集はしない。
${VERDICT_LADDER}

作業ツリー (cwd): ${WORKTREE}
差分の取得: ${DIFF_COMMAND}

${known.length ? `既に別のレビューで検証済みの指摘 (これらとの重複なら duplicate_of にその id を入れる。これら自体の verdict は変えない):\n${JSON.stringify(known.map((f) => ({ id: f.id, file: f.file, line: f.line, summary: f.summary })), null, 2)}\n` : ''}
点検対象:
${JSON.stringify(targets.map((f) => ({ id: f.id, lens: f.lens, category: f.category, file: f.file, line: f.line, summary: f.summary, failure_scenario: f.failure_scenario })), null, 2)}`,
    { agentType: 'Explore', schema: TRIAGE_SCHEMA, label, phase: '点検' },
  )
  if (!t) {
    flags.triage_failed = true
    // verified=false のままなので isFixTarget が外す。REFUTED にはしない (反証できたわけではない) ので報告には残る
    log(`点検 agent が結果を返さなかった (${label})。未検証の ${targets.length} 件は修正対象から外して報告に回す`)
    return false
  }
  const byId = new Map(targets.map((f) => [f.id, f]))
  for (const v of t.verdicts) {
    const f = byId.get(v.id)
    if (!f) continue
    f.verdict = v.verdict
    f.triage_reason = v.reason
    f.evidence = (v.evidence || '').slice(0, 200)
    f.verified = true
    if (Number.isInteger(v.duplicate_of) && v.duplicate_of > 0 && v.duplicate_of < f.id) f.duplicate_of = v.duplicate_of
  }
  // verdict が返らなかったものは verified=false のまま残り、isFixTarget が外す
  const missed = targets.filter((f) => !f.verified)
  if (missed.length) log(`点検の verdict が返らなかった ${missed.length} 件 (${missed.map((f) => 'F' + f.id).join(', ')}) を修正対象から外した`)
  return true
}

// ============================================================
phase('レビュー')

// bundled の code-review を名指しで呼ぶ。hidden 登録だが名前解決にフィルタは無く、
// disable-model-invocation も付いていないため workflow として起動できる。
// 公開契約ではないので、失敗時は自前の観点別 finder に落ちる経路を必ず持つ。
const CR_ARGS = `${LEVEL} review the changes in the repository at ${WORKTREE}. Use \`${DIFF_COMMAND}\` as the review diff, and also include untracked files reported by \`git -C ${WORKTREE} status --porcelain\`. Do not review any other repository.`
log(`レベル判定: ${LEVEL} (${LEVEL_DECISION.reason})`)

function lensPrompt(focus, { context, requiresRationale } = {}) {
  return `あなたはコードレビュー担当。直前の実装で入った差分を、下記の観点に絞ってレビューし findings を返せ。コードの修正・編集はしない (Read/Glob/Grep と読み取りの Bash のみ)。

担当する観点: ${focus}
この観点の外にあるものは別の担当が並行して見ているので挙げない。
${context ? `\n参照する情報:\n${context}\n` : ''}${requiresRationale ? RATIONALE_BAR : ''}
${ROUND1_BAR}

${diffBlock()}`
}

// 本家の呼び出し・security・追加観点を 1 つの parallel で並走させる。
// 追加観点は本家の外側なので maxFindings / perAngle cap の影響を受けない
const round1Results = await parallel([
  async () => {
    try {
      return { ok: true, value: await workflow('code-review', CR_ARGS) }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  },
  () => agent(lensPrompt(SECURITY_FOCUS), { agentType: 'Explore', schema: REVIEW_SCHEMA, label: 'review:security', phase: 'レビュー' }),
  ...EXTRA_LENSES.map((l) => () =>
    agent(lensPrompt(l.focus, { context: l.context, requiresRationale: l.requires_rationale }), {
      agentType: 'Explore',
      schema: l.requires_rationale ? REVIEW_SCHEMA_WITH_RATIONALE : REVIEW_SCHEMA,
      label: `review:${l.key}`,
      phase: 'レビュー',
    }),
  ),
])
const crWrapped = round1Results[0]
const secResult = round1Results[1]
const extraResults = round1Results.slice(2)

// bundled は scope の失敗を throw ではなく { error } という戻り値で返す。
// throw だけを捕捉すると findings 0 件と区別できず、レビューが走っていないのに converged になる
function upstreamUsable(w) {
  if (!w || w.ok !== true) return false
  const v = w.value
  if (!v || typeof v !== 'object') return false
  if (v.error) return false
  if (!Array.isArray(v.findings)) return false
  return true
}

if (upstreamUsable(crWrapped)) {
  const cr = crWrapped.value
  flags.upstream_used = true
  upstreamStats = cr.stats || null
  for (const f of cr.findings) {
    const { text, locs } = splitAlso(f.summary)
    pushFinding(
      { summary: text, failure_scenario: f.failure_scenario, category: f.category, file: f.file, line: f.line },
      { round: 1, lens: 'code-review', verdict: f.verdict === 'CONFIRMED' ? 'CONFIRMED' : 'PLAUSIBLE', verified: true, evidence: '', alsoAt: locs },
    )
  }
  log(`bundled code-review (${LEVEL}): findings ${cr.findings.length} 件`)
} else {
  flags.upstream_used = false
  flags.fallback_used = true
  flags.upstream_error = crWrapped && crWrapped.ok === false ? crWrapped.error : crWrapped && crWrapped.value && crWrapped.value.error ? String(crWrapped.value.error) : 'bundled code-review の戻り値が想定の形ではない'
  log(`bundled code-review を使えなかった: ${flags.upstream_error} — 自前の観点別 finder に落ちる`)
  const fb = await parallel(
    FALLBACK_LENSES.map((lens) => () =>
      agent(
        `あなたはコードレビュー担当。直前の実装で入った差分を、下記の観点に絞ってレビューし findings を返せ。コードの修正・編集はしない (Read/Glob/Grep と読み取りの Bash のみ)。

担当する観点: ${lens.focus}
この観点の外にあるものは他の担当が見るので挙げない。
${ROUND1_BAR}

${diffBlock()}`,
        { agentType: 'Explore', schema: REVIEW_SCHEMA, label: `review:${lens.key}`, phase: 'レビュー' },
      ),
    ),
  )
  const okCount = fb.filter(Boolean).length
  flags.lenses_missing = FALLBACK_LENSES.length - okCount
  fb.forEach((r, i) => {
    if (!r) return
    for (const raw of r.findings) pushFinding(raw, { round: 1, lens: FALLBACK_LENSES[i].key, verified: false })
  })
  log(`フォールバック: ${okCount}/${FALLBACK_LENSES.length} 観点が完了`)
}

if (secResult) {
  for (const raw of secResult.findings) pushFinding(raw, { round: 1, lens: 'security', verified: false })
  log(`security 観点: ${secResult.findings.length} 件`)
} else {
  flags.security_failed = true
  log('security 観点の agent が結果を返さなかった')
}

EXTRA_LENSES.forEach((l, i) => {
  const r = extraResults[i]
  if (!r) {
    flags.extra_lenses_missing++
    log(`追加観点 ${l.key} の agent が結果を返さなかった`)
    return
  }
  for (const raw of r.findings) pushFinding(raw, { round: 1, lens: l.key, verified: false, forceCategory: l.category })
  log(`追加観点 ${l.key}: ${r.findings.length} 件 (${l.category})`)
})

if (!findings.length && flags.fallback_used && flags.security_failed) {
  return result('review-failed', { fixes: [], changed_files: [], rounds: [] })
}

// ---- cap 到達の検出 ----
// bundled は maxFindings を超えた候補を findings にも refuted にも入れずに落とす。
// backfill が cap まで埋め切る実装なので、報告数 + merge 注記の件数が生存数に届かなければ
// その差がそのまま落ちた件数になる。merge による集約と切り捨てを区別できる唯一の経路
if (flags.upstream_used && upstreamStats && Number.isFinite(upstreamStats.verified) && Number.isFinite(upstreamStats.refuted)) {
  const surviving = upstreamStats.verified - upstreamStats.refuted
  const claimed = findings.filter((f) => f.lens === 'code-review').reduce((n, f) => n + 1 + f.also_at.length, 0)
  const shortfall = surviving - claimed
  flags.cap_shortfall = shortfall
  if (shortfall > 0) {
    flags.cap_reached = true
    // 切り捨ては rank の低い側から起きる (CONFIRMED correctness → PLAUSIBLE correctness → cleanup の逆順)。
    // 報告に cleanup が 1 件でも載っていれば枠が cleanup まで届いており、押し出されたのも cleanup 側＝
    // 修正対象は失われていない。報告が correctness だけで埋まっているときだけ、correctness が
    // 押し出された疑いとして扱う。
    // ランク順は synthesizer へのプロンプト指示であってコード保証ではないので、これは疑いの検出であって証明ではない。
    const reportedCleanup = findings.filter((f) => f.lens === 'code-review' && f.category === 'cleanup').length
    flags.cap_hit_correctness = reportedCleanup === 0
    log(`cap 到達: 検証を通った ${surviving} 件のうち ${shortfall} 件が報告上限で切り捨てられた（${flags.cap_hit_correctness ? 'correctness が押し出された疑い' : '押し出されたのは cleanup 側で修正対象は残っている'}）`)
  }
}

// ============================================================
phase('点検')
await triageUnverified('triage:r1')
log(`修正対象: ${fixTargets().length} 件（cleanup と pre_existing は報告のみ）`)

// 報告枠が correctness で埋まり切っている = 見えていない correctness の指摘が残っている疑い。
// それを残したまま自動修正を進めるより、ここで止めて人に渡す方が安全。correctness だけで
// 報告上限を食い尽くす密度なら、無人で直し続ける判断自体が誤っている。
// cleanup 側の切り捨ては修正対象を削らないので、報告に載せるだけで収束は妨げない。
if (flags.cap_reached && flags.cap_hit_correctness) {
  log('報告枠が correctness で埋まっている。見えていない指摘を残したまま修正しないためエスカレーションする')
  return result('cap-reached', { fixes: [], changed_files: [], rounds: [{ round: 1, new_findings: findings.length, fix_targets: fixTargets().length }] })
}

// ============================================================
phase('収束')
const fixes = []
const rounds = [{ round: 1, new_findings: findings.length, fix_targets: fixTargets().length }]
let changedFiles = []
let round = 1
let stoppedBy = fixTargets().length ? 'in-progress' : 'no-fix-targets'

while (fixTargets().length) {
  if (round >= MAX_ROUNDS) {
    stoppedBy = 'round-limit'
    break
  }
  const prevTargets = fixTargets().length

  // --- 修正 ---
  const targets = fixTargets().sort(byRank)
  const fix = await agent(
    `あなたは修正担当。下記のレビュー指摘への対応のみ行う。指摘に無い改善・リファクタ・自己判断の変更を混ぜない。

依頼: ${REQUEST}
${PLAN_PATH ? `計画: ${PLAN_PATH} — 修正がこの計画の決定事項と矛盾しないことを確認せよ。\n` : ''}作業ツリー (cwd): ${WORKTREE} — すべての編集はこのツリー内で行う。
副作用禁止: ${SIDE_EFFECT_BAN}
${SOURCE_NOTE}

指摘は確度と重さの順に並んでいる。上から対応する。
${findingsTable(targets)}

各指摘の failure_scenario が起きなくなることを対応の基準にする。表面的に条件を足して塞ぐのではなく、その筋道が成立しない形にする。
修正後、修正したファイルを読み直して自己確認する: (a) 各指摘の failure_scenario が解消したか (b) 他を壊していないか。結果を self_check に書く。
返却: summary (対応概要) / changed_files (修正で触れたファイルの絶対パス一覧) / self_check。`,
    { schema: FIX_SCHEMA, label: `fix:r${round}`, phase: '収束' },
  )
  if (!fix) {
    flags.fix_failed = true
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
1. prior_judgments: 下記の未解決指摘それぞれについて、**failure_scenario が成立しなくなったか**を実コードで判定し、resolved と根拠を返す。表面的な条件追加で筋道が残っているなら resolved=false にする。トリガーが不確実な指摘 (PLAUSIBLE) は、その筋道を成立させない手当てが入っていれば resolved=true としてよい。
2. new_findings: 修正で新たに生じた欠陥のみを挙げる。
${REREVIEW_BAR}

未解決指摘:
${findingsTable(targets)}

${diffBlock()}`,
    { agentType: 'Explore', schema: REREVIEW_SCHEMA, label: `review:r${round}`, phase: '収束' },
  )
  if (!rr) {
    flags.review_failed = true
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
  // 再レビューの新規指摘は誰の検証も通っていない。Round 1 と同じ点検段に通してから
  // 修正対象の判定に載せる (未検証のまま修正 agent へ流す経路を作らない)
  for (const raw of rr.new_findings) pushFinding(raw, { round, lens: 'rereview', verified: false })
  if (rr.new_findings.length) await triageUnverified(`triage:r${round}`)

  const remaining = fixTargets().length
  rounds.push({ round, new_findings: rr.new_findings.length, fix_targets: remaining })
  log(`Round ${round}: 修正対象 ${prevTargets} → ${remaining}`)

  if (!remaining) {
    stoppedBy = 'converged'
    break
  }
  // 前進なしの早期停止: 修正対象が前ラウンドから厳密に減っていなければ、修正の空転か計画側の誤りのシグナル
  if (!(remaining < prevTargets)) {
    stoppedBy = 'no-progress'
    break
  }
}

const out = result(stoppedBy, { fixes, changed_files: changedFiles, rounds })
log(
  `収束: ${out.totals.count} 件 (解消 ${out.totals.resolved} / 反証 ${out.totals.refuted} / 重複 ${out.totals.duplicates} / 既存 ${out.totals.pre_existing} / cleanup ${out.totals.cleanup} / 未検証 ${out.totals.unverified} / 理由なし乖離 ${out.totals.unexplained} / 未対応 ${out.totals.fix_targets}) rounds=${rounds.length} stopped_by=${out.stopped_by} upstream=${flags.upstream_used ? LEVEL : 'fallback'}${EXTRA_LENSES.length ? ` extra_lenses=${EXTRA_LENSES.length}` : ''}`,
)
return out
