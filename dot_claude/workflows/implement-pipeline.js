export const meta = {
  name: 'implement-pipeline',
  description: 'implement スキルの実装パイプライン: 実装→検証/self-review(並列)→enum コードゲートの限定リトライ (上限 1 はループを置かないコード構造で保証)→集計。green 判定・changed_files の union・件数集計は script がコードで計算し、自己申告に依存しない',
  whenToUse: 'implement スキル本体 (SKILL.md) から scriptPath 指定で起動される。単体起動は想定しない',
  phases: [
    { title: '実装', detail: 'plan.md を一次ソースに作業ツリー内で実装 (worktree_cwd・副作用禁止句を prompt に機械埋め込み)' },
    { title: '検証・self-review', detail: '独立検証 agent のテスト実行と plan 突合専任 self-review の並列実行' },
    { title: 'リトライ判定', detail: '全 fail が trivial-safe のときのみ修正 agent を 1 回起動して検証を再実行 (可否と上限はコードが決める)' },
    { title: '集計', detail: 'green 判定・changed_files union・totals・flags の組み立て' },
  ],
}

// ---- 入力 ----
// args: { plan_path?, request, worktree_cwd, side_effect_ban, tdd? }
// 呼び出し側が JSON 文字列で渡してしまった場合の fallback (本来は実 JSON object で渡す)
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (e) {
    throw new Error('args が JSON として解釈できない文字列で渡された: ' + e.message)
  }
}
if (!input || !input.request || !input.worktree_cwd || !input.side_effect_ban) {
  throw new Error('args に request / worktree_cwd / side_effect_ban が必要 (plan_path / tdd は任意。plan-less 時は request が一次ソース)')
}
if (input.tdd !== undefined && typeof input.tdd !== 'boolean') {
  throw new Error('args の tdd は boolean で渡す (boolean 以外は無検知の silent false になるため拒否)')
}
const PLAN_PATH = input.plan_path || null
const REQUEST = input.request
const WORKTREE = input.worktree_cwd
const SIDE_EFFECT_BAN = input.side_effect_ban
const TDD = input.tdd === true
// mode (standalone / develop 経由) は受け取らない: script の挙動は mode 非依存で、
// develop-log.md (実行台帳) への記録は fs を持たない script にはできず本体の責務 (未使用 args を持たせない)

// ---- 定数 ----
// リトライ上限 1 は構造 (リトライ判定フェーズにループを置かない直線実行) で保証する。上限の定数・ループ条件は置かない
const EXCERPT_MAX_FAIL = 2000 // fail の output_excerpt 上限 (エラー箇所の特定に必要な分を残す)
const EXCERPT_MAX_PASS = 200 // pass の output_excerpt 上限 (要点のみ。戻り肥大の機械的防止)

// ---- schema (enum に null を使わず 'none' を番兵にする) ----
const IMPLEMENT_SCHEMA = {
  type: 'object',
  required: ['summary', 'changed_files', 'tests_attempted'],
  properties: {
    summary: { type: 'string', description: '変更概要 (何をどう実装したか)' },
    changed_files: { type: 'array', items: { type: 'string' }, description: '変更したファイルの絶対パス一覧' },
    tests_attempted: {
      type: 'array',
      items: {
        type: 'object',
        required: ['command', 'note'],
        properties: {
          command: { type: 'string', description: '実行を試みたテスト/ビルド/lint コマンド (そのまま再実行できる形)' },
          note: { type: 'string', description: '結果の 1 行メモ (独立の検証 agent が別途再実行するため参考情報)' },
        },
      },
    },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['executions'],
  properties: {
    executions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['command', 'status', 'breakage_class', 'output_excerpt'],
        properties: {
          command: { type: 'string', description: '実行したコマンド (そのまま再実行できる形)' },
          status: { enum: ['pass', 'fail'] },
          breakage_class: { enum: ['trivial-safe', 'substantive', 'none'], description: 'fail の分類 (trivial-safe=明白で安全に小さく直せる / substantive=実質的な誤り)。pass のときは none' },
          output_excerpt: { type: 'string', description: `実行出力の要点抜粋 (pass は要点 ${EXCERPT_MAX_PASS} 文字以内 / fail は ${EXCERPT_MAX_FAIL} 文字以内でエラー箇所を優先)` },
        },
      },
    },
  },
}

const SELF_REVIEW_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['summary', 'type', 'severity', 'plan_ref'],
        properties: {
          summary: { type: 'string', description: '指摘の自然言語要約 (1-2 文)' },
          type: { enum: ['unimplemented', 'deviation', 'none'], description: 'unimplemented=plan の未実装項目 / deviation=plan からの逸脱 / none=問題なしの所見' },
          severity: { enum: ['high', 'medium', 'low', 'none'], description: 'type=none のときは none' },
          plan_ref: { type: 'string', description: 'plan のどの節・決定事項に紐づくか (plan-less 時は依頼文の該当箇所)' },
        },
      },
    },
  },
}

const FIX_SCHEMA = {
  type: 'object',
  required: ['summary', 'changed_files'],
  properties: {
    summary: { type: 'string', description: '修正概要' },
    changed_files: { type: 'array', items: { type: 'string' }, description: '修正で触れたファイルの絶対パス一覧' },
  },
}

// ---- ヘルパ ----
function sliceExcerpts(executions) {
  for (const e of executions) e.output_excerpt = (e.output_excerpt || '').slice(0, e.status === 'pass' ? EXCERPT_MAX_PASS : EXCERPT_MAX_FAIL)
  return executions
}
function failsOf(executions) {
  return executions.filter((e) => e.status === 'fail')
}

// 戻り object の組み立て (デフォルト＋上書き)。早期 return と正規 return で shape を複製しない。
// flags は二重符号化せず、stopped_by / review の null / executions から一括導出する。
function buildResult(review, overrides) {
  const r = Object.assign(
    {
      implementation_summary: '',
      changed_files: [],
      test_executions: [],
      self_review: { findings: [], totals: { count: 0, unimplemented: 0, deviation: 0, none: 0 } },
      retry_log: { retries: 0, stopped_by: 'implement-failed' },
      worktree_cwd: WORKTREE,
    },
    overrides,
  )
  const stopped = r.retry_log.stopped_by
  const fails = failsOf(r.test_executions)
  const implementFailed = stopped === 'implement-failed'
  // implement-failed の早期 return では検証・self-review は未実施 = true で返す (false=実施済みを装わない)
  const verifyFailed = stopped === 'verify-failed' || implementFailed
  r.flags = {
    implement_failed: implementFailed,
    verify_failed: verifyFailed,
    self_review_failed: !review,
    fix_failed: stopped === 'fix-failed',
    red_remaining: fails.length > 0,
    // 実行コマンドの記録 0 件 = 客観確認ゼロ件。green とは区別して表面化する。
    // verify_failed とは独立に executions の件数のみで導出する (初回検証の取得失敗時は
    // verify_failed と no_tests_run の両方が true = 「検証結果なし・実行記録ゼロ件」として一貫)
    no_tests_run: r.test_executions.length === 0,
  }
  // green = 検証成功 かつ executions 1 件以上 かつ fail ゼロ (実行ゼロの vacuous green を許さない)
  r.test_green = !verifyFailed && !r.flags.no_tests_run && fails.length === 0
  return r
}

function verifyPrompt(commandsBlock, retryNote) {
  return `あなたは検証担当。実装担当とは別の独立 agent であり、実装側の自己申告を信用せず、自分が Bash で実行した結果だけを根拠にする。コードの修正・編集は一切しない (実行と報告のみ)。
${retryNote}作業ツリー (cwd): ${WORKTREE} — すべてのコマンドをこのツリーで実行する。
実行するコマンドも次の副作用禁止に従う: ${SIDE_EFFECT_BAN}。コマンドの実行はテスト/ビルド/lint として妥当なものに限る。

${commandsBlock}

実行したコマンドごとに executions の 1 項目として返す:
- status: 実行結果 (pass | fail)。
- breakage_class: fail の分類 — trivial-safe (typo・import 漏れ・パス間違い等、明白で安全に小さく直せる) / substantive (実装の実質的な誤り・設計レベルの問題・原因不明)。迷ったら substantive に倒す。pass のときは none。
- output_excerpt: 実行出力の要点抜粋 (pass は要点 ${EXCERPT_MAX_PASS} 文字以内 / fail は ${EXCERPT_MAX_FAIL} 文字以内でエラー箇所を優先)。`
}

function fixPrompt(fails) {
  return `あなたは修正担当。検証で fail した以下の項目 (いずれも trivial-safe 分類) への対応のみ行う。修正範囲は列挙した fail のみ。それ以外のファイルに触らない。再設計・リファクタ・自己判断の改善を混ぜない。

依頼: ${REQUEST}
${PLAN_PATH ? `plan: ${PLAN_PATH} — 修正がこの plan の決定事項と矛盾しないことを確認せよ。\n` : ''}作業ツリー (cwd): ${WORKTREE} — すべての編集はこのツリー内で行う。
副作用禁止: ${SIDE_EFFECT_BAN}

fail 一覧:
${JSON.stringify(fails, null, 2)}

返却: summary (修正概要) / changed_files (修正で触れたファイルの絶対パス一覧)。`
}

// ============================================================
phase('実装')
const implPrompt = `あなたは実装担当。以下に従って実装せよ。

${PLAN_PATH ? `一次ソース: ${PLAN_PATH} — サマリでなくこの plan.md を必ず直接 Read し、その決定事項に従って実装する。再計画はしない。` : '一次ソース (plan-less): 下記の依頼文。'}
依頼: ${REQUEST}
作業ツリー (cwd): ${WORKTREE} — すべての編集・コマンド実行はこのツリー内で行う。
副作用禁止: ${SIDE_EFFECT_BAN}
${TDD ? '~/.claude/skills/tdd-workflow/SKILL.md を Read し、テスト先行 (Red-Green-Refactor) で進めること。ただし tdd-workflow 内のコミット指示には従わない——上記の副作用禁止が優先する (コミットしない。Red-Green-Refactor の進め方のみ従う)。\n' : ''}
実装後、テスト/ビルド/lint の実行を試み、結果を tests_attempted に申告する (独立の検証 agent が別途再実行するので、結果の粉飾は意味がない)。
返却: summary (変更概要) / changed_files (変更したファイルの絶対パス一覧) / tests_attempted。`

const impl = await agent(implPrompt, { schema: IMPLEMENT_SCHEMA, label: 'implement', phase: '実装' })
if (!impl) {
  // 失敗を隠蔽せず flags で明示して返す (後段の検証・self-review は対象が無いので回さない =
  // 未実施。buildResult が verify_failed / self_review_failed も true に導出する)
  log('実装 agent が結果を返さなかった (implement_failed)')
  return buildResult(null, { retry_log: { retries: 0, stopped_by: 'implement-failed' } })
}
log(`実装完了: 変更 ${impl.changed_files.length} files / 申告テスト ${impl.tests_attempted.length} 件`)

// ============================================================
phase('検証・self-review')
const attempted = impl.tests_attempted
const cmdBlock1 = attempted.length
  ? `実装担当が申告したコマンド (起点情報。自分で再実行する):
${attempted.map((t) => `- ${t.command} (${t.note})`).join('\n')}
申告に不足があれば、リポジトリ構成 (package.json / Makefile / CI 設定等) からテスト・ビルド・lint コマンドを特定して追加実行してよい。`
  : `実装担当のコマンド申告は無い。リポジトリ構成 (package.json / Makefile / CI 設定等) からテスト・ビルド・lint コマンドを特定して実行する。実行できるものが本当に無ければ executions は空配列で返す (でっち上げない)。`

const reviewPrompt = `あなたは self-review 担当 (plan 突合専任)。実装結果が一次ソースの決定事項を満たしているかだけを照合し、未実装項目 (unimplemented)・逸脱 (deviation) を findings で返せ。コードの修正・編集はしない (Read/Glob/Grep のみ)。

- correctness / quality のバグ探索はしない (それは呼び出し元の code-review の領分)。テスト green の確認もしない (green 判定は検証結果から script が計算する)。
- 指摘ゼロは正当な出力 (問題が無ければ findings は空配列でよい)。網羅ノルマを課さない。

一次ソース: ${PLAN_PATH ? `${PLAN_PATH} — サマリでなくこの plan.md を直接 Read して突合する` : '(plan-less) 下記の依頼文に対して突合する'}
依頼: ${REQUEST}
作業ツリー: ${WORKTREE}

実装担当の申告 (補助情報。突合は一次ソースと実ファイルの照合を正とする):
変更概要: ${impl.summary}
変更ファイル: ${JSON.stringify(impl.changed_files)}`

// barrier が正当なケース: リトライ判定 (検証結果) と戻り組み立て (self-review) の両方が後段で必要
// self-review は read-only の照合専任なので Explore に封鎖する (コード編集経路を構造で断つ)
const [verify1, reviewFirst] = await parallel([
  () => agent(verifyPrompt(cmdBlock1, ''), { schema: VERIFY_SCHEMA, label: 'verify:r1', phase: '検証・self-review' }),
  () => agent(reviewPrompt, { agentType: 'Explore', schema: SELF_REVIEW_SCHEMA, label: 'self-review', phase: '検証・self-review' }),
])

// self-review が結果を返さなかったときは 1 回だけ再起動する (fix リトライと同様、回数上限はこのコードで固定)
let review = reviewFirst
if (!review) {
  log('self-review agent が結果を返さなかった。1 回だけ再起動する')
  review = await agent(reviewPrompt, { agentType: 'Explore', schema: SELF_REVIEW_SCHEMA, label: 'self-review:restart', phase: '検証・self-review' })
}

let executions = verify1 ? sliceExcerpts(verify1.executions) : []
log(`検証: ${verify1 ? `${executions.length} コマンド (fail ${failsOf(executions).length})` : '取得失敗'} / self-review: ${review ? `findings ${review.findings.length} 件` : '取得失敗 (再起動でも null)'}`)

// ============================================================
phase('リトライ判定')
// リトライするか否かの判定はコードが決める (分類 breakage_class だけが検証 agent の申告)。
// リトライ上限 1 は構造 (ループを置かない直線実行: enum ゲート → fix → verify2) で保証する。
let retries = 0
let changedFiles = (impl.changed_files || []).slice()
let stoppedBy

if (!verify1) {
  stoppedBy = 'verify-failed'
} else {
  const fails1 = failsOf(executions)
  if (!fails1.length) {
    stoppedBy = 'all-green'
  } else if (fails1.some((f) => f.breakage_class !== 'trivial-safe')) {
    // substantive を含む fail はリトライせず flags に立てて返す (自動リトライループは回さない)
    stoppedBy = 'substantive-fail'
  } else {
    // enum コードゲート通過: fail があり、かつ全 fail が trivial-safe のときのみ 1 回だけ修正
    retries = 1
    const fix = await agent(fixPrompt(fails1), { schema: FIX_SCHEMA, label: 'fix:retry-1', phase: 'リトライ判定' })
    if (!fix) {
      // 修正 agent の取得失敗を黙殺しない (stopped_by / flags.fix_failed に表面化。fail は残置)
      log('修正 agent が結果を返さなかった (fix_failed)。fail は残置')
      stoppedBy = 'fix-failed'
    } else {
      // 修正で触れたファイルが「変更ファイル一覧」から漏れないよう union をコードで合成
      changedFiles = Array.from(new Set([...changedFiles, ...(fix.changed_files || [])]))
      const rerunBlock = `次のコマンドを全件実行する (修正対象外のものも回帰確認のため再実行):
${executions.map((e) => `- ${e.command}`).join('\n')}
コマンド文字列は一字一句この表記のまま executions に報告する (言い換え・別表記・前置の追加をしない。被覆の照合は逐語一致で行われる)。`
      const verify2 = await agent(verifyPrompt(rerunBlock, '直前に trivial-safe な fail への修正が適用された。修正後の状態を検証する。\n'), {
        schema: VERIFY_SCHEMA,
        label: 'verify:r2',
        phase: 'リトライ判定',
      })
      if (!verify2) {
        stoppedBy = 'verify-failed'
      } else {
        // verify1 の executions のうち verify2 の報告から脱落したコマンドは pass/fail を問わず引き継ぐ
        // (コマンドが test_executions から黙って消える経路をコードで塞ぐ。prompt の「全件実行せよ」への
        //  遵守には委ねない。引き継がれた pass のエントリは修正前状態の値だが、コマンドが残ることで
        //  本体 step 3 の最終再実行対象に乗り、回帰はそこで捕捉される)
        const execs2 = sliceExcerpts(verify2.executions)
        const covered = new Set(execs2.map((e) => e.command))
        executions = execs2.concat(executions.filter((e) => !covered.has(e.command)))
        stoppedBy = failsOf(executions).length ? 'retry-exhausted' : 'all-green'
      }
    }
  }
}
log(`リトライ判定: retries=${retries} stopped_by=${stoppedBy}`)

// ============================================================
phase('集計')
// findings はフィールド明示で構築する (id は script 採番のみ。agent 申告の id・余剰フィールドを遮断)
const findings = (review ? review.findings : []).map((raw, i) => ({
  id: i + 1,
  summary: raw.summary,
  type: raw.type,
  // 番兵の不整合を正規化: type=none なら severity=none を強制 / type≠none で severity=none は medium に倒す
  severity: raw.type === 'none' ? 'none' : raw.severity === 'none' ? 'medium' : raw.severity,
  plan_ref: raw.plan_ref,
}))
const totals = {
  count: findings.length,
  unimplemented: findings.filter((f) => f.type === 'unimplemented').length,
  deviation: findings.filter((f) => f.type === 'deviation').length,
  none: findings.filter((f) => f.type === 'none').length,
}

// flags・test_green は buildResult が stopped_by / review / executions から一括導出する
const result = buildResult(review, {
  implementation_summary: impl.summary,
  changed_files: changedFiles,
  test_executions: executions,
  self_review: { findings, totals },
  retry_log: { retries, stopped_by: stoppedBy },
})
log(
  `集計: green=${result.test_green} (fail 残 ${failsOf(executions).length}${result.flags.no_tests_run ? '・実行 0 件' : ''}) / changed_files ${changedFiles.length} / self-review ${totals.count} 件 (未実装 ${totals.unimplemented} / 逸脱 ${totals.deviation} / 所見 ${totals.none})`,
)

return result
