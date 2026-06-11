export const meta = {
  name: 'distill-pipeline',
  description: 'drain/distill の蒸留パイプライン: 素材整理→既存突き合わせ→候補生成→命名ゲート (機械 regex＋別 context 点検＋再命名ループ)→洞察検出→タスク・done 検出。件数・ゲート判定・モード封鎖・規約検証は script がコードで実行し、自己申告に依存しない',
  whenToUse: 'drain / distill スキル本体 (SKILL.md) から scriptPath 指定で起動される。単体起動は想定しない',
  phases: [
    { title: '素材整理', detail: 'input 昇格候補 / 会話素材 / 期間素材の構造化と既存ノード突き合わせ (drain=sonnet・daily/backfill=opus)' },
    { title: '命名ゲート', detail: '機械 regex → 別 context 点検 agent → 再命名 → 再点検 (最大 2 ラウンド・未解決は人ゲートへ持ち越し)' },
    { title: '洞察検出', detail: 'ノード間の繋がりから第三の知見を検出 (opus・0 件は正当)' },
    { title: 'タスク・完了検出', detail: '既存タスクの done 候補検出 (証拠引用は script が素材への包含で機械照合)' },
    { title: '集計', detail: 'ノート規約の機械検証 (frontmatter/更新履歴/ラベル残存/タグ整合) と totals 計算' },
  ],
}

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
if (!['drain', 'daily', 'backfill'].includes(MODE)) throw new Error('mode は drain | daily | backfill のいずれか')
const VAULT = input.vault
const NOW = input.now // ISO-T (YYYY-MM-DDTHH:mm)
const TODAY = input.today // YYYY-MM-DD
const INPUT_FILES = input.input_files || [] // drain: [{path, content}] — content は done 照合・素材渡しのため呼び出し側が Read して渡す
const MATERIALS = input.materials || '' // daily: 会話素材ダイジェスト (逐語抜粋ベース)
const CURSOR_PAGES = input.cursor_pages || [] // daily: カーソル以降 createdAt の pages パス一覧 (drain 産見直し対象)
const PERIOD = input.period || null // backfill: {from, to}
if (MODE === 'drain' && !INPUT_FILES.length) throw new Error('drain には input_files ([{path, content}]) が必要')
if (MODE === 'daily' && !MATERIALS && !CURSOR_PAGES.length) throw new Error('daily には materials か cursor_pages の少なくとも一方が必要')
if (MODE === 'backfill' && !(PERIOD && PERIOD.from && PERIOD.to)) throw new Error('backfill には period ({from, to}) が必要')

// ---- モデル固定 (モデル出し分けを /model 手動運用から script へ移す) ----
const M_EXTRACT = MODE === 'drain' ? 'sonnet' : 'opus' // drain の昇格・整形はモデル差が小さい / daily・backfill は洞察前段の素材判断が重い
const M_INSIGHT = 'opus' // 洞察検出はモデル差が最大
const M_CHECK = 'sonnet' // 命名点検は基準照合で軽い

// ---- backfill のタスクラベル封鎖: schema enum で ②③ を表現不能にする (散文の 3 重ゲートを置換) ----
const TASK_LABELS = MODE === 'backfill' ? ['①'] : ['①', '②', '③']

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

function candidateItem(kinds) {
  return {
    type: 'object',
    required: ['kind', 'label', 'title', 'content', 'fold_into', 'source_excerpt', 'why_important', 'backlink_edits'],
    properties: {
      kind: { enum: kinds },
      label: { enum: ['none', ...TASK_LABELS], description: 'kind=タスク のとき抽出ラベル。それ以外は none' },
      title: { type: 'string', description: 'ノートのファイル名になるタイトル (拡張子なし)' },
      content: { type: 'string', description: 'frontmatter＋本文の完成形。fold_into 指定時は空文字' },
      fold_into: { type: 'string', description: '明白に同一物の既出を既存ノートへ畳む場合のみその path。新規なら空文字 (迷ったら分けて作りリンクする)' },
      source_excerpt: { type: 'string', description: 'タイトルの元になった素材の逐語抜粋 (命名点検の元記述)' },
      why_important: { type: 'string', description: 'タスク③は必須。それ以外は空文字可' },
      backlink_edits: { type: 'array', items: BACKLINK_EDIT, description: '関連既存ノード側からの逆リンク追記 (双方向リンク)。fold 時は畳み先への追記' },
    },
  }
}

const EXTRACT_SCHEMA = {
  type: 'object',
  required: ['promotions', 'old_name_referrers'],
  properties: {
    promotions: { type: 'array', items: candidateItem(['気づき', 'タスク', '作業レポート・事実']) },
    old_name_referrers: { type: 'array', items: { type: 'string' }, description: '昇格でこの input 名が変わる/分割される場合、元 input 名を wikilink で指す既存ノートの path (rg -l の結果)' },
  },
}

const REVISION_ITEM = {
  type: 'object',
  required: ['path', 'kind', 'field', 'current', 'proposed', 'reason', 'source_excerpt'],
  properties: {
    path: { type: 'string' },
    kind: { enum: ['気づき', '洞察', 'タスク', '作業レポート・事実'] },
    field: { enum: ['title', 'tags', 'layer'] },
    current: { type: 'string' },
    proposed: { type: 'string' },
    reason: { type: 'string' },
    source_excerpt: { type: 'string', description: '当該ノート本文の該当箇所抜粋 (title 見直しの命名点検に使う元記述)' },
  },
}

const DAILY_SCHEMA = {
  type: 'object',
  required: ['candidates', 'revisions'],
  properties: {
    candidates: { type: 'array', items: candidateItem(['気づき', 'タスク', '作業レポート・事実']) },
    revisions: { type: 'array', items: REVISION_ITEM },
  },
}

const BACKFILL_SCHEMA = {
  type: 'object',
  required: ['period_pages', 'journal_notes', 'candidates'],
  properties: {
    period_pages: { type: 'array', items: { type: 'object', required: ['path', 'gist'], properties: { path: { type: 'string' }, gist: { type: 'string' } } } },
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
        required: ['claim', 'connected_notes', 'title', 'content', 'why_important', 'backlink_edits'],
        properties: {
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

// ---- 共有プロンプト断片 (判断方針の規約。機械検証可能なものは下の JS 関数が担う) ----
const VAULT_RULES = `
vault 規約 (ノート生成時に厳守):
- 置き場は ${VAULT}/pages/ 直下。専用フォルダを作らない。
- frontmatter: createdAt / updatedAt とも ${NOW} (ISO-T)。status: active。tags は 3 つ程度・大枠カテゴリのみ・日本語優先・既存タグ再利用 (新規タグは既存に該当が無い場合のみ)。
- 気づきノートは tags に 気づき。洞察ノートは tags に 洞察＋frontmatter source: に繋いだ元ノートを各行 '  - "[[ノート名]]"' で列挙。タスクノートは tags に タスク＋progress: backlog。検証済みの事実・仕様・作業レポートにはどれも付けない (トピックタグのみ)。
- 層の判別: 気づき＝作業を通じて立ち上がった主観的な学び・判断・方針。事実＝外部検証可能な客観 (特定ツールの狭いスペック)。決め手はタイトルの高度——主語をツールから一般化した教訓は気づき側。高度は 事実/仕様 → 気づき → 原理・方針 → 洞察 の順。
- 本文: H1 禁止 (H2 から)。冒頭に > [!NOTE] AI Context callout で主題を 1〜2 文。概念・元ノートへ本文 wikilink を張る。末尾に ## 更新履歴 と「- [[${TODAY}]] — <理由>」行 (journal 日付 wikilink はここに集約し本文に散らさない)。
- タスク本文: ## やること を plain な「- 」箇条書き (チェックボックス「- [ ]」禁止)。③ 由来は ## 元ノート(なぜ重要) 必須。ラベル文字 ①②③ は label field のみに書き、タイトル・content に残さない。
- 捏造補完しない: 元の素材から復元できる範囲に留める。素材に無い感覚・詳細を想像で埋めない。
- 突き合わせ: 明白に同一物の既出だけ既存ノードへ畳む (fold_into)。迷ったら分けて作りリンクする (失敗は重複でなく orphan。重複生成は主題が繰り返すシグナル)。
- imports/kindle/ imports/wallabag/ はリンク先に使ってよいが編集対象にしない。`

const NAMING_POLICY = `
命名規約 (気づき・洞察):
- 1 タイトル＝1 要点。避けたい失敗・問題を plain な確立語で名指す (解・抽象的な徳・jargon・造語・狭い実装語を避ける。解や徳は本文へ逃がす)。
- 条件と結果の複文にしない。要点を 1 動詞に圧縮する (「〜すると」「〜して〜する」「Xは Y で Z する」は 2 主張の混在)。
- scope は固有名詞で狭めず hedge で合わせる (「場合がある」等)。ただしツール固有のクセ・仕様は固有名詞を残す。
- 抽象は本文/リンクが事例で接地している時だけ。作業ログ・調査記録のタイトルは具体のまま据え置く (抽象化すると何を調べたか消える実害)。
- 気づき/洞察の「なぜ重要」「応用」はソフトウェア開発に転用できる形を最低 1 つ接地させる (読み手は SWE)。
タスクの命名 (別軸): 動詞主体の短句 (「〜する」「〜を確認する」) で何の行動かを言い切る。複文化しないのは共通。`

// ---- 命名ゲート (3 層: 機械 regex → 別 context 点検 agent → 再命名ループ) ----
const FUKUBUN = /、|すると|したら|つつ|（|\(/g
function regexHits(title) {
  return title.match(FUKUBUN) || []
}

function checkerPrompt(kind, title, excerpt) {
  const taskCriteria = `- 動詞主体の短句か (「〜する」「〜化する」「〜を確認する」)。
- 複文化していないか (条件節・並列。連用形「〜して」の 2 動詞構造、主述 1 文の条件結果型「Xは Y で Z する」もすり抜け対象として見る)。`
  const noteCriteria = `① 失敗モードを名指しているか: 解の指示形「〜する」・肯定形 (「〜から見える」「〜を活かす」) が混ざっていないか。タイトル本体は避けたい失敗・問題を据える。
② 平易な日常語か: jargon・英語混入・造語・狭い実装語が無いか (vault で確立した技術術語は許容)。
③ 不自然な動詞-目的語結合が無いか: 圧縮で生じる不自然結合 (「過剰を取り込む」等) は元記述の意味を消すシグナル。
④ 元記述の単純な圧縮になっていないか: 述語・名詞の順序入替・短縮だけで語彙構成が変わっていなければ要点が抽出されていない。
⑤ 条件結果の 2 動詞構造になっていないか: 連用形「〜して〜する」、主述 1 文の条件結果型。要点を 1 動詞に圧縮できるかで判定する (できなければ 2 主張の混在＝複文)。`
  return `あなたはタイトル案の指摘者である。書き直さない・代替案を出さない・違反の指摘だけ返す。ツールは一切使わない (判断のみ)。生成時の確信は手元に無くてよい・無いまま per-item で独立に判断する。

種別: ${kind}
タイトル案: ${title}
元記述 (この素材から名付けられた):
${excerpt || '(元記述なし)'}

判断基準:
${kind === 'タスク' ? taskCriteria : noteCriteria}

verdict: 違反あり=該当 / 違反なし=非該当 / 元記述が薄く判定できない=判断不能 (note に理由を 1 行)。`
}

function renamePrompt(kind, title, excerpt, issues) {
  return `あなたはタイトルの再命名担当。以下の指摘を解消する新しいタイトルを 1 つだけ返せ。ツールは使わない。

種別: ${kind}
現タイトル: ${title}
元記述: ${excerpt || '(なし)'}
指摘: ${issues}
${NAMING_POLICY}
機械ゲート (正規表現 、|すると|したら|つつ|（|\\( ) にもかからないこと。`
}

function renameCandidate(c, newTitle) {
  const old = c.title
  c.title = newTitle
  if (c.content) c.content = c.content.split(`[[${old}]]`).join(`[[${newTitle}]]`)
  for (const e of c.backlink_edits || []) e.add_line = e.add_line.split(`[[${old}]]`).join(`[[${newTitle}]]`)
}

async function nameGate(c, renameModel) {
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
  return !c.fold_into && (c.kind === '気づき' || c.kind === 'タスク' || c.kind === '洞察')
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
  if (/[①②③]/.test(content)) errs.push('ラベル文字 ①②③ が残存している')
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
function drainExtractPrompt(f) {
  return `あなたは vault inbox 排出 (drain) の昇格担当。以下の input ノート 1 件を読み、pages/ へ昇格させる候補を構造化して返せ。ファイルへの書き込みは一切しない (Read/Grep/Glob のみ。Write は呼び出し元の責務)。

vault: ${VAULT}
input ノート: ${f.path}
--- 内容ここから ---
${f.content}
--- 内容ここまで ---

手順:
1. この input の内容を「名付けられる粒度」で昇格候補に分ける (1 input から複数可。作業レポートは原則 1:1 で具体タイトルのまま昇格)。
2. 各候補について vault 既存ノート (pages/ の概念・気づき・洞察・タスク) を Grep/Read で突き合わせ、関連ノートを洗う。
3. 新規候補は content に frontmatter＋本文の完成形を書く。関連既存ノード側からの逆リンク 1 行を backlink_edits に列挙する (双方向リンク。関連が実在するものだけ・弱い繋がりを強引に張らない)。
4. この input のファイル名が昇格で変わる/分割される場合、rg -l '\\[\\[<元 input 名 (拡張子なし)>\\]\\]' ${VAULT} で被リンクを機械的に洗い old_name_referrers に返す (0 ヒットなら空配列。同名昇格なら洗わなくてよい)。

タスク抽出: input 中の未着手の行動を kind=タスク で抽出する。ラベルは ① 明示 TODO (「TODO」「未実施」「やる」等が plain にある) / ② 次タスク候補 (「次は〜」等の先送り表明) / ③ ノート分析で出た課題 (論理ギャップ・矛盾・未解決。why_important 必須)。
洞察はここで作らない (後段の専用 agent が担う)。
${VAULT_RULES}
${NAMING_POLICY}`
}

function dailyPrompt() {
  return `あなたは日次蒸留の素材整理担当。以下の素材から、気づき(A) のノード化候補・タスク抽出・drain 産ノートの見直しを構造化して返せ。ファイルへの書き込みは一切しない (Read/Grep/Glob のみ)。

vault: ${VAULT}

素材 1 — 当日セッションの会話素材ダイジェスト (逐語抜粋ベース。ここに無い感覚を想像で補完しない):
${MATERIALS || '(なし)'}

素材 2 — 前回日次蒸留以降に drain で昇格した pages (見直し対象。Read して命名・層判定・タグを点検する):
${CURSOR_PAGES.length ? CURSOR_PAGES.map((p) => '- ' + p).join('\n') : '(なし)'}

手順:
1. 素材 1 から気づき(A) 候補を拾い、名付けられる粒度でノード化候補にする。既存ノートと Grep/Read で突き合わせ、明白に同一物の既出だけ fold_into で畳む。
2. 素材 1 からタスクを抽出する (ラベル ① 明示 TODO / ② 次タスク候補 / ③ ノート分析で出た課題。③ は why_important 必須)。
3. 素材 2 の各ノートを Read し、命名規約・層判定 (気づき/事実の取り違え)・タグの誤りがあれば revisions に提案する (field: title|tags|layer)。正しければ提案しない。source_excerpt にそのノート本文の該当箇所を抜粋する。
4. 事実・作業レポートに該当する素材は kind=作業レポート・事実 とし、気づき/洞察タグを付けない。

洞察はここで作らない (後段の専用 agent が担う)。素材が無ければ candidates 空配列が正当 (でっち上げない)。
${VAULT_RULES}
${NAMING_POLICY}`
}

function backfillPrompt() {
  return `あなたは backfill (過去期間の遡り蒸留) の素材収集担当。ファイルへの書き込みは一切しない (Read/Grep/Glob のみ)。

vault: ${VAULT}
対象期間: ${PERIOD.from} 〜 ${PERIOD.to}

手順:
1. pages/ の frontmatter createdAt が期間内のノートを Grep で洗い、period_pages に path と 1 行要旨を返す (createdAt を正とする。filesystem の時刻は使わない——mv で birthtime がずれる)。
2. 期間内の journals/<YYYY-MM-DD>.md の「## 作業メモ」に手書き記述があれば journal_notes に抜粋を返す (空の日も多い。空を想像で埋めない)。
3. タスク抽出は ① 明示 TODO のみ (ノート本文に TODO/未実施/やる 等が plain にある未着手記述)。②③ は抽出しない (過去日の感覚を想像で埋める捏造リスク。schema 上も ① しか表現できない)。

気づき(A) の新規ノード化はこのモードでは行わない (会話文脈が無く捏造になる)。過去 journal を埋めることもしない。
${VAULT_RULES}
${NAMING_POLICY}`
}

function insightPrompt(newNotesList, extraMaterial) {
  return `あなたは洞察(B) の検出担当。「個別には既知だが、繋ぐと第三の知見が出る」関係だけを洞察候補として返せ。ファイルへの書き込みは一切しない (Read/Grep/Glob のみ)。

vault: ${VAULT}

今回の新規/更新ノード (タスクは素材に含めない——層が違う。タスク由来の論点は背景の元ノート側を素材にする):
${newNotesList || '(なし)'}

${extraMaterial}

手順:
1. 新規ノードと既存ノート (pages/ の #気づき #洞察・概念ノート。MOC/洞察.md も入口に使える) の繋がりを Grep/Read で探す。
2. 単一観測・単一ノートの感想は洞察ではない (それは気づき止まり)。繋いで初めて見える第三の知見だけ。既出洞察の焼き直しも作らない。「過去の洞察と同じ筋」の再発はそれ自体が再発パターンの洞察になりうる。
3. 各候補: claim に洞察を一文で言い切る (複文可)。title は claim から述語を 1 つ選び、条件節を捨てて圧縮する。connected_notes に繋いだ実在ノートの path (実在を Read で確認する)。content は templates/insight.md の構造 (AI Context callout / ## 見えた洞察 / ## なぜ重要 / ## 応用・次アクション) で frontmatter＋本文の完成形。source: に繋いだ元ノートを '  - "[[ノート名]]"' 形式で列挙。
4. なぜ重要・応用にはソフトウェア開発に転用できる接地を最低 1 つ入れる (読み手は SWE)。

繋がりが弱ければ 0 件が正当な出力 (「A 止まりですらない」もありうる)。無理に B をでっち上げない。
${VAULT_RULES}
${NAMING_POLICY}`
}

function donePrompt(corpus) {
  return `あなたは既存タスクの完了検出担当。vault の未完了タスクノートを洗い、下の作業素材に完了の証拠があるものだけ返せ。書き込みはしない。

vault: ${VAULT}
未完了タスクの洗い方: pages/ を Grep して tags に タスク を含み progress が done でないノートを特定し、各ノートの ## やること を Read する。

作業素材 (この中の逐語引用だけが証拠になる):
--- 素材ここから ---
${corpus}
--- 素材ここまで ---

判定は証拠ベース: 「やることが満たされた」「〜は完了した」と読める記述の逐語引用を evidence_quote に返す (script が素材への包含を機械照合する。要約・言い換えは照合に落ちる)。推測で done 候補にしない。該当なしなら空配列が正当。`
}

// ============================================================
phase('素材整理')
log(`mode=${MODE} / 素材: ${MODE === 'drain' ? INPUT_FILES.length + ' input files' : MODE === 'daily' ? `会話ダイジェスト${MATERIALS ? 'あり' : 'なし'}・cursor_pages ${CURSOR_PAGES.length} 件` : `${PERIOD.from}〜${PERIOD.to}`}`)

let candidates = []
let revisions = []
let linkRewrites = []
let backfillMaterial = null
let corpus = '' // done 検出の証拠照合用テキスト (script が手元に持つ素材だけが照合対象)
const flags = { extraction_failed: [], insight_failed: false, done_failed: false }

if (MODE === 'drain') {
  corpus = INPUT_FILES.map((f) => `===== ${f.path} =====\n${f.content}`).join('\n')
  await pipeline(
    INPUT_FILES,
    (f) =>
      agent(drainExtractPrompt(f), {
        schema: EXTRACT_SCHEMA,
        model: M_EXTRACT,
        label: `extract:${f.path.split('/').pop()}`,
        phase: '素材整理',
      }),
    async (ex, f) => {
      if (!ex) {
        flags.extraction_failed.push(f.path)
        return null
      }
      for (const c of ex.promotions) c.origin = f.path
      // 同一 input の候補は揃った時点で即ゲートに流す (他 input の抽出を待たない)
      await parallel(ex.promotions.filter(needsGate).map((c) => () => runGate(c)))
      candidates.push(...ex.promotions)
      if (ex.old_name_referrers.length) linkRewrites.push({ input: f.path, referrers: ex.old_name_referrers })
      return ex
    },
  )
} else if (MODE === 'daily') {
  corpus = MATERIALS
  const r = await agent(dailyPrompt(), { schema: DAILY_SCHEMA, model: M_EXTRACT, label: 'daily-extract', phase: '素材整理' })
  if (!r) throw new Error('日次素材整理 agent が結果を返さなかった')
  candidates = r.candidates
  revisions = r.revisions
  await parallel(candidates.filter(needsGate).map((c) => () => runGate(c)))
  // drain 産ノートのタイトル見直し提案にも同じ命名ゲートを通す
  await parallel(
    revisions
      .filter((v) => v.field === 'title' && v.kind !== '作業レポート・事実')
      .map((v) => () => {
        const wrap = { kind: v.kind, title: v.proposed, source_excerpt: v.source_excerpt, content: '', backlink_edits: [] }
        return nameGate(wrap, M_INSIGHT).then((g) => {
          v.proposed = wrap.title
          v.gate = g
        })
      }),
  )
} else {
  // backfill: done 検出なし (過去素材からの完了推測は捏造リスク)
  const r = await agent(backfillPrompt(), { schema: BACKFILL_SCHEMA, model: M_EXTRACT, label: 'backfill-collect', phase: '素材整理' })
  if (!r) throw new Error('backfill 素材収集 agent が結果を返さなかった')
  backfillMaterial = { period_pages: r.period_pages, journal_notes: r.journal_notes }
  // schema enum (['①']) で ②③ は表現不能だが、script 側でも二重に防御する
  candidates = r.candidates.filter((c) => c.kind !== 'タスク' || c.label === '①')
  await parallel(candidates.filter(needsGate).map((c) => () => runGate(c)))
}
log(`素材整理: 候補 ${candidates.length} 件 (うち fold ${candidates.filter((c) => c.fold_into).length})${revisions.length ? ` / 見直し提案 ${revisions.length} 件` : ''}`)

// ============================================================
phase('洞察検出')
const nonTask = candidates.filter((c) => c.kind !== 'タスク')
const newNotesList = nonTask
  .map((c) => `- [${c.kind}] ${c.title}${c.fold_into ? ` (→ ${c.fold_into} へ畳む)` : ''}`)
  .join('\n')
let extraMaterial = ''
if (MODE === 'daily') extraMaterial = `会話素材ダイジェスト:\n${MATERIALS}`
if (MODE === 'drain') extraMaterial = `昇格元 input の内容 (素材):\n${corpus}`
if (MODE === 'backfill') extraMaterial = `期間素材 (素材収集の結果。これを正とする):\n${JSON.stringify(backfillMaterial, null, 2)}`

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
    i.source_excerpt = i.claim
  }
  await parallel(insights.map((i) => () => runGate(i)))
  candidates.push(...insights)
}
log(`洞察検出: ${ir ? ir.insights.length : '失敗'} 件`)

// ============================================================
phase('タスク・完了検出')
let doneCandidates = []
if (MODE !== 'backfill' && corpus) {
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
log(`done 候補: ${doneCandidates.length} 件 (引用照合落ち ${doneCandidates.filter((d) => !d.quote_verified).length})`)

// ============================================================
phase('集計')
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
  revisions: revisions.length,
  done_candidates: doneCandidates.length,
}
log(
  `集計: ${totals.count} 候補 (気づき ${totals.kizuki} / 洞察 ${totals.insights} / タスク ${totals.tasks} / レポート・事実 ${totals.reports} / fold ${totals.folds}) 再命名 ${totals.renamed} / ゲート未解決 ${totals.gate_unresolved} / 検証落ち ${totals.validation_failed}`,
)

return {
  mode: MODE,
  candidates,
  revisions,
  link_rewrites: linkRewrites,
  done_candidates: doneCandidates,
  totals,
  flags,
}
