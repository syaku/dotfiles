export const meta = {
  name: 'harvest-pipeline',
  description: 'drain (即時 ingestion)・backfill (期間 reconciliation) の 2 層蒸留パイプライン: 素材整理→既存突き合わせ→候補生成→命名ゲート (機械 regex＋別 context 点検＋再命名ループ)→洞察検出→タスク・done 検出。件数・ゲート判定・モード封鎖・規約検証は script がコードで実行し、自己申告に依存しない',
  whenToUse: 'drain / harvest スキル本体 (SKILL.md) から scriptPath 指定で起動される。単体起動は想定しない',
  phases: [
    { title: '素材整理', detail: 'input 昇格候補 (drain=sonnet) / 期間素材 (backfill=opus) の構造化と既存ノード突き合わせ' },
    { title: '命名ゲート', detail: '機械 regex → 別 context 点検 agent → 再命名 → 再点検 (最大 2 ラウンド・未解決は人ゲートへ持ち越し)' },
    { title: '洞察検出', detail: 'ノード間の繋がりから第三の知見を検出 (opus・0 件は正当・backfill は蓄積グラフの創発/メタ洞察が主眼)' },
    { title: 'タスク・完了検出', detail: '既存タスクの done 候補検出。証拠は drain=input 連結・backfill=期間内作業レポート本文。引用は script が素材への包含で機械照合' },
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
if (!['drain', 'backfill'].includes(MODE)) throw new Error('mode は drain | backfill のいずれか')
const VAULT = input.vault
const NOW = input.now // ISO-T (YYYY-MM-DDTHH:mm)
const TODAY = input.today // YYYY-MM-DD
const INPUT_FILES = input.input_files || [] // drain: [{path, content}] — content は done 照合・素材渡しのため呼び出し側が Read して渡す
const PERIOD = input.period || null // backfill: {from, to}
const STYLE_TITLES = input.style_titles || [] // 既存 #気づき/#洞察 ノートのタイトル一覧 (家風の実例。呼び出し側が rg で機械取得して渡す)
const DISTILL_LOG_TEXT = input.distill_log_text || '' // pages/distill運用ログ.md の本文 (呼び出し側が Read して渡す)。✗→○ 訂正ペア抽出に使う

// 運用ログから「人ゲートで approve された ✗→○ 訂正ペア」を抽出。
// 書式: 「(A1|B1|T1 等) 初稿 `X`（任意の註釈）→ `Y`」または「(A1|B1) 初稿 `X` は ... 通過」(後者は通過扱いで approved に積む)。
// 失敗形→修正形の対を見せる方が ○ 単体より家風転写が強い (NAMING_COMMON の「実例 ✗→○」と同形式)。
function parseDistillLog(text) {
  if (!text) return { pairs: [], approved: [] }
  const pairs = [] // [{bad, good}]
  const approvedSet = new Set()
  const pairRe = /初稿\s*[`「]([^`「」]+?)[`」][^→\n]*→\s*[`「]([^`「」]+?)[`」]/g
  for (const m of text.matchAll(pairRe)) {
    const bad = m[1].trim()
    const good = m[2].trim()
    if (bad && good && bad !== good) {
      pairs.push({ bad, good })
      approvedSet.add(good)
    }
  }
  // 「初稿 `X` は ... 通過」型 (訂正なしで approve)。同一行に「→」を含む場合は pairRe が拾った訂正行なので除外
  // (✗ 側を approve に混ぜないため)。
  const passRe = /初稿\s*[`「]([^`「」]+?)[`」]([^\n]*?)(?:1\s*ラウンド)?通過/g
  for (const m of text.matchAll(passRe)) {
    const t = m[1].trim()
    const between = m[2]
    if (t && !between.includes('→')) approvedSet.add(t)
  }
  return { pairs, approved: [...approvedSet] }
}
const DISTILL_LOG_FROM_TEXT = parseDistillLog(DISTILL_LOG_TEXT)
// 事前抽出済みの pairs/approved を直接渡すこともできる (full text を args に埋め込むのを避けたい場合)。
// 配列で渡せば parseDistillLog の結果より優先する。
const DISTILL_LOG = {
  pairs: Array.isArray(input.distill_log_pairs) ? input.distill_log_pairs : DISTILL_LOG_FROM_TEXT.pairs,
  approved: Array.isArray(input.distill_log_approved) ? input.distill_log_approved : DISTILL_LOG_FROM_TEXT.approved,
}
// Obsidian 起動の有無 (タグ列挙・被リンク洗いを obsidian-cli にするか rg にするかの分岐)。起動判定は run 中で不変なので
// SKILL.md step 1 が pgrep -x Obsidian で一度だけ判定して渡す。分岐は決定論なので script がコマンド文字列を解決し、
// プロンプトには解決済みの単一コマンドだけを埋める (各 subagent に pgrep+分岐を委ねない)。未指定 (harvest 等) は false=rg/Grep。
const OBSIDIAN_AVAILABLE = !!input.obsidian_available
if (MODE === 'drain' && !INPUT_FILES.length) throw new Error('drain には input_files ([{path, content}]) が必要')
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
    old_name_referrers: { type: 'array', items: { type: 'string' }, description: '昇格でこの input 名が変わる/分割される場合、元 input 名を wikilink で指す既存ノートの path (obsidian backlinks / rg -l の結果)' },
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

// ---- 共有プロンプト断片 (判断方針の規約。機械検証可能なものは下の JS 関数が担う) ----
const VAULT_RULES = `
vault 規約 (ノート生成時に厳守):
- 置き場は ${VAULT}/pages/ 直下。専用フォルダを作らない。
- frontmatter: createdAt / updatedAt とも ${NOW} (ISO-T)。status: active。tags は 3 つ程度・大枠カテゴリのみ・日本語優先・既存タグ再利用 (新規タグは既存に該当が無い場合のみ)。
- 気づきノートは tags に 気づき。洞察ノートは tags に 洞察＋frontmatter source: に繋いだ元ノートを各行 '  - "[[ノート名]]"' で列挙。タスクノートは tags に タスク＋progress: backlog。検証済みの事実・仕様・作業レポートにはどれも付けない (トピックタグのみ)。
- 層の判別: 気づき＝作業を通じて立ち上がった主観的な学び・判断・方針。事実＝外部検証可能な客観 (特定ツールの狭いスペック)。決め手はタイトルの高度——主語をツールから一般化した教訓は気づき側。高度は 事実/仕様 → 気づき → 原理・方針 → 洞察 の順。
- 本文: H1 禁止 (H2 から)。冒頭に > [!NOTE] AI Context callout で主題を 1〜2 文。概念・元ノートへ本文 wikilink を張る。末尾に ## 更新履歴 と「- [[${TODAY}]] — <理由>」行 (journal 日付 wikilink はここに集約し本文に散らさない)。
- タスク本文: ## やること を plain な「- 」箇条書き (チェックボックス「- [ ]」禁止)。③ 由来は ## 元ノート(なぜ重要) 必須。ラベル文字 ①②③ は label field のみに書き、タスクノートのタイトル・content に残さない (タスク以外の kind が素材原文の ①②③ を引用するのは正当——回避表記に書き換えない)。
- 捏造補完しない: 元の素材から復元できる範囲に留める。素材に無い感覚・詳細を想像で埋めない。
- 突き合わせ: 明白に同一物の既出だけ既存ノードへ畳む (fold_into)。迷ったら分けて作りリンクする (失敗は重複でなく orphan。重複生成は主題が繰り返すシグナル)。
- imports/kindle/ imports/wallabag/ はリンク先に使ってよいが編集対象にしない。`

// 命名規約は kind 共通の craft（複文禁止・plain・scope・接地）と kind 固有の作法（気づき=観察を名指す／洞察=判断軸を名指す）に分割する。
// 各 prompt には共通＋当該 kind だけを注入する（無関係 kind の作法でプロンプトを膨らませない）。失敗接地: 2026-06-14 気づき・洞察を一括ポリシーにし、命名層が洞察にも失敗形を要求して rule5（判断軸）と矛盾していた。
// 失敗接地: 2026-06-14 第2弾——気づき側に失敗形を必須化していたため中立な観察（「ツールは機能でなく配布で淘汰される」型）が gate でループした。気づきは観察であって失敗事例探しではない。失敗形は default の一例に降格し、解の指示形・徳の称揚だけを外す。
const NAMING_COMMON = `
命名規約 (kind 共通の craft):
- 1 タイトル＝1 要点。plain な確立語で名指す (jargon・造語・狭い実装語・抽象的な徳を避ける)。
- 比喩・メタファー・personification で濁さない。動詞主体で何が起きるかを直接名指す。失敗例: 「ガードを指す番地は消える記憶では迷子になる」——「ガード」「番地」「迷子」「消える記憶」のような抽象語/技術メタファーの連結で何が起きるかが直接読めない型は不可。
- 偏愛語 (泥臭さ／手触り／解像度／本質／営み／文脈)・必殺技造語 (真理／虚飾／美学／境地)・横文字メタファー (思考の OS／ハック／インストール／リファクタリング) を撒かない。
- false agency を作らない: モノを主語に人間動詞をさせない (「データが示す」「文化が醸成される」型は誰が何をしたかに書き換える)。
- 主語の一般化は「具体事象から構造を抽出する一般化」のみ。「人々は」「我々は」「現代社会において」型の空虚な一般化はしない。
- 条件と結果の複文にしない。要点を 1 動詞に圧縮する (「〜すると」「〜して〜する」「Xは Y で Z する」は 2 主張の混在)。説明文型の長文にせず短い言い切りにする。
- scope は固有名詞で狭めず hedge で合わせる (「場合がある」等)。ただしツール固有のクセ・仕様は固有名詞を残す。
- 抽象は本文/リンクが事例で接地している時だけ。作業ログ・調査記録のタイトルは具体のまま据え置く (抽象化すると何を調べたか消える実害)。
- 「なぜ重要」「応用」はソフトウェア開発に転用できる形を最低 1 つ接地させる (読み手は SWE)。
タスクの命名 (別軸): 動詞主体の短句 (「〜する」「〜を確認する」) で何の行動かを言い切る。複文化しないのは共通。

共通 craft の実例 (✗→○。複文回避・plain・length・nuance の家風。抽象規則より実例を優先):
- 複文・長文を 1 要点に: 「整合を後追いの横断パスに切り出すと責務が二箇所に割れる」✗ → 「整合を後から足すと責務が割れる」○
- 手段でなく本質: 「手段で指定された依頼を額面で受けると枠組みが崩れる」✗ → 「手段で来た依頼は真の課題を隠す」○
- 硬い比喩より日常語: 「概念は軸に割ると例外が見える」✗ → 「別物を同じ名前で呼ぶと噛み合わない」○
- 説明文型の長文を短い言い切りに: 「ツール境界の引数型は呼び出し側の渡し方に依存して検証で即死する場合がある」✗ → 「境界の引数は渡し方で型が変わる」○
- 条件節を捨て 1 動詞に: 「機械検証できるものを prompt に書いたまま規約文書が肥大化する」✗ → 「コードにできる規約は文書を太らせる」○
- 連用形 2 動詞を 1 動詞に: 「決定論で済む検証を LLM 本体に負わせ対症療法の防御規約が肥大する」✗ → 「LLM 任せの検証は対症療法を積み上げる」○
- 造語・狭語を確立語に: 「対の系統」✗→「ペア」○ / 「mtime」✗→「タイムスタンプ」○ / 「ISO-T」✗→「ISO 8601」○ / 「未文書バグ」✗→「未報告のバグ」○
- scope の hedge: 「Obsidian Sync は mtime を保持しない」→ 一般現象なら「ファイル同期はタイムスタンプを保持しない場合がある」(ツール固有のクセなら固有名詞を残す)
- 語そのものに nuance を運ばせる: 「食い違う」(単にズレる) と「食い合う」(正統を奪い合う) は別物。要点の nuance を持つ語を選ぶ。${
  DISTILL_LOG.pairs.length
    ? `

運用ログ採用済みの ✗→○ ペア (過去の distill 実走で人ゲートが訂正した実例。直近 ${Math.min(15, DISTILL_LOG.pairs.length)} 件・最も家風に合致するので最優先で倣う):
${DISTILL_LOG.pairs
  .slice(-15)
  .map((p) => `- 「${p.bad}」✗ → 「${p.good}」○`)
  .join('\n')}`
    : ''
}${
  DISTILL_LOG.approved.length
    ? `

運用ログ採用済みタイトル (人ゲート approve 済み・最近 ${Math.min(20, DISTILL_LOG.approved.length)} 件):
${DISTILL_LOG.approved.slice(-20).map((t) => `- ${t}`).join('\n')}`
    : ''
}${
  STYLE_TITLES.length
    ? `

この vault の既存タイトル (確立した家風。新しいタイトルはこの並びに違和感なく混ざること・上記運用ログ採用と重複する場合は運用ログ側を優先):
${STYLE_TITLES.map((t) => `- ${t}`).join('\n')}`
    : ''
}`

const NAMING_KIZUKI = `
気づきの命名: 観察 (事実・機序・関係) を要点で言い切る。失敗形 (避けたい失敗・問題を名指す) はよく効く default だが必須ではない——失敗発でない中立な観察もそのまま名指してよい。避けるのは解の指示形 (「〜する」= 解・行動はタスクか本文へ逃がす) と中身のない徳の称揚 (これらは観察でないから外す。肯定形か失敗形かは問わない)。
実例 (✗→○・○のまま):
- 解の指示形を観察に: 「単一オーナー化が解」✗ → 「順序の決まらない同期はどの基盤でも正統を奪い合う」○
- 徳の称揚を観察に: 「誠実さは件数ノルマに優先」✗ → 「数合わせのために中身を水増ししない」○
- 中立な観察はそのまま (失敗形に変形しなくてよい): 「ツールは機能でなく配布で淘汰される」○ / 「生成は指示文より few-shot 実例に従う」○`

const NAMING_INSIGHT = `
洞察の命名: 失敗形でなく判断軸・規則を名指す (「次にどう振る舞うか／何で判断するか」)。失敗の再記述「〜と損する/間違える/死ぬ」は気づき側の作法で洞察では不可。判断軸は次を満たす: (a) source 気づきの単純合算・症状の相関の言い切り (「X も Y も決まる」等) でなく、その上に立つ第三の軸。(b) 成果物に対して観測できる規則・境界 (レビュー観点・設計制約に使える)。作者の内的手順 (「〜する前に確かめる」等・成果物に現れず自己申告に退化する) は不可。(c) 「良い◯◯は…で決まる」等の型を中身なく当てない (対象と基準の関係が芯にあること)。判断軸が要る根拠 (例: 失敗が沈黙する) はタイトルでなく本文へ。
実例 (✗→○):
- 失敗形を判断軸に: 「構造を文字列で探すと黙って間違える」✗ → 「文字列検索は構造のないデータにだけ使う」○
- 相関の言い切りを第三の軸に: 「構造解釈力で速度も精度も決まる」✗ → 「文字列検索は構造のないデータにだけ使う」○
- 既存の良い洞察に倣う: 「良い索引かは生成、参照、命名で決まる」「同じ意味のものは同じ内容でなければならない」`

const NAMING_FOR_KIZUKI = NAMING_COMMON + NAMING_KIZUKI
const NAMING_FOR_INSIGHT = NAMING_COMMON + NAMING_INSIGHT

// ---- 命名ゲート (3 層: 機械 regex → 別 context 点検 agent → 再命名ループ) ----
const FUKUBUN = /、|すると|したら|つつ|（|\(/g
function regexHits(title) {
  return title.match(FUKUBUN) || []
}

function checkerPrompt(kind, title, excerpt) {
  const taskCriteria = `- 動詞主体の短句か (「〜する」「〜化する」「〜を確認する」)。
- 複文化していないか (条件節・並列。連用形「〜して」の 2 動詞構造、主述 1 文の条件結果型「Xは Y で Z する」もすり抜け対象として見る)。`
  const noteCriteria = `① 観察を名指しているか: タイトル本体は観察 (事実・機序・関係) を据える——失敗形でも中立な事実形でもよい (失敗形は必須でない・肯定形そのものは違反でない)。違反は解の指示形「〜する」(解・行動はタスクか本文へ) と中身のない徳の称揚だけ (これらは観察でない)。
② 平易な日常語で、メタファー連結になっていないか: jargon・英語混入・造語・狭い実装語が無いこと、および比喩/メタファー/personification の連結で抽象語が並んでいないか (vault で確立した技術術語は許容)。失敗例「ガードを指す番地は消える記憶では迷子になる」型——「ガード」「番地」「迷子」「消える記憶」のような抽象語/技術メタファーの連結で何が起きるかが直接読めない型は違反。偏愛語 (泥臭さ／手触り／解像度／本質／営み／文脈)・必殺技造語 (真理／虚飾／美学／境地)・横文字メタファー (思考の OS／ハック／インストール／リファクタリング) も違反。
③ 不自然な動詞-目的語結合が無いか: 圧縮で生じる不自然結合 (「過剰を取り込む」等) は元記述の意味を消すシグナル。
④ 元記述の単純な圧縮になっていないか: 述語・名詞の順序入替・短縮だけで語彙構成が変わっていなければ要点が抽出されていない。
⑤ 条件結果の 2 動詞構造になっていないか: 連用形「〜して〜する」、主述 1 文の条件結果型。要点を 1 動詞に圧縮できるかで判定する (できなければ 2 主張の混在＝複文)。
⑥ false agency になっていないか: モノを主語に人間動詞をさせる型 (「データが示す」「文化が醸成される」等) は違反——誰が何をしたかに書き換える対象。
⑦ 主語の空虚な一般化になっていないか: 「人々は」「我々は」「現代社会において」型の空虚な一般化は違反 (具体事象から構造を抽出する一般化は OK)。`
  // 洞察は気づきと作法が違う: 判断軸を名指す (失敗形は不可)。気づきは観察 (失敗形/中立どちらも可) なので noteCriteria① とは別基準にする (失敗接地: 2026-06-14 洞察タイトルを失敗形/相関/型空当てで 4 回外した)
  const insightCriteria = `① 判断軸を名指しているか: 「次にどう振る舞うか／何で判断するか」の規則・観点になっているか。失敗の再記述 (「〜と損する/間違える/死ぬ」等の失敗形) は気づき側の作法で、洞察では不可 (失敗形=該当)。
② 平易な日常語で、メタファー連結になっていないか: jargon・英語混入・造語・狭い実装語が無いこと、および比喩/メタファー/personification の連結で抽象語が並んでいないか (vault で確立した技術術語は許容)。失敗例「ガードを指す番地は消える記憶では迷子になる」型——「ガード」「番地」「迷子」「消える記憶」のような抽象語/技術メタファーの連結で何が起きるかが直接読めない型は違反。偏愛語 (泥臭さ／手触り／解像度／本質／営み／文脈)・必殺技造語 (真理／虚飾／美学／境地)・横文字メタファー (思考の OS／ハック／インストール／リファクタリング) も違反。
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
${kind === 'タスク' ? taskCriteria : kind === '洞察' ? insightCriteria : noteCriteria}

verdict: 違反あり=該当 / 違反なし=非該当 / 元記述が薄く判定できない=判断不能 (note に理由を 1 行)。`
}

function renamePrompt(kind, title, excerpt, issues) {
  return `あなたはタイトルの再命名担当。以下の指摘を解消する新しいタイトルを 1 つだけ返せ。ツールは使わない。

種別: ${kind}
現タイトル: ${title}
元記述: ${excerpt || '(なし)'}
指摘: ${issues}
${kind === '洞察' ? NAMING_FOR_INSIGHT : kind === 'タスク' ? NAMING_COMMON : NAMING_FOR_KIZUKI}
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
function drainExtractPrompt(f) {
  // 被リンク洗いコマンドは script が決定論で解決する (起動判定は SKILL.md step 1 が渡した flag)。agent は実行のみ。
  const backlinkCmd = OBSIDIAN_AVAILABLE
    ? 'obsidian backlinks file=<元 input 名 (拡張子なし)> (実リンクグラフを解決するので alias・heading リンクも拾う)'
    : `rg -l '\\[\\[<元 input 名 (拡張子なし)>\\]\\]' ${VAULT}`
  return `あなたは vault inbox 排出 (drain) の昇格担当。以下の input ノート 1 件を読み、pages/ へ昇格させる候補を構造化して返せ。ファイルへの書き込みは一切しない (Read/Grep/Glob のみ。Write は呼び出し元の責務)。

vault: ${VAULT}
input ノート: ${f.path}
--- 内容ここから ---
${f.content}
--- 内容ここまで ---

手順:
1. この input の内容を「名付けられる粒度」で昇格候補に分ける (1 input から複数可)。作業レポート・調査記録はそれ自体を 1:1・具体タイトルのまま kind=作業レポート・事実 として昇格する。ただし 1:1 で終わらせず、下記「気づき抽出」を必ず併走させる (1 input が 作業レポート＋気づき＋タスク を同時に生むのは正常)。
2. 各候補について vault 既存ノードを突き合わせ、関連ノート・既出を洗う。一次索引は、あなたの context に読み込まれている「Vault Catalog」(pages/ の機械生成索引＝各行 'title · layer · #tags · →[outlinks]')。タイトル一致・タグ共有・リンク近傍で当たりを付け、fold 判定や本文確認が要るものだけ Read する (全 pages の Grep fan-out はしない)。カタログに該当が無ければ新しい主題＝新規候補。カタログが context に無い場合に限り Grep で代替する (MOC/ は Dataview 集約でカタログに出ないので必要時のみ別途 Read)。
3. 新規候補は content に frontmatter＋本文の完成形を書く。関連既存ノード側からの逆リンク 1 行を backlink_edits に列挙する (双方向リンク。関連が実在するものだけ・弱い繋がりを強引に張らない)。
4. この input のファイル名が昇格で変わる/分割される場合、元 input 名を wikilink で指す既存ノートを ${backlinkCmd} で機械的に洗い old_name_referrers に返す (path のリスト。0 ヒットなら空配列。同名昇格なら洗わなくてよい)。

気づき抽出 (作業レポートでも必ず行う): input が作業レポート・調査記録であっても、その作業を通じて立ち上がった主観的な学び・判断・方針・再発パターン・踏んだ罠の教訓が本文にあれば、作業レポート本体の 1:1 昇格とは別に kind=気づき の独立ノードとして切り出す。「作業レポートだから 1:1 で終わり」にしない——層は 作業 (レポート) → 気づき で分けるのであって、作業レポートが気づきの抽出元にならないわけではない (作業レポートは洞察の source になれないだけ)。対象は主語をツール固有から一般化できる教訓 (特定ツールの狭いスペック・手順そのものの記述は事実なので切り出さない)。素材に書かれた学びだけを根拠にし、無い学びを想像で足さない (捏造禁止・本当に学びが無ければ 0 件が正当)。作業レポート本体には気づきタグを付けず洞察 source にもしない。切り出した気づきが後段で洞察の素材になりうる。
タスク抽出: input 中の未着手の行動を kind=タスク で抽出する。ラベルは ① 明示 TODO (「TODO」「未実施」「やる」等が plain にある) / ② 次タスク候補 (「次は〜」等の先送り表明) / ③ ノート分析で出た課題 (論理ギャップ・矛盾・未解決。why_important 必須)。
洞察はここで作らない (後段の専用 agent が担う)。
${VAULT_RULES}
${NAMING_FOR_KIZUKI}`
}

function backfillPrompt() {
  return `あなたは backfill (過去期間の遡り蒸留) の素材収集担当。ファイルへの書き込みは一切しない (Read/Grep/Glob のみ)。

vault: ${VAULT}
対象期間: ${PERIOD.from} 〜 ${PERIOD.to}

手順:
1. pages/ の frontmatter createdAt が期間内のノートを Grep で洗い、period_pages に path / 1 行要旨 (gist) / frontmatter tags の全要素 (tags) / 本文の逐語 (body) を返す (createdAt を正とする。filesystem の時刻は使わない——mv で birthtime がずれる)。body は done sweep の証拠照合の母体になるので要約・truncate せず原文全文を返す (長大でも省略しない。完了記述が truncate されると後段 done 判定の引用が照合に落ちる)。
2. 期間内の journals/<YYYY-MM-DD>.md の「## 作業メモ」に手書き記述があれば journal_notes に抜粋を返す (空の日も多い。空を想像で埋めない)。
3. タスク抽出は ① 明示 TODO のみ (ノート本文に TODO/未実施/やる 等が plain にある未着手記述)。②③ は抽出しない (過去日の感覚を想像で埋める捏造リスク。schema 上も ① しか表現できない)。

気づき(A) の新規ノード化はこのモードでは行わない (会話文脈が無く捏造になる)。過去 journal を埋めることもしない。done 判定はこの agent では行わない (後段の専用 done agent が period_pages の body を素材に証拠ベースで判定する)。
${VAULT_RULES}
${NAMING_COMMON}`
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
1. 繋がりを探す対象は (a) 今回の新規ノード同士 (上記「今回の新規/更新ノード」の #気づき/#洞察 を束ねる)、(b) 新規ノードと既存ノート (pages/ の #気づき #洞察・概念ノート) の両方。同じバッチで立った新規 #気づき も source 候補に含めてよい——特に drain は 1 input から複数の気づきが同時に立つので、それらを束ねた洞察がこのフェーズの主な取り分になる (新規気づきはまだファイル化されていないが、承認後に pages/ に作られる前提で source 候補にしてよい)。入口は、context に読み込まれた「Vault Catalog」のリンク近傍 (各ノード行の →[outlinks]) と同タグ共有 (#気づき/#洞察 を持つ行)。カタログで近傍を絞ってから、繋がりの確証に要るノートだけ Read する。カタログは実 wikilink/タグしか持たないので、MOC/洞察.md (Dataview 集約) は別途 Read で入口に使える。カタログが context に無い場合に限り Grep で代替する。
2. 単一観測・単一ノートの感想は洞察ではない (それは気づき止まり)。繋いで初めて見える第三の知見だけ。既出洞察の焼き直しも作らない。「過去の洞察と同じ筋」の再発はそれ自体が再発パターンの洞察になりうる。
3. 各候補: claim に洞察を一文で言い切る (複文可)。**title は claim からでなく、手順 5(3) で導く derivation.common_axis を判断軸の形で言い切ったものにする** (claim 起点は失敗形/内的手順に流れ命名ゲートを通らない——common_axis を先に確定させてから命名する。順序: derivation→common_axis→命名)。connected_notes に繋いだ実在ノートの path (実在を Read で確認する)。content は templates/insight.md の構造 (AI Context callout / ## 見えた洞察 / ## なぜ重要 / ## 応用・次アクション) で frontmatter＋本文の完成形。source: に繋いだ元ノートを '  - "[[ノート名]]"' 形式で列挙。
4. source の規律 (満たせない候補は出さない):
   - 洞察は複数 (2 件以上) の #気づき / #洞察 ノードから生まれる。単一ノート由来は洞察ではない (気づき止まり)。source に列挙できるのは #気づき / #洞察 ノードだけで、タスク・作業レポート・事実/仕様ノートは source にしない (それらを本文 wikilink や connected_notes で参照するのは可)。**同じバッチの新規 #気づき / #洞察 もこの「#気づき / #洞察 ノード」に含む**——source: には wikilink (\`[[タイトル]]\`) で、connected_notes には承認後の path (\`pages/<タイトル>.md\`) で列挙する。この新規分だけは Read 実在確認を免除する (newNotesList に在ることが実在の代わり。既存ノートは従来どおり Read で実在確認)。
   - 新しい洞察は source のどのノートよりも上位の抽象度・概念でなければならない (再発パターンを名指す・複数機序を束ねる等)。これは source に #洞察 を含む場合に限らない——source が #気づき のみでも同じで、気づきを束ねた結果が source の 1 つと同位なら洞察ではない。同位・下位の言い換えは source でなく本文リンクで繋ぐ。「リンクでなく source に置く」＝「その元ノートを一段上から束ねた」という主張になる。
   - 単一 source 充足テスト (失格判定): source のどれか 1 件**単独**で claim が言い切れてしまうなら、それは束ねでなくその 1 件の言い換え＝洞察として出さない (その気づき/洞察ノートに留める)。【注意】source 間に重複・近接があっても束ねる価値はある——冗長な source を 1 つ抜いても claim が残ること自体は失格ではない。失格は「1 件だけで全部言える」ケースに限る。
   - 同バッチ重複ガード: 今回の新規ノード一覧 (上記「今回の新規/更新ノート」) に出ている #気づき の 1 件と claim が同義になる洞察は出さない。同じバッチで気づきと洞察が同じことを言うなら、気づきを残して洞察は出さない (特に drain は 1 input 内の単発昇格で束ねの母数が足りないことが多い)。
   - ただし抽象を上げた分、本文の「なぜ重要」「応用」で具体事例に接地させること。元ノートの具体から離れて一般論・空論になった候補は出さない。
5. 【洞察生成の核・最重要】失敗事例を「二度と失敗しないための判断軸」に変換する。これが洞察の本質であり、失敗の再記述・原因論の一般化・1 つの軸への言い換えで終えてはならない。やり方:
   - (1) 束ねる複数の失敗気づきが、より上位の同一カテゴリの「異なる側面」として括れないか探す (例: 生成・参照・命名 という 3 つの索引失敗は「索引の外側の境界条件」の 3 側面)。この共通カテゴリを名指すのが第三知見であって、条件の並置 (チェックリスト) でも 1 軸への collapse (言い換え) でもない。
   - (2) 括れた共通カテゴリを「次に何を確認するか／どこに投資するか」の行動可能な判断軸に変換する (例: 索引が効かないとき索引エンジンでなく 3 境界のどれが律速かを切り分ける)。claim は失敗の説明でなく次の行動を指す一文にする。
   - (3) 【毎回必須・全候補で実施し derivation に記録する。行き詰まり時だけでない】導出チェックリスト: ①各 source 気づきの失敗の回避法を 1 つずつ書く (source と同数・2 件以上＝derivation.source_avoidances) → ②回避法の共通点を書く (derivation.common_point) → ③共通点から共通の対処/確認 (1 つの事前判断 or 1 つのレビュー観点＝derivation.common_axis) を書く。③が出れば洞察・出ず合算止まりなら洞察にしない。title は derivation.common_axis を判断軸の形で言い切ったものにする (命名規約は別途注入。失敗接地: 2026-06-14 速度/精度 2 気づきを症状の相関で言い換えて空回り→この分解で「答えが構造にある問いに走査を当てた一機序の二症状」と判明)。
   - 直近の具体例 (vault に実在・余裕があれば Read して倣う): [[良い索引かは生成、参照、命名で決まる]] (生成/参照/命名 の 3 失敗を「索引の外側の境界条件」に括り、投資先の判断軸に変換)。[[同じ意味のものは同じ内容でなければならない]] (drift/残留/分割/並走 の 4 失敗を「同じ意味を担う実体は他に無いか・内容は一致しているか」というレビュー観点に変換)。
   - 【手本の使い方】この具体例・insight.md・既存洞察ノートから倣うのは畳み方/トーン/体裁であって主張内容ではない。手本の主張をなぞって似た洞察を作るな——内容は上記 source 規律 (4) に従い目の前の素材から立てる。
6. なぜ重要・応用にはソフトウェア開発に転用できる接地を最低 1 つ入れる (読み手は SWE)。

繋がりが弱ければ 0 件が正当な出力 (「A 止まりですらない」もありうる)。無理に B をでっち上げない。
${VAULT_RULES}
${NAMING_FOR_INSIGHT}`
}

function donePrompt(corpus) {
  // タグ列挙コマンドと progress 判定手段は script が決定論で解決する (起動判定は呼び出し側が渡した flag)。agent は実行のみ。
  const taskListing = OBSIDIAN_AVAILABLE
    ? 'obsidian tag name=タスク の ^pages/ 行で tags に タスク を含むノートを洗い (実タグ索引で速く・過剰一致しない)'
    : 'pages/ を Grep して tags に タスク を含むノートを洗い'
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
log(`mode=${MODE} / 素材: ${MODE === 'drain' ? INPUT_FILES.length + ' input files' : `${PERIOD.from}〜${PERIOD.to}`}`)

let candidates = []
let linkRewrites = []
let backfillMaterial = null
let corpus = '' // done 検出の証拠照合用テキスト (script が手元に持つ素材だけが照合対象)
const flags = { extraction_failed: [], insight_failed: false, done_failed: false, done_skipped_no_reports: false }

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
} else {
  // backfill: 期間素材を収集し、done sweep の corpus を作業レポート系ノート本文から script が組む
  const r = await agent(backfillPrompt(), { schema: BACKFILL_SCHEMA, model: M_EXTRACT, label: 'backfill-collect', phase: '素材整理' })
  if (!r) throw new Error('backfill 素材収集 agent が結果を返さなかった')
  const periodPages = r.period_pages || []
  backfillMaterial = { period_pages: periodPages, journal_notes: r.journal_notes }
  // done sweep の corpus: 作業レポート系ノート (気づき/洞察/タスク タグを持たない無印) の本文だけを
  // script が決定論フィルタで組む (LLM に「どれが作業レポートか」を委ねない)。証跡は揮発しない期間内 pages 本文。
  const reportPages = periodPages.filter((p) => !(p.tags || []).some((t) => LAYER_TAGS.includes(t)))
  corpus = reportPages.map((p) => `===== ${p.path} =====\n${p.body || ''}`).join('\n')
  // backfill の主眼は done reconcile。作業レポート系ノートが期間内に 0 件だと corpus 空で done-scan が走れない。
  // 「走査して 0 件」と「対象ゼロで走らせていない」を戻りで区別するため明示フラグを立てる (decision: 決定論の件数判定)。
  if (reportPages.length === 0) flags.done_skipped_no_reports = true
  // schema enum (['①']) で ②③ は表現不能だが、script 側でも二重に防御する
  candidates = r.candidates.filter((c) => c.kind !== 'タスク' || c.label === '①')
  await parallel(candidates.filter(needsGate).map((c) => () => runGate(c)))
  log(`done sweep corpus: 作業レポート系 ${reportPages.length} 件 / 期間内 pages ${periodPages.length} 件`)
  if (flags.done_skipped_no_reports) log('期間内に作業レポート系ノート (無印) が無く done sweep をスキップ (reconcile 対象ゼロ)')
}
log(`素材整理: 候補 ${candidates.length} 件 (うち fold ${candidates.filter((c) => c.fold_into).length})`)

// ============================================================
phase('洞察検出')
const nonTask = candidates.filter((c) => c.kind !== 'タスク')
const newNotesList = nonTask
  .map((c) => `- [${c.kind}] ${c.title}${c.fold_into ? ` (→ ${c.fold_into} へ畳む)` : ''}`)
  .join('\n')
let extraMaterial = ''
if (MODE === 'drain') extraMaterial = `昇格元 input の内容 (素材):\n${corpus}`
if (MODE === 'backfill') {
  // body 全量は注入しない (done sweep の証跡照合は corpus 側が full body で担うので insight に body は不要)。
  // period_pages を {path, gist} に絞った軽量版＋journal_notes だけ渡す (広期間でのトークン肥大を避ける)。
  const lightMaterial = {
    period_pages: (backfillMaterial.period_pages || []).map((p) => ({ path: p.path, gist: p.gist })),
    journal_notes: backfillMaterial.journal_notes,
  }
  extraMaterial = `期間素材 (path と 1 行要旨の一覧。これを入口に Grep/Read で本文を辿る):\n${JSON.stringify(lightMaterial, null, 2)}`
}

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

// ============================================================
phase('タスク・完了検出')
let doneCandidates = []
// drain は input 連結・backfill は期間内作業レポート本文が corpus。corpus が空なら done sweep をスキップ (証拠ゼロ)。
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
  const swapRefs = (s) => {
    if (!s) return s
    for (const { from, to } of renamePairs) {
      s = s.split(`[[${from}]]`).join(`[[${to}]]`) // wikilink (本文・source frontmatter・add_line)
      s = s.split(`${from}.md`).join(`${to}.md`) // ファイルパス (backlink_edits.path・connected_notes)
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
  done_candidates: doneCandidates.length,
}
log(
  `集計: ${totals.count} 候補 (気づき ${totals.kizuki} / 洞察 ${totals.insights} / タスク ${totals.tasks} / レポート・事実 ${totals.reports} / fold ${totals.folds}) 再命名 ${totals.renamed} / ゲート未解決 ${totals.gate_unresolved} / 検証落ち ${totals.validation_failed} / 洞察導出未完 ${totals.insights_derivation_incomplete}`,
)

return {
  mode: MODE,
  candidates,
  link_rewrites: linkRewrites,
  done_candidates: doneCandidates,
  totals,
  flags,
}
