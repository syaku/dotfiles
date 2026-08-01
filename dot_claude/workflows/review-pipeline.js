export const meta = {
  name: 'review-pipeline',
  description: 'develop のレビュー収束パイプライン: 自前のレビューエンジン (Scope→観点別 finder→独立 verify→sweep→synthesize) に security 観点と呼び出し元の追加観点を並走させ、修正→再レビューを対象ゼロ / 前進なし / ラウンド上限まで回す。規模判定・cap 到達検出・修正対象の絞り込み・前進判定・件数集計は script がコードで計算し、自己申告に依存しない',
  whenToUse: 'develop スキル本体 (SKILL.md) から scriptPath 指定で起動される。単体起動は想定しない',
  phases: [
    { title: 'レビュー', detail: 'レビューエンジン (Scope→finder→verify→sweep→synthesize) を回し、security 観点と追加観点を並走させる' },
    { title: '点検', detail: 'エンジンの検証を通っていない候補 (security・追加観点) だけを点検し、既存 findings との重複を統合する' },
    { title: '収束', detail: '修正対象の指摘だけを修正 → 再レビューを、対象ゼロ / 前進なし / ラウンド上限まで繰り返す' },
  ],
}

// ---- 入力 ----
// args: { request, worktree_cwd, side_effect_ban, plan_path?, changed_files?, changed_files_actual?,
//         diff_stat?, diff_command?, max_rounds?, source_note?,
//         per_angle?, verify_model?, verify_effort?, max_verifiers?, extra_lenses? }
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
// レビューが見る diff コマンド。渡されなければ worktree の未コミット差分を既定にする。
// Scope agent の推測に任せず逐語で指定するのは、Round 1 と再レビューが見る母数を揃えるため
const DIFF_COMMAND = typeof input.diff_command === 'string' && input.diff_command ? input.diff_command : `git -C ${WORKTREE} diff HEAD`
const MAX_ROUNDS = Number.isInteger(input.max_rounds) && input.max_rounds > 0 ? input.max_rounds : 5
const SOURCE_NOTE = typeof input.source_note === 'string' ? input.source_note : ''
// 追加の観点。エンジンの角度 A〜E と cleanup 5 レンズに無いものを Round 1 に並走させる。
// script にハードコードせず呼び出し元から受けるのは、業務固有の規約・思想を同期される正本に置かないため。
// 並走なのでエンジンの maxFindings / perAngle cap の影響を受けない。
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

// ---- コスト knob ----
// 実測（homelab 1 ファイル 38 行 / high）: verify が入力等価の 59%、find が 35%。verifier 1 個 ≈ 95k。
// per_angle は候補数を通じて verifier 数に線形に効くので、単価より先に効く knob になる。
const PER_ANGLE = Number.isInteger(input.per_angle) && input.per_angle > 0 ? input.per_angle : null
// verifier のモデル。未指定なら親セッションを継承する。Opus→Sonnet の単価比は 1.67 倍。
// finder は下げない方針（挙げなかった候補は下流の誰も再導出せず、取りこぼしが無音で恒久になるため）
const VERIFY_MODEL = typeof input.verify_model === 'string' && input.verify_model ? input.verify_model : null
const VERIFY_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'].includes(input.verify_effort) ? input.verify_effort : null
// verifier 数の上限。超えたらロケーション単位からファイル単位のグループ化に落とす
const MAX_VERIFIERS = Number.isInteger(input.max_verifiers) && input.max_verifiers > 0 ? input.max_verifiers : 20

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

// エンジンの角度 A〜E に認可漏れ専門のものはなく、Angle D に SQL injection が混ざる程度なので、
// security だけ専用の観点として並走させる。
const SECURITY_FOCUS = `データ保護と認可。認可チェックの欠落・他人のデータが見える経路・ログや例外メッセージへの個人情報の混入・入力の検証漏れ・SQL や外部コマンドへの値の埋め込み。
あわせて部分失敗の原子性も見る: 途中で失敗したときに中途半端な状態が残らないか、エラーを握り潰して成功として返す経路が無いか。`

// ---- レビューエンジンのプロンプト資産 ----
// 観点はバグの種類ではなく「探し方」で割る: 同じ差分を違う歩き方で読ませると、単一のレビューが
// 落とす候補を拾える。needsExploration は「diff の外を見に行くことが観点の定義そのもの」な角度の印。
const CORRECTNESS_ANGLES = [
  {
    label: 'angle-A',
    // 探索は不要（hunk と囲む関数で閉じる）
    needsExploration: false,
    text: `### Angle A — hunk-by-hunk interrogation

Walk the diff one hunk at a time, and Read the entire enclosing function for
each hunk — unchanged lines inside a touched function count too, because the
change can re-expose a latent defect or leave one unfixed. For every line ask
the same question: what input, state, timing, or platform turns this line
wrong? Probe specifically for: a condition inverted or testing the wrong
thing; boundaries off by one; dereferencing null/undefined; a Promise left
without \`await\`; zero or empty string treated as absent; a copy-pasted line
still reading the old variable; a catch block that hides the error; regex
metacharacters left unescaped. Separately, trace each multi-step operation
through a mid-way failure: does a half-applied state survive, and can the
failure surface as success?
`,
  },
  {
    label: 'angle-B',
    // 「別の場所を探す」ことが観点の定義そのもの。埋め込みで探索を止めさせない
    needsExploration: true,
    text: `### Angle B — what the deletions were protecting

Treat every line the diff deletes or replaces as a guarantee that just lost
its enforcement. Name that guarantee — a guard clause, an error path, a
validation, a test that exercised a real case — then search the new code for
the place that re-establishes it. If no such place exists, that is a
candidate finding.
`,
  },
  {
    label: 'angle-C',
    needsExploration: true,
    text: `### Angle C — contract drift across files

Every function the diff modifies has callers and callees written against its
old contract. Grep for each changed symbol and audit the call sites: did the
change add a precondition, reshape the return value, start throwing, or
introduce an ordering/timing assumption the caller does not honor? Then look
downward: does another change in this same diff make one of its own calls
unsafe?
`,
  },
  {
    label: 'angle-D',
    needsExploration: false,
    text: `### Angle D — language-specific footguns

Identify the language/framework of the changed code and sweep the diff for
its best-known traps. Examples: JavaScript — 0/'' falsiness, \`==\` coercion,
loop variables captured by closures; Python — mutable default arguments,
names bound late in closures; Go — writing to a nil map, capturing the range
variable; SQL built by string concatenation; date math that ignores
timezones/DST; comparing floats for equality. Flag only instances this diff
introduces.
`,
  },
  {
    label: 'angle-E',
    needsExploration: false,
    text: `### Angle E — delegation in wrappers

When the diff creates or edits a type that wraps another (cache, decorator,
proxy, adapter), verify two things. First, every operation must route to the
held inner instance — not resolve through a global, registry, or session,
which re-enters the wrapper or recurses (e.g. a caching layer that calls
\`session.get(id)\` where it should call \`this.inner.get(id)\`). Second, the
wrapper must expose every method its call sites actually invoke, not only the
ones that were convenient to forward.
`,
  },
]

// cleanup 5 レンズ。Reuse は既存ヘルパを探す観点なので探索が要る
const CLEANUP_TEXT = `### Reuse

The codebase may already provide what the new code hand-rolls. Grep shared
and utility modules plus the files adjacent to the change; when a helper
already exists, flag the reimplementation and name the helper to call
instead.


### Simplification

Hunt for complexity the diff did not need to add: state that duplicates or
can be derived from other state, near-identical copy-pasted blocks, nesting
a guard clause would flatten, code left behind that nothing reaches. Each
finding names the simpler form that does the same job.


### Efficiency

Hunt for work the diff wastes: the same value computed or fetched more than
once, independent operations awaited sequentially, blocking calls added to
startup or hot paths. Also flag long-lived objects that capture a closure or
environment — they pin the whole enclosing scope in memory for as long as
they live (a leak when that scope holds large values); suggest a class/struct
that copies only the fields it needs. Each finding names the cheaper form.


### Altitude

Judge whether each change landed at the right layer of the design. A special
case bolted onto shared infrastructure is the usual sign the fix is too
shallow — flag bandaids where generalizing the underlying mechanism would be
the honest fix.


### Conventions (CLAUDE.md)

Collect the CLAUDE.md files whose scope covers the changed files: the
user-level ~/.claude/CLAUDE.md, the repository root's, and any CLAUDE.md or
CLAUDE.local.md in an ancestor directory of a changed file (a CLAUDE.md
governs only its own subtree). Read each one that exists, then flag only
violations where you can quote both the governing rule and the offending
line — no taste calls, no stretching the "spirit" of a rule. Cite the
CLAUDE.md path and quote the rule in the finding so the report can point at
it. If nothing applies, return nothing for this angle.
`

// verify 段の判定ラダー。REFUTED をコードから構成できる反証に限定し、既定を PLAUSIBLE 側に倒す。
// 点検段の VERDICT_LADDER (日本語) と同じ思想の英語版で、group verifier の [i] 形式に合わせてある
const VERIFY_LADDER = `Verdict per candidate:
- **CONFIRMED** — you can name the concrete input or state that makes it fail
  and point at the wrong output or crash. Quote the code.
- **PLAUSIBLE** — the failure mechanism exists in the code, but its trigger
  depends on something uncertain (timing, environment, configuration). Say
  what observation would settle it.
- **REFUTED** — only when the code itself supplies the disproof: the claim
  misreads the code (quote what it actually says); a type, constant, or
  invariant rules it out (show which); this same diff already guards it (cite
  the guard); or the issue has no observable effect at all.

Default to PLAUSIBLE. "Speculative" or "depends on runtime state" is not
grounds for refutation when the state is realistic — races between concurrent
paths, null on a rare but reachable branch (error handlers, cold caches,
missing optional fields), zero treated as unset, a boundary the code never
excludes, retry pile-ups and partial failures, a regex or allowlist that lost
its anchor: judge all of these PLAUSIBLE.`

const CLEANUP_PRECEDENCE = `Cleanup findings use the same file/line/summary shape as correctness
findings; their failure_scenario states the concrete cost — what gets
duplicated, wasted, or harder to change, or which CLAUDE.md rule is broken —
rather than a crash. When the output cap forces cuts, cleanup findings are
cut before correctness bugs, never the other way around.
`

const SWEEP_GAP_FOCUS = `code that was moved or extracted and lost a guard or an anchor on the way;
the quieter footguns (a dataclass default built once and shared, hash()
varying between runs, a lock's critical section silently shrinking, an
is/has predicate that mutates state); tests whose setup and teardown no
longer mirror each other; a config default that flipped.`

function diffBlock() {
  return `対象の差分を自分で確認する。作業ツリー (cwd): ${WORKTREE}
差分の取得: ${DIFF_COMMAND}
未追跡ファイルは差分に出ないので git status --porcelain で拾い、Read で本文を読む。
${CHANGED_FILES.length ? `実装工程が申告した変更ファイル (起点情報。これだけを見て済ませず、差分の実体を自分で確認する):\n${CHANGED_FILES.map((f) => `- ${f}`).join('\n')}` : ''}
${PLAN_PATH ? `計画 (背景の参照用。計画との突合そのものは別工程の担当): ${PLAN_PATH}` : ''}
元の依頼: ${REQUEST}`
}

// ---- パス正規化 ----
// finder は出力に絶対パスと相対パスを混在させることがある。
// pre_existing 判定より前に揃えないと、同一ファイルを別物として扱って誤判定する。
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

// ---- ヘルパ ----
let findings = []
function normCategory(c) {
  const s = String(c || '').toLowerCase()
  return s === 'cleanup' || s === 'convention' || s === 'conventions' ? 'cleanup' : 'correctness'
}
// verified=true は独立した検証を通ったもの (エンジンの verifier、または点検段)。
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

// 修正対象の判定はコードが持つ。severity は使わず verdict + category で決める
// (severity は自己申告なので足切りの根拠にできない)。
// cleanup を外すのは、それが残るだけでラウンドを食い潰す構造を断つため (報告には残る)。
// verified を条件にするのは、独立した検証を通っていない指摘を修正 agent へ流さないため。
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
// ランク順: CONFIRMED correctness → PLAUSIBLE correctness → cleanup
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
  review_failed: false,
  review_error: null,
  security_failed: false,
  extra_lenses_missing: 0,
  unexplained_findings: 0,
  triage_failed: false,
  fix_failed: false,
  cap_reached: false,
  cap_hit_correctness: false,
  cap_shortfall: null,
  pre_existing_basis: PRE_EXISTING_BASIS,
}
let reviewStats = null

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
    review_stats: reviewStats,
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
log(`レベル判定: ${LEVEL} (${LEVEL_DECISION.reason})`)

// ---- レビューエンジン ----
// Scope → 観点別 finder → 独立 verify → sweep → synthesize の 5 段。
// 戻り値は { findings, refuted, stats }。findings の also_at (同一根本原因の他ロケーション) と
// stats の dropped (報告上限で切り捨てた件数) は構造化して返し、下流の cap 検出はこれを直接読む。
//
// 結線の設計:
//   - Scope が diff 本文と CLAUDE.md の要点まで取り、全 finder/verifier に配る (各自の再取得を止める)
//   - SCOPE_BLOCK を prompt の先頭に置く (agent 間で prefix を共有する)
//   - 探索が観点の定義そのものである角度 (B / C / Reuse) には「渡した文脈は出発点」と明記して探索を止めない
//   - per_angle / verify_model / verify_effort / max_verifiers をコスト knob として外から動かせる
const ENGINE_SCOPE_SCHEMA = {
  type: 'object',
  required: ['diffCommand', 'files', 'summary', 'diffText', 'diffTruncated'],
  properties: {
    diffCommand: { type: 'string', description: 'レビュー担当が実行するのと同じ diff コマンド' },
    files: { type: 'array', items: { type: 'string' }, description: '変更ファイルのパス' },
    summary: { type: 'string', description: '何が変わったかを 1 段落で' },
    conventions: { type: 'string', description: '適用される CLAUDE.md / rules から、レビュー担当が知っておくべき規約を逐語で引く。無ければ空文字' },
    diffText: { type: 'string', description: 'diffCommand の出力を逐語で。これを配ることで各担当の再取得を省く' },
    diffTruncated: { type: 'boolean', description: '差分が大きすぎて diffText を途中で切ったら true' },
  },
}

const ENGINE_CANDIDATES_SCHEMA = {
  type: 'object',
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'summary', 'failure_scenario'],
        properties: {
          file: { type: 'string', description: 'レビュー範囲に挙がっているパスと同じ表記で' },
          line: { type: 'number' },
          summary: { type: 'string' },
          failure_scenario: { type: 'string' },
        },
      },
    },
  },
}

const ENGINE_GROUP_VERDICT_SCHEMA = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index', 'verdict', 'evidence'],
        properties: {
          index: { type: 'number', description: '判定対象の候補に付いた [i] ラベル' },
          verdict: { enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] },
          evidence: { type: 'string', description: '該当行の引用' },
        },
      },
    },
  },
}

const ENGINE_REPORT_SCHEMA = {
  type: 'object',
  required: ['summary', 'decisions'],
  properties: {
    summary: { type: 'string' },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index'],
        properties: {
          index: { type: 'number', description: '報告に残す指摘の [i] ラベル' },
          merge: { type: 'array', items: { type: 'number' }, description: '同一の根本原因としてこれに畳む指摘の [i] ラベル' },
        },
      },
    },
  },
}

async function runReviewEngine(level) {
  const P = level === 'high' ? { angles: 3, perAngle: 6, maxFindings: 10, sweep: false } : { angles: 5, perAngle: 8, maxFindings: 15, sweep: true }
  const perAngle = PER_ANGLE || P.perAngle
  const sweepMax = 8

  // --- Scope: 差分の実体と規約をここで一度だけ取り、以降の担当に配る ---
  const scope = await agent(
    `Establish the scope of a code review, then hand the reviewers everything they need so they do not each re-fetch it.

Working tree (cwd): ${WORKTREE}
Diff command to use: ${DIFF_COMMAND}

1. Run the diff command and confirm it produces a non-empty diff. Untracked files do not appear in a diff — pick them up with \`git -C ${WORKTREE} status --porcelain\` and include their contents in diffText under a clear header.
2. List the changed files.
3. Summarize what changed in one paragraph.
4. Find the CLAUDE.md files that govern the changed code (the user-level ~/.claude/CLAUDE.md, the repo-root CLAUDE.md, and any CLAUDE.md or CLAUDE.local.md in a directory that is an ancestor of a changed file). Read each one that exists and **quote the rules a reviewer must know** into conventions — quote them, do not paraphrase, because the reviewers will not read these files themselves.
5. Put the complete diff output into diffText, verbatim. If it exceeds roughly 1500 lines, include the first 1500 and set diffTruncated to true; otherwise set it to false.

Structured output only.`,
    { agentType: 'Explore', schema: ENGINE_SCOPE_SCHEMA, label: 'engine:scope', phase: 'レビュー' },
  )
  if (!scope) return { error: 'scope agent returned no result' }
  if (!Array.isArray(scope.files) || !scope.files.length) {
    return { level, summary: 'No changes found to review.', findings: [], refuted: [], stats: { level, finders: 0, candidates: 0, verifierAgents: 0, verified: 0, refuted: 0, dropped: 0, droppedCorrectness: 0 } }
  }

  // 全 agent の prompt 先頭に置く共通ブロック。prefix を揃えてキャッシュを共有させる
  const SCOPE_BLOCK =
    `## Review scope\nDiff command: ${scope.diffCommand}\nChanged files (${scope.files.length}):\n${scope.files.map((f) => '  - ' + f).join('\n')}\n\n` +
    `## What changed\n${scope.summary}\n\n` +
    `## Conventions\n${scope.conventions || '(none noted)'}\n\n` +
    `## The diff${scope.diffTruncated ? ' (truncated — re-run the diff command yourself if you need the rest)' : ''}\n${scope.diffText}\n`

  const explorationNote = (needsExploration) =>
    needsExploration
      ? 'The diff above is your starting point, not a substitute for exploration. This angle is defined by looking outside the diff — Grep and Read the surrounding code as the angle requires. Do not skip that because the diff is already in front of you.'
      : 'The diff above is complete, so you do not need to run a command to obtain it. Read the enclosing functions and neighbouring code when the angle calls for it.'

  const finders = CORRECTNESS_ANGLES.slice(0, P.angles)
    .map((a) => ({ label: a.label, text: a.text, needsExploration: a.needsExploration, kind: 'correctness', cap: perAngle }))
    .concat([{ label: 'cleanup', text: CLEANUP_TEXT, needsExploration: true, kind: 'cleanup', cap: 5 * perAngle }])

  // --- Find ---
  const finderOuts = await parallel(
    finders.map((f) => () =>
      agent(
        `${SCOPE_BLOCK}
## Code-review finder — ${f.label}

Review the diff above ${f.kind === 'cleanup' ? 'through EACH of the following cleanup lenses' : 'ONLY through the lens of your assigned angle'}:

${f.text}
${f.kind === 'cleanup' ? CLEANUP_PRECEDENCE + '\n' : ''}
${explorationNote(f.needsExploration)}

Surface up to ${f.cap} candidate findings, each with file, line, a one-line summary, and a concrete failure_scenario — the user-visible consequence (error, wrong output, data loss), not an intermediate state (value stale, set grows). ${f.kind === 'cleanup' ? 'Cover whichever lenses apply — you do not need findings from every lens; prioritize the highest-cost issues across all of them. ' : ''}Pass every candidate with a nameable failure scenario through — do not silently drop half-believed candidates; an independent verifier judges them next. If nothing qualifies, return an empty list.

Structured output only.`,
        { agentType: 'Explore', schema: ENGINE_CANDIDATES_SCHEMA, label: `engine:${f.label}`, phase: 'レビュー' },
      ).then((r) => {
        if (!r) return []
        log(`finder ${f.label}: ${r.candidates.length} 候補`)
        return r.candidates.slice(0, f.cap).map((c) => ({ ...c, file: relPath(c.file), kind: f.kind }))
      }),
    ),
  )
  let candidates = finderOuts.filter(Boolean).flat()
  let candidatesSeen = candidates.length

  // --- Verify: ロケーション単位。上限を超えたらファイル単位に落とす ---
  let verifierAgents = 0
  const locOf = (c) => c.file + (c.line != null ? ':' + c.line : '')
  async function verifyGroups(list) {
    if (!list.length) return []
    const byLoc = new Map()
    for (const c of list) {
      const k = locOf(c)
      if (!byLoc.has(k)) byLoc.set(k, [])
      byLoc.get(k).push(c)
    }
    let groups = [...byLoc.values()]
    if (groups.length > MAX_VERIFIERS) {
      const byFile = new Map()
      for (const c of list) {
        if (!byFile.has(c.file)) byFile.set(c.file, [])
        byFile.get(c.file).push(c)
      }
      groups = [...byFile.values()]
      log(`verifier がロケーション単位で ${byLoc.size} 個になるため、ファイル単位 ${groups.length} 個に落とした (上限 ${MAX_VERIFIERS})`)
    }
    verifierAgents += groups.length
    const opts = { agentType: 'Explore', schema: ENGINE_GROUP_VERDICT_SCHEMA, phase: '点検' }
    if (VERIFY_MODEL) opts.model = VERIFY_MODEL
    if (VERIFY_EFFORT) opts.effort = VERIFY_EFFORT
    const out = await parallel(
      groups.map((g) => async () => {
        const r = await agent(
          `${SCOPE_BLOCK}
## Code-review verifier

## Candidate findings at ${g.length === 1 ? locOf(g[0]) : g[0].file}
${g.map((c, i) => `[${i}] ${locOf(c)}\n    Summary: ${c.summary}\n    Failure scenario: ${c.failure_scenario}`).join('\n')}

Read the relevant file(s) and return one verdict per candidate. Judge EACH candidate independently on its own claim — candidates at the same location may describe distinct issues, the same issue, or a mix. Reference each by its [i] index.

${VERIFY_LADDER}

Structured output only. Evidence must quote or cite the relevant line(s).`,
          { ...opts, label: `engine:verify:${(g[0].file.split('/').pop() || '?')}(${g.length})` },
        )
        if (!r) return []
        const byIdx = new Map()
        for (const v of r.verdicts) if (Number.isInteger(v.index) && v.index >= 0 && v.index < g.length) byIdx.set(v.index, v)
        // verdict が返らなかった候補は落とす。未検証のまま報告に混ぜない
        return g.flatMap((c, i) => (byIdx.has(i) ? [{ ...c, verdict: byIdx.get(i).verdict, evidence: byIdx.get(i).evidence }] : []))
      }),
    )
    return out.filter(Boolean).flat()
  }
  let verified = await verifyGroups(candidates)

  // --- Sweep: 取りこぼし専用の 1 パス。既知リストを渡して重複を避けさせる ---
  if (P.sweep) {
    const known = verified.length ? verified.map((c) => `- ${locOf(c)} — ${c.summary}`).join('\n') : '(none)'
    const sweep = await agent(
      `${SCOPE_BLOCK}
## Code-review sweep — gaps only

## Already-found candidates (do NOT re-derive or re-confirm these)
${known}

Re-read the diff and the enclosing functions looking ONLY for defects not already listed. Focus on what the first pass tends to miss: ${SWEEP_GAP_FOCUS}

Surface up to ${sweepMax} additional candidates. If nothing new, return an empty list — do not pad.

Structured output only.`,
      { agentType: 'Explore', schema: ENGINE_CANDIDATES_SCHEMA, label: 'engine:sweep', phase: 'レビュー' },
    )
    if (sweep && sweep.candidates.length) {
      const sliced = sweep.candidates.slice(0, sweepMax).map((c) => ({ ...c, file: relPath(c.file), kind: 'correctness' }))
      candidatesSeen += sliced.length
      log(`sweep: ${sliced.length} 候補`)
      verified = verified.concat(await verifyGroups(sliced))
    }
  }

  const surviving = verified.filter((c) => c.verdict !== 'REFUTED')
  const refutedList = verified.filter((c) => c.verdict === 'REFUTED')
  const stats = { level, finders: finders.length, candidates: candidatesSeen, verifierAgents, verified: verified.length, refuted: refutedList.length }
  if (!surviving.length) {
    return { level, summary: 'No findings survived verification.', findings: [], refuted: refutedList.map((c) => ({ file: c.file, line: c.line, summary: c.summary })), stats: { ...stats, reported: 0, dropped: 0, droppedCorrectness: 0 } }
  }

  // --- Synthesize: 重複を畳み、順位を付け、上限で切る ---
  // rank 順: CONFIRMED correctness → PLAUSIBLE correctness → cleanup
  const rank = (c) => (c.kind === 'cleanup' ? 2 : 0) + (c.verdict === 'PLAUSIBLE' ? 1 : 0)
  const ranked = surviving.slice().sort((a, b) => rank(a) - rank(b))
  const block = ranked
    .map((c, i) => `### [${i}] ${locOf(c)} (${c.verdict}${c.kind === 'cleanup' ? ', cleanup' : ''})\n${c.summary}\nFailure scenario: ${c.failure_scenario}\nVerifier evidence: ${c.evidence}\n`)
    .join('\n')
  const report = await agent(
    `## Synthesis: final code-review report

${ranked.length} findings survived independent verification (${level}-effort review). They are numbered [0]-[${ranked.length - 1}] below.

${block}

## Instructions
Return decisions about findings BY INDEX — never re-emit finding text.
1. For each distinct defect, emit one decision with its index. When several findings describe the same defect (same root cause), keep one entry and list the others in its merge array.
2. Order decisions most-severe first. Correctness bugs always outrank cleanup findings.
3. Keep at most ${P.maxFindings} decisions; omit the least severe beyond the cap.
4. Write a 2-3 sentence summary of the review.

Structured output only.`,
    { schema: ENGINE_REPORT_SCHEMA, label: 'engine:synthesize', phase: 'レビュー' },
  )

  // 組み立て。同一根本原因の他ロケーションは also_at (構造化) で返す。
  // cap で切り捨てた件数は seen に入らなかった残りとしてコードで正確に数える
  const decisions = report && Array.isArray(report.decisions) ? report.decisions : []
  const seen = new Set()
  const claim = (i) => (Number.isInteger(i) && i >= 0 && i < ranked.length && !seen.has(i) ? (seen.add(i), true) : false)
  const findings = []
  for (const d of decisions) {
    if (findings.length >= P.maxFindings) break
    if (!claim(d.index)) continue
    const c = ranked[d.index]
    const merged = (Array.isArray(d.merge) ? d.merge : []).filter(claim).map((i) => ranked[i])
    const verdict = merged.some((m) => m.verdict === 'CONFIRMED') ? 'CONFIRMED' : c.verdict
    findings.push({ file: c.file, line: c.line, summary: c.summary, failure_scenario: c.failure_scenario, category: c.kind, verdict, also_at: [...new Set(merged.map(locOf).filter((l) => l !== locOf(c)))] })
  }
  // 上限まで余っていれば、synthesis が触れなかった残りを埋める (静かに落とさない)
  for (let i = 0; i < ranked.length && findings.length < P.maxFindings; i++) {
    if (!claim(i)) continue
    const c = ranked[i]
    findings.push({ file: c.file, line: c.line, summary: c.summary, failure_scenario: c.failure_scenario, category: c.kind, verdict: c.verdict, also_at: [] })
  }
  const droppedList = ranked.filter((_, i) => !seen.has(i))
  return {
    level,
    summary: (report && report.summary) || 'review engine completed.',
    findings,
    refuted: refutedList.map((c) => ({ file: c.file, line: c.line, summary: c.summary })),
    stats: { ...stats, reported: findings.length, dropped: droppedList.length, droppedCorrectness: droppedList.filter((c) => c.kind !== 'cleanup').length },
  }
}

function lensPrompt(focus, { context, requiresRationale } = {}) {
  return `あなたはコードレビュー担当。直前の実装で入った差分を、下記の観点に絞ってレビューし findings を返せ。コードの修正・編集はしない (Read/Glob/Grep と読み取りの Bash のみ)。

担当する観点: ${focus}
この観点の外にあるものは別の担当が並行して見ているので挙げない。
${context ? `\n参照する情報:\n${context}\n` : ''}${requiresRationale ? RATIONALE_BAR : ''}
${ROUND1_BAR}

${diffBlock()}`
}

// レビューエンジン・security・追加観点を 1 つの parallel で並走させる。
// security と追加観点はエンジンの外側なので、maxFindings / perAngle cap の影響を受けない
const round1Results = await parallel([
  () => runReviewEngine(LEVEL).then((v) => ({ ok: true, value: v })).catch((e) => ({ ok: false, error: String((e && e.message) || e) })),
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
const engineWrapped = round1Results[0]
const secResult = round1Results[1]
const extraResults = round1Results.slice(2)

// エンジンは scope の失敗を throw ではなく { error } という戻り値で返す。
// throw だけを捕捉すると findings 0 件と区別できず、レビューが走っていないのに converged になる
const engineResult =
  engineWrapped && engineWrapped.ok === true && engineWrapped.value && typeof engineWrapped.value === 'object' && !engineWrapped.value.error && Array.isArray(engineWrapped.value.findings)
    ? engineWrapped.value
    : null

if (engineResult) {
  reviewStats = engineResult.stats || null
  for (const f of engineResult.findings) {
    pushFinding(
      { summary: f.summary, failure_scenario: f.failure_scenario, category: f.category, file: f.file, line: f.line },
      { round: 1, lens: 'review', verdict: f.verdict === 'CONFIRMED' ? 'CONFIRMED' : 'PLAUSIBLE', verified: true, evidence: '', alsoAt: f.also_at },
    )
  }
  log(`レビューエンジン (${LEVEL}): findings ${engineResult.findings.length} 件`)
} else {
  flags.review_failed = true
  flags.review_error =
    engineWrapped && engineWrapped.ok === false
      ? engineWrapped.error
      : engineWrapped && engineWrapped.value && engineWrapped.value.error
        ? String(engineWrapped.value.error)
        : 'レビューエンジンの戻り値が想定の形ではない'
  log(`レビューエンジンを使えなかった: ${flags.review_error}。security 観点と追加観点だけが残る`)
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

// レビュー本体も security も追加観点も何も残らなかったときだけ「レビュー未実施」とする。
// 指摘ゼロは正当な出力なので、本体が動いた上での 0 件と区別する
if (!findings.length && flags.review_failed && flags.security_failed) {
  return result('review-failed', { fixes: [], changed_files: [], rounds: [] })
}

// ---- cap 到達の検出 ----
// エンジンは maxFindings を超えて切り捨てた件数を stats.dropped にコードで数えて返す
// (組み立ての seen に入らなかった残り)。droppedCorrectness > 0 なら correctness の指摘が
// 実際に押し出されており、推定ではなく確定として扱える
if (reviewStats && Number.isFinite(reviewStats.dropped)) {
  flags.cap_shortfall = reviewStats.dropped
  if (reviewStats.dropped > 0) {
    flags.cap_reached = true
    flags.cap_hit_correctness = reviewStats.droppedCorrectness > 0
    log(`cap 到達: 検証を通った候補のうち ${reviewStats.dropped} 件が報告上限で切り捨てられた（${flags.cap_hit_correctness ? `correctness ${reviewStats.droppedCorrectness} 件が押し出された` : '押し出されたのは cleanup 側で修正対象は残っている'}）`)
  }
}

// ============================================================
phase('点検')
await triageUnverified('triage:r1')
log(`修正対象: ${fixTargets().length} 件（cleanup と pre_existing は報告のみ）`)

// correctness の指摘が報告上限で切り捨てられた = 見えていない correctness が確実に存在する。
// それを残したまま自動修正を進めるより、ここで止めて人に渡す方が安全。correctness だけで
// 報告上限を食い尽くす密度なら、無人で直し続ける判断自体が誤っている。
// cleanup 側の切り捨ては修正対象を削らないので、報告に載せるだけで収束は妨げない。
if (flags.cap_reached && flags.cap_hit_correctness) {
  log('correctness の指摘が報告上限からあふれた。見えていない指摘を残したまま修正しないためエスカレーションする')
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
  `収束: ${out.totals.count} 件 (解消 ${out.totals.resolved} / 反証 ${out.totals.refuted} / 重複 ${out.totals.duplicates} / 既存 ${out.totals.pre_existing} / cleanup ${out.totals.cleanup} / 未検証 ${out.totals.unverified} / 理由なし乖離 ${out.totals.unexplained} / 未対応 ${out.totals.fix_targets}) rounds=${rounds.length} stopped_by=${out.stopped_by} level=${LEVEL}${flags.review_failed ? ' (レビューエンジン未実施)' : ''}${EXTRA_LENSES.length ? ` extra_lenses=${EXTRA_LENSES.length}` : ''}`,
)
return out
