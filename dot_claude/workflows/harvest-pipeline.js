export const meta = {
  name: 'harvest-pipeline',
  description: 'drain (即時 ingestion)・backfill (期間 reconciliation) の 2 層蒸留パイプライン: 素材整理 (既存突き合わせ・候補生成・命名ゲート inline)→洞察検出→タスク・done 検出。件数・ゲート判定・モード封鎖・規約検証は script がコードで実行し、自己申告に依存しない',
  whenToUse: 'drain / harvest スキル本体 (SKILL.md) から scriptPath 指定で起動される。単体起動は想定しない',
  phases: [
    { title: '素材整理', detail: 'inbox 昇格候補 (drain=sonnet・done 候補検出も併合) / 期間素材 (backfill=opus) の構造化と既存ノード突き合わせ。命名ゲート (機械 regex → 別 context 点検 agent → 再命名 → 再点検・最大 2 ラウンド) も素材整理 phase 内インラインで走る' },
    { title: '洞察検出', detail: 'ノード間の繋がりから第三の知見を検出 (opus・0 件は正当・backfill は蓄積グラフの創発/メタ洞察が主眼)。drain では各候補の source_excerpt 直結の lightMaterial を渡す (corpus 全文注入は廃止)' },
    { title: 'タスク・完了検出', detail: '既存タスクの done 候補検出。drain では素材整理段で併合済み (donePrompt 呼び出しは廃止・引用は集約段で script が包含照合)。backfill は期間内作業レポート本文を corpus に donePrompt を走らせる' },
    { title: '集計', detail: 'ノート規約の機械検証 (frontmatter/更新履歴/ラベル残存/タグ整合) と totals 計算。DUPLICATE_DETECTED (done と promotions の inbox_origin 衝突) と INSIGHT_ZERO のログも出す' },
  ],
}

// args interface:
//   共通: mode ('drain'|'backfill') / vault (絶対パス) / now (ISO-T) / today (YYYY-MM-DD)
//   drain:
//     inbox_files: [{path, content?}] 必須 — path のみが主流路。content 省略時は subagent が Read tool で取得 (main 占有トークン削減)。
//     open_tasks: [{path, title}] 必須 — 既存タスクノート一覧。drain 抽出 subagent が done 候補検出のために突き合わせる素材。
//     obsidian_available: boolean — 被リンク洗いコマンド分岐
//   backfill:
//     period: {from, to} 必須

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
const INBOX_FILES = input.inbox_files || [] // drain: [{path}] が主流路。content は省略可 (drain 抽出 subagent が Read tool で本文を取る)。
// 後方互換として content 同梱もサポート (subagent 側で Read をスキップ)。v6 plan で main 占有トークンを削減するため。
const OPEN_TASKS = input.open_tasks // drain: [{path, title}] — 既存タスクノート一覧。drain 抽出 subagent が done 候補検出のために突き合わせる素材。drain 必須で || [] の既定値は取らない (validation 不発を防ぐため)
const PERIOD = input.period || null // backfill: {from, to}

// Obsidian 起動の有無 (タグ列挙・被リンク洗いを obsidian-cli にするか rg にするかの分岐)。起動判定は run 中で不変なので
// SKILL.md step 1 が pgrep -x Obsidian で一度だけ判定して渡す。分岐は決定論なので script がコマンド文字列を解決し、
// プロンプトには解決済みの単一コマンドだけを埋める (各 subagent に pgrep+分岐を委ねない)。未指定 (harvest 等) は false=rg/Grep。
const OBSIDIAN_AVAILABLE = !!input.obsidian_available
if (MODE === 'drain' && !INBOX_FILES.length) throw new Error('drain には inbox_files ([{path}] が主流路・content は省略可) が必要')
if (MODE === 'drain' && !Array.isArray(OPEN_TASKS)) throw new Error('drain には open_tasks ([{path, title}]) が必要 (string/null/undefined は不可・空配列は可)')
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

function candidateItem(kinds, { withInboxOrigin = false } = {}) {
  const required = ['kind', 'label', 'title', 'content', 'fold_into', 'source_excerpt', 'why_important', 'backlink_edits']
  const properties = {
    kind: { enum: kinds },
    label: { enum: ['none', ...TASK_LABELS], description: 'kind=タスク のとき抽出ラベル。それ以外は none' },
    title: { type: 'string', description: 'ノートのファイル名になるタイトル (拡張子なし)' },
    content: { type: 'string', description: 'frontmatter＋本文の完成形。fold_into 指定時は空文字' },
    fold_into: { type: 'string', description: '明白に同一物の既出を既存ノートへ畳む場合のみその path。新規なら空文字 (迷ったら分けて作りリンクする)' },
    source_excerpt: { type: 'string', description: 'タイトルの元になった素材の逐語抜粋 (命名点検の元記述)' },
    why_important: { type: 'string', description: 'タスク③は必須。それ以外は空文字可' },
    backlink_edits: { type: 'array', items: BACKLINK_EDIT, description: '関連既存ノード側からの逆リンク追記 (双方向リンク)。fold 時は畳み先への追記' },
    derivation: {
      type: 'object',
      description: '気づき向けの導出 (洞察 derivation 同型・気づき以外は空。kind=気づき のときだけ prompt と script が必須化する)',
      properties: {
        source_observations: { type: 'array', items: { type: 'string' }, description: '観察した個別事象の逐語抜粋 (1 件以上・複数文の逐語可)' },
        pattern_generalization: { type: 'string', description: '観察した個別事象から事象に固有でない pattern (繰り返し見える構造・固有名詞を抜いた骨格) を 1 文で抽出した中間段。固有名詞・特定ツール・特定文脈の語を一般語に置換した形で書く。lesson_axis (次にどう振る舞うか) の前段で、subagent の抽象化過程を出力に残すための段' },
        lesson_axis: { type: 'string', description: '一段上の機序/教訓を 1 文で言い切ったもの。タイトルの土台になる教訓軸 (洞察の common_axis 同型の役割)' },
        generalization_check: { type: 'string', description: '主語を固有名詞でない一般語に置換できるか／複数文脈に転用可能かの自己検証文言 (1 文)' },
      },
    },
  }
  if (withInboxOrigin) {
    required.push('inbox_origin')
    properties.inbox_origin = { type: 'string', description: 'この候補がどの inbox から来たか (集約段で done_candidates との重複検出に使う照合キー。drain の場合は drainExtractPrompt が処理中の inbox path を埋める)' }
  }
  return { type: 'object', required, properties }
}

const EXTRACT_SCHEMA = {
  type: 'object',
  required: ['promotions', 'old_name_referrers', 'done_candidates'],
  properties: {
    // drain 抽出 subagent に done 検出を併合 (v6 plan・全体最適優先)。promotions 側にも inbox_origin 照合キーを持たせ、
    // 集約段で done_candidates と promotions の同 inbox_origin 重複を DUPLICATE_DETECTED として検出する (prompt 内 order 強制
    // と排他指示のフェイルセーフ)。
    promotions: { type: 'array', items: candidateItem(['気づき', 'タスク', '作業レポート・事実'], { withInboxOrigin: true }) },
    old_name_referrers: { type: 'array', items: { type: 'string' }, description: '昇格でこの inbox 名が変わる/分割される場合、元 inbox 名を wikilink で指す既存ノートの path (obsidian backlinks / rg -l の結果)' },
    done_candidates: {
      type: 'array',
      description: '既存タスクノートのうち、この inbox の本文に完了示唆が読み取れるもの。0 件が正当 (推測で done 候補にしない)',
      items: {
        type: 'object',
        required: ['task_path', 'evidence_quote', 'basis', 'quote_verified', 'inbox_origin'],
        properties: {
          task_path: { type: 'string', description: '既存タスクノートの path (open_tasks から)' },
          evidence_quote: { type: 'string', description: 'inbox 本文中の完了示唆の逐語引用 (集約段で script が包含照合する)' },
          basis: { type: 'string', description: 'やることのどの項目が満たされたかの説明' },
          quote_verified: { type: 'boolean', description: 'subagent が自分の context 内で evidence_quote が inbox 本文に包含されることを確認した真偽 (集約段でも script が再照合する)' },
          inbox_origin: { type: 'string', description: 'この done 候補がどの inbox から来たか (drainExtractPrompt が処理中の inbox path を埋める。集約段の DUPLICATE_DETECTED 照合キー)' },
        },
      },
    },
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
- 置き場は ${VAULT}/notes/ 直下。専用フォルダを作らない。
- frontmatter: createdAt / updatedAt とも ${NOW} (ISO-T)。status: active。tags は 3 つ程度・日本語優先・既存タグ再利用。
- 気づきは tags に 気づき。洞察は tags に 洞察＋frontmatter source: で繋いだ元ノートを '  - "[[ノート名]]"' で列挙。タスクは tags に タスク＋progress: backlog。事実・作業レポートはトピックタグのみ。
- 層: 事実/仕様 → 気づき (主観的学び) → 原理・方針 → 洞察 (繋いで見える第三知見)。主語の高度で判別する。
- 本文: H1 禁止 (H2 から)。冒頭に > [!NOTE] AI Context callout で主題を 1〜2 文。本文 wikilink を張る。末尾に ## 更新履歴 と「- [[${TODAY}]] — <理由>」(journal 日付 wikilink はここに集約)。
- タスク本文: ## やること を「- 」箇条書き (チェックボックス禁止)。③ 由来は ## 元ノート(なぜ重要) 必須。ラベル文字 ①②③ は label field のみ。
- 突き合わせ: 明白に同一物だけ fold_into。迷ったら分けて作りリンクする。
- 捏造補完しない: 素材に無い感覚・詳細を想像で埋めない。
- imports/kindle/ imports/wallabag/ はリンク先のみ (編集対象にしない)。`

// 命名規約は kind 共通の核と kind 固有の作法（気づき=観察を名指す／洞察=判断軸を名指す）に分割する。
// 各 prompt には共通＋当該 kind だけを注入する（無関係 kind の作法でプロンプトを膨らませない）。
const NAMING_COMMON = `
命名規約 (kind 共通の核):
- 1 タイトル＝1 要点。動詞主体で短い言い切り。
- 複文にしない (「〜すると〜」「〜して〜」「Xは Y で Z する」は 2 主張の混在)。
- モノを主語に人間動詞を当てない (false agency 禁止)。
- 解の指示形「〜する」(行動はタスクへ) と空虚な徳の称揚を避ける。
- 比喩・メタファー・造語・狭い実装語・偏愛語を撒かない。日常語で名指す。
- scope は固有名詞で狭めず hedge で合わせる (「場合がある」等)。ただしツール固有のクセは固有名詞を残す。

タスクの命名 (別軸): 動詞主体の短句 (「〜する」「〜化する」「〜を確認する」) で何の行動かを言い切る。複文化しないのは共通。

参考実例 (1 つだけ): 「機械検証できるものを prompt に書いたまま規約文書が肥大化する」✗ → 「コードにできる規約は文書を太らせる」○`

const NAMING_KIZUKI = `
気づきの命名: 観察 (事実・機序・関係) を据える。失敗形でも中立な事実形でもよい (失敗形は必須でない)。避けるのは解の指示形 (「〜する」= 行動はタスクへ) と中身のない徳の称揚 (観察でないから外す)。`

const NAMING_INSIGHT = `
洞察の命名: 失敗の再記述でなく判断軸・規則を名指す (「次にどう振る舞うか／何で判断するか」)。失敗形は不可。判断軸は (a) source 気づきの単純合算・症状の相関でない第三の軸、(b) 成果物に対して観測できる規則 (レビュー観点・設計制約に使える) を満たす。

参考実例: 「構造を文字列で探すと黙って間違える」✗ (失敗形) → 「文字列検索は構造のないデータにだけ使う」○ (判断軸)`

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
// drain 抽出 subagent は責務を「気づき／作業レポート／タスク候補／done 候補」の 4 系統に集約する (v6 plan 併合案・全体最適)。
// 後段の donePrompt(corpus) 呼び出しは drain mode のみ廃止 (backfill mode は残す)。inbox 本文は呼び出し側が Read 済み content
// を渡してきた場合はそれを使い、そうでなければ subagent が Read tool で取得する (main 占有トークン削減のため content 省略を主流路に)。
function drainExtractPrompt(f, openTasksList) {
  // 被リンク洗いコマンドは script が決定論で解決する (起動判定は SKILL.md step 1 が渡した flag)。agent は実行のみ。
  const backlinkCmd = OBSIDIAN_AVAILABLE
    ? 'obsidian backlinks file=<元 inbox 名 (拡張子なし)> (実リンクグラフを解決するので alias・heading リンクも拾う)'
    : `rg -l '\\[\\[<元 inbox 名 (拡張子なし)>\\]\\]' ${VAULT}`
  const hasContent = !!(f.content && f.content.length)
  const bodySection = hasContent
    ? `--- 内容ここから ---\n${f.content}\n--- 内容ここまで ---`
    : `本文取得: Read tool で \`${f.path}\` を開き、本文を加工せず subagent context 内で扱う。**読んだ全文を戻り値に再掲しない** (集約段が肥大化する。逐語が要るのは source_excerpt と done 候補の evidence_quote だけ)。`
  const openTasksSection = (openTasksList && openTasksList.length)
    ? `既存タスクノート一覧 (done 候補検出の突き合わせ素材。これ以外を done 候補にしない):\n${openTasksList.map((t) => `- ${t.path}${t.title ? ` — ${t.title}` : ''}`).join('\n')}`
    : '既存タスクノート一覧: (なし。done 候補は 0 件のまま返す)'
  return `あなたは vault inbox 排出 (drain) の昇格担当。以下の inbox ノート 1 件を読み、notes/ へ昇格させる候補と完了 (done) 候補を構造化して返せ。ファイルへの書き込みは一切しない (Read/Grep/Glob のみ。Write は呼び出し元の責務)。

vault: ${VAULT}
inbox ノート: ${f.path}
${bodySection}

${openTasksSection}

**責務の順序強制と排他**:
- まず **done 検出**: Read した inbox 本文と上の既存タスクノート一覧を突き合わせ、完了示唆 (「X 完了」「やった」「実装した」「やることが満たされた」等が plain に読める) のあるタスクを done_candidates に返す。evidence_quote は **inbox 本文中の逐語引用** (要約・言い換えは集約段の包含照合に落ちる)。basis は「やることのどの項目が満たされたか」の説明。quote_verified は **subagent 自身が evidence_quote の inbox 本文への包含を確認した真偽** (true なら集約段の再照合も通る前提・false なら確認に落ちた)。inbox_origin は処理中の inbox path = \`${f.path}\` を埋める。
- **残り**で気づき/タスク候補/作業レポートを組み立てる: done 検出で拾った既存タスクの完了示唆は **気づき/タスク候補に含めない**。それ以外の素材から promotions を組み立てる。
- **排他指示**: 同じ記述を done_candidates と promotions の両方に出さない。done 候補に該当する記述は done_candidates にだけ出す (集約段で同じ inbox_origin から両者が出ると DUPLICATE_DETECTED が立つ)。
- promotions の各候補に inbox_origin = \`${f.path}\` を埋める (集約段の重複検出と洞察検出 lightMaterial の照合キー)。

手順:
1. この inbox の内容を「名付けられる粒度」で昇格候補に分ける (1 inbox から複数可)。作業レポート・調査記録はそれ自体を 1:1・具体タイトルのまま kind=作業レポート・事実 として昇格する。ただし 1:1 で終わらせず、下記「気づき抽出」を必ず併走させる (1 inbox が 作業レポート＋気づき＋タスク を同時に生むのは正常)。
2. 各候補について vault 既存ノードを突き合わせ、関連ノート・既出を洗う。一次索引は MCP tool 経由で動的に引く (常時ロードのカタログは持たない・subagent には届かない)。
   - タイトル一致・意味近傍: \`mcp__vault-catalog__search_hybrid(query=候補タイトル, limit=5)\` を呼ぶ。返る hits の path/title/tags/body_snippet を見て当たりを付ける。
   - タグ共有での当たり付け: inbox 本文中に既存の #タグ 表記や明示的なタグキーワード (例: 「気づき」「洞察」「タスク」や個別ジャンルの確立タグ) が読み取れる場合に限り、それらを引数に \`mcp__vault-catalog__search_by_tag(tags=[<読み取ったタグ列>], limit=10)\` を呼ぶ。inbox 本文にタグの手掛かりが無ければこの step を飛ばす (この時点で候補の最終タグ列は未確定なので候補のタグ列を引数にしない)。
   - fold 判定や本文確認が要るものだけ Read する (全 notes の Grep fan-out はしない)。MOC/ は Dataview 集約で MCP に乗らないため、必要時のみ別途 Read する。
   - **MCP 結果は近傍候補であって fold 判定の根拠ではない**。fold を判断するなら必ず本文を Read して同一物であることを確認する (MCP の曖昧 hit を fold 根拠に取り違えない)。
   - MCP 該当が無く Read でも既存に該当が見つからなければ新しい主題＝新規候補。
3. 新規候補は content に frontmatter＋本文の完成形を書く。関連既存ノード側からの逆リンク 1 行を backlink_edits に列挙する (双方向リンク。関連が実在するものだけ・弱い繋がりを強引に張らない)。
4. この inbox のファイル名が昇格で変わる/分割される場合、元 inbox 名を wikilink で指す既存ノートを ${backlinkCmd} で機械的に洗い old_name_referrers に返す (path のリスト。0 ヒットなら空配列。同名昇格なら洗わなくてよい)。

気づき抽出 (作業レポートでも必ず行う): inbox が作業レポート・調査記録であっても、その作業を通じて立ち上がった主観的な学び・判断・方針・再発パターン・踏んだ罠の教訓が本文にあれば、作業レポート本体の 1:1 昇格とは別に kind=気づき の独立ノードとして切り出す。「作業レポートだから 1:1 で終わり」にしない——層は 作業 (レポート) → 気づき で分けるのであって、作業レポートが気づきの抽出元にならないわけではない (作業レポートは洞察の source になれないだけ)。対象は主語をツール固有から一般化できる教訓 (特定ツールの狭いスペック・手順そのものの記述は事実なので切り出さない)。本当に学びが無ければ 0 件が正当。作業レポート本体には気づきタグを付けず洞察 source にもしない。切り出した気づきが後段で洞察の素材になりうる。

【気づき候補の導出チェックリスト・毎回必須】各 kind=気づき 候補について \`derivation\` を必ず埋める (洞察の derivation 同型の規律——個別事象・実装意図・事実記述を気づき層に上げない第 1 防御線)。順序: ① \`source_observations\`: 観察した個別事象を inbox 本文から逐語で 1 件以上抜粋する (複数文の逐語可。素材に無い詳細は補完しない)。② \`pattern_generalization\`: 観察した個別事象から「事象に固有でない pattern (繰り返し見える構造・固有名詞を抜いた骨格)」を 1 文で抽出する。固有名詞・特定ツール・特定文脈の語を一般語に置換した形で書く (subagent の抽象化過程を出力に残す中間段。ここを ① の逐語と同じ言葉で埋めたら抽象化が起きていない＝再考する)。③ \`lesson_axis\`: ② で抽出した pattern から「次にどう振る舞うか／何を学んだか」を一段上の機序/教訓として 1 文で言い切る (これが気づきタイトルの土台になる軸。② の単純な言い換えに止めず ② を踏まえて規範的に言い切る)。④ \`generalization_check\`: 「③ の主語を一般語に置換できたか／複数文脈に転用可能か」の自己検証を 1 文で書く。置換できない・1 文脈にしか効かないなら気づきにせず作業レポート・事実側に倒す (個別事象・実装意図・事実記述を気づきに上げない)。kind が気づき以外の候補では derivation は空のままでよい。
タスク抽出: inbox 中の未着手の行動を kind=タスク で抽出する。ラベルは ① 明示 TODO (「TODO」「未実施」「やる」等が plain にある) / ② 次タスク候補 (「次は〜」等の先送り表明) / ③ ノート分析で出た課題 (論理ギャップ・矛盾・未解決。why_important 必須)。
洞察はここで作らない (後段の専用 agent が担う)。

MCP 不達時の fallback: MCP tool 呼び出しで exception が出た場合 (network error / server down / timeout / unreachable 等) は Grep (\`rg '<query>' ${VAULT}/notes\` 等) に retreat し処理を継続する。失敗したまま止めない。fallback した呼び出しごとに \`log('MCP_FALLBACK: <tool> <reason>')\` を 1 行出してから続行する (script 側でカウンタを持たないので grep で頻度を後から数える)。
${VAULT_RULES}
${NAMING_FOR_KIZUKI}`
}

function backfillPrompt() {
  return `あなたは backfill (過去期間の遡り蒸留) の素材収集担当。ファイルへの書き込みは一切しない (Read/Grep/Glob のみ)。

vault: ${VAULT}
対象期間: ${PERIOD.from} 〜 ${PERIOD.to}

手順:
1. notes/ の frontmatter createdAt が期間内のノートを Grep で洗い、period_pages に path / 1 行要旨 (gist) / frontmatter tags の全要素 (tags) / 本文の逐語 (body) を返す (createdAt を正とする。filesystem の時刻は使わない——mv で birthtime がずれる)。body は done sweep の証拠照合の母体になるので要約・truncate せず原文全文を返す (長大でも省略しない。完了記述が truncate されると後段 done 判定の引用が照合に落ちる)。
2. 期間内の notes/<YYYY-MM-DD>.md の「## 作業メモ」に手書き記述があれば journal_notes に抜粋を返す (空の日も多い。空を想像で埋めない)。
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
1. 繋がりを探す対象は (a) 今回の新規ノード同士 (上記「今回の新規/更新ノード」の #気づき/#洞察 を束ねる)、(b) 新規ノードと既存ノート (notes/ の #気づき #洞察・概念ノート) の両方。同じバッチで立った新規 #気づき も source 候補に含めてよい——特に drain は 1 inbox から複数の気づきが同時に立つので、それらを束ねた洞察がこのフェーズの主な取り分になる (新規気づきはまだファイル化されていないが、承認後に notes/ に作られる前提で source 候補にしてよい)。入口は MCP tool 経由で動的に引く (常時ロードのカタログは持たない・subagent には届かない)。
   - 新規ノードの claim・タイトルを query にして \`mcp__vault-catalog__search_hybrid(query=claim, limit=5)\` を呼び、関連既存ノードを取得する。
   - タグ近傍で気づき/洞察ノードを洗うときは \`mcp__vault-catalog__search_by_tag(tags=["気づき"], limit=20)\` / \`mcp__vault-catalog__search_by_tag(tags=["洞察"], limit=20)\` を呼ぶ。
   - MCP で近傍を絞ってから、繋がりの確証に要るノートだけ Read する (全 notes の Grep fan-out はしない)。**MCP 結果は近傍候補であって洞察の根拠ではない**——claim の元になる繋がりは Read した本文で確証する。
   - MOC/洞察.md (Dataview 集約) は MCP に乗らないため、束ね起点として要るときは Read で入口に使う。
   - backfill mode では上記に加え、期間素材の path/gist を入口に Grep/Read で本文を辿る (backfillFocus 節と整合)。
2. 単一観測・単一ノートの感想は洞察ではない (それは気づき止まり)。繋いで初めて見える第三の知見だけ。既出洞察の焼き直しも作らない。「過去の洞察と同じ筋」の再発はそれ自体が再発パターンの洞察になりうる。
3. 各候補: claim に洞察を一文で言い切る (複文可)。**title は claim からでなく、手順 5(3) で導く derivation.common_axis を判断軸の形で言い切ったものにする** (claim 起点は失敗形/内的手順に流れ命名ゲートを通らない——common_axis を先に確定させてから命名する。順序: derivation→common_axis→命名)。connected_notes に繋いだ実在ノートの path (実在を Read で確認する)。content は templates/insight.md の構造 (AI Context callout / ## 見えた洞察 / ## なぜ重要 / ## 応用・次アクション) で frontmatter＋本文の完成形。source: に繋いだ元ノートを '  - "[[ノート名]]"' 形式で列挙。
4. source の規律 (満たせない候補は出さない):
   - 洞察は複数 (2 件以上) の #気づき / #洞察 ノードから生まれる。単一ノート由来は洞察ではない (気づき止まり)。source に列挙できるのは #気づき / #洞察 ノードだけで、タスク・作業レポート・事実/仕様ノートは source にしない (それらを本文 wikilink や connected_notes で参照するのは可)。**同じバッチの新規 #気づき / #洞察 もこの「#気づき / #洞察 ノード」に含む**——source: には wikilink (\`[[タイトル]]\`) で、connected_notes には承認後の path (\`notes/<タイトル>.md\`) で列挙する。この新規分だけは Read 実在確認を免除する (newNotesList に在ることが実在の代わり。既存ノートは従来どおり Read で実在確認)。
   - 新しい洞察は source のどのノートよりも上位の抽象度・概念でなければならない (再発パターンを名指す・複数機序を束ねる等)。これは source に #洞察 を含む場合に限らない——source が #気づき のみでも同じで、気づきを束ねた結果が source の 1 つと同位なら洞察ではない。同位・下位の言い換えは source でなく本文リンクで繋ぐ。「リンクでなく source に置く」＝「その元ノートを一段上から束ねた」という主張になる。
   - 単一 source 充足テスト (失格判定): source のどれか 1 件**単独**で claim が言い切れてしまうなら、それは束ねでなくその 1 件の言い換え＝洞察として出さない (その気づき/洞察ノートに留める)。【注意】source 間に重複・近接があっても束ねる価値はある——冗長な source を 1 つ抜いても claim が残ること自体は失格ではない。失格は「1 件だけで全部言える」ケースに限る。
   - 同バッチ重複ガード: 今回の新規ノード一覧 (上記「今回の新規/更新ノート」) に出ている #気づき の 1 件と claim が同義になる洞察は出さない。同じバッチで気づきと洞察が同じことを言うなら、気づきを残して洞察は出さない (特に drain は 1 inbox 内の単発昇格で束ねの母数が足りないことが多い)。
   - ただし抽象を上げた分、本文の「なぜ重要」「応用」で具体事例に接地させること。元ノートの具体から離れて一般論・空論になった候補は出さない。
5. 【洞察生成の核・最重要】失敗事例を「二度と失敗しないための判断軸」に変換する。これが洞察の本質であり、失敗の再記述・原因論の一般化・1 つの軸への言い換えで終えてはならない。やり方:
   - (1) 束ねる複数の失敗気づきが、より上位の同一カテゴリの「異なる側面」として括れないか探す (例: 生成・参照・命名 という 3 つの索引失敗は「索引の外側の境界条件」の 3 側面)。この共通カテゴリを名指すのが第三知見であって、条件の並置 (チェックリスト) でも 1 軸への collapse (言い換え) でもない。
   - (2) 括れた共通カテゴリを「次に何を確認するか／どこに投資するか」の行動可能な判断軸に変換する (例: 索引が効かないとき索引エンジンでなく 3 境界のどれが律速かを切り分ける)。claim は失敗の説明でなく次の行動を指す一文にする。
   - (3) 【毎回必須・全候補で実施し derivation に記録する。行き詰まり時だけでない】導出チェックリスト: ①各 source 気づきの失敗の回避法を 1 つずつ書く (source と同数・2 件以上＝derivation.source_avoidances) → ②回避法の共通点を書く (derivation.common_point) → ③共通点から共通の対処/確認 (1 つの事前判断 or 1 つのレビュー観点＝derivation.common_axis) を書く。③が出れば洞察・出ず合算止まりなら洞察にしない。title は derivation.common_axis を判断軸の形で言い切ったものにする (命名規約は別途注入。失敗接地: 2026-06-14 速度/精度 2 気づきを症状の相関で言い換えて空回り→この分解で「答えが構造にある問いに走査を当てた一機序の二症状」と判明)。
   - 直近の具体例 (vault に実在・余裕があれば Read して倣う): [[良い索引かは生成、参照、命名で決まる]] (生成/参照/命名 の 3 失敗を「索引の外側の境界条件」に括り、投資先の判断軸に変換)。[[同じ意味のものは同じ内容でなければならない]] (drift/残留/分割/並走 の 4 失敗を「同じ意味を担う実体は他に無いか・内容は一致しているか」というレビュー観点に変換)。
   - 【手本の使い方】この具体例・insight.md・既存洞察ノートから倣うのは畳み方/トーン/体裁であって主張内容ではない。手本の主張をなぞって似た洞察を作るな——内容は上記 source 規律 (4) に従い目の前の素材から立てる。
6. なぜ重要・応用にはソフトウェア開発に転用できる接地を最低 1 つ入れる (読み手は SWE)。

繋がりが弱ければ 0 件が正当な出力 (「A 止まりですらない」もありうる)。無理に B をでっち上げない。

MCP 不達時の fallback: MCP tool 呼び出しで exception が出た場合は Grep に retreat し処理を継続する (Obsidian 起動時は \`obsidian tag name=気づき / name=洞察\` で実タグ索引、未起動なら frontmatter 形式に当てる multiline rg: \`rg -l --multiline -U '(?s)^---\\n(.*?\\n)*?tags:\\n(\\s*-\\s+[^\\n]*\\n)*\\s*-\\s+気づき' ${VAULT}/notes\` — inline #気づき タグだけを当てる \`rg -l '#気づき'\` は frontmatter 形式を取り逃すので使わない)。失敗したまま止めない。fallback した呼び出しごとに \`log('MCP_FALLBACK: <tool> <reason>')\` を 1 行出してから続行する。
${VAULT_RULES}
${NAMING_FOR_INSIGHT}`
}

function donePrompt(corpus) {
  // タグ列挙コマンドと progress 判定手段は script が決定論で解決する (起動判定は呼び出し側が渡した flag)。agent は実行のみ。
  const taskListing = OBSIDIAN_AVAILABLE
    ? 'obsidian tag name=タスク の ^notes/ 行で tags に タスク を含むノートを洗い (実タグ索引で速く・過剰一致しない)'
    : 'notes/ を Grep して tags に タスク を含むノートを洗い'
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
log(`mode=${MODE} / 素材: ${MODE === 'drain' ? INBOX_FILES.length + ' inbox files' : `${PERIOD.from}〜${PERIOD.to}`}`)

let candidates = []
let linkRewrites = []
let backfillMaterial = null
let corpus = '' // done 検出の証拠照合用テキスト (script が手元に持つ素材だけが照合対象)。drain では未使用 (drain 抽出 subagent が併合済み)
let drainDoneCandidates = [] // drain mode の done 候補は drain 抽出 subagent が返したものを flatten する (donePrompt は呼ばない)
const flags = { extraction_failed: [], insight_failed: false, done_failed: false, done_skipped_no_reports: false }

if (MODE === 'drain') {
  await pipeline(
    INBOX_FILES,
    (f) =>
      agent(drainExtractPrompt(f, OPEN_TASKS), {
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
      for (const c of ex.promotions) {
        // inbox_origin はプロンプトで埋めさせているが、念のため script 側でも保証する (集約段の DUPLICATE_DETECTED 照合キー・belt-and-suspenders)
        if (!c.inbox_origin) c.inbox_origin = f.path
        // 導出チェックリストが毎回実施されたかを機械チェック (自己申告でなく出力の充足で検証)。
        // source_observations は 1 件以上 (気づきは 1 観察起点が中心)・pattern_generalization/lesson_axis/generalization_check 非空。未充足は triage で明示する。
        if (c.kind === '気づき') {
          const d = c.derivation || {}
          const hasLessonAxis = !!(d.lesson_axis && d.lesson_axis.trim())
          c.derivation_ok =
            Array.isArray(d.source_observations) &&
            d.source_observations.filter((s) => s && s.trim()).length >= 1 &&
            !!(d.pattern_generalization && d.pattern_generalization.trim()) &&
            hasLessonAxis &&
            !!(d.generalization_check && d.generalization_check.trim())
          // 命名は lesson_axis から導く (title=判断軸)。命名点検 (nameGate) の元記述に
          // source_excerpt (素材逐語抜粋＝具体事例文) でなく lesson_axis を渡す
          // ——具体事例起点だと表層圧縮に流れ④単純圧縮で命名ゲートを通らない
          // (失敗接地 2026-06-27: drain 20 回目 ID2「人ゲートの審査対象にならない」で
          // source_excerpt の具体事例文脈に引きずられ r2 ④で hit→ユーザ訂正)。
          // lesson_axis 欠落時のみ既存 source_excerpt に退避。
          if (hasLessonAxis) c.source_excerpt = d.lesson_axis
        }
      }
      // 同一 inbox の候補は揃った時点で即ゲートに流す (他 inbox の抽出を待たない)
      await parallel(ex.promotions.filter(needsGate).map((c) => () => runGate(c)))
      candidates.push(...ex.promotions)
      if (ex.old_name_referrers.length) linkRewrites.push({ inbox: f.path, referrers: ex.old_name_referrers })
      // inbox_origin は念のため script 側でも保証する (belt-and-suspenders)
      for (const d of (ex.done_candidates || [])) {
        if (!d.inbox_origin) d.inbox_origin = f.path
        drainDoneCandidates.push(d)
      }
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
  // script が決定論フィルタで組む (LLM に「どれが作業レポートか」を委ねない)。証跡は揮発しない期間内 notes 本文。
  const reportPages = periodPages.filter((p) => !(p.tags || []).some((t) => LAYER_TAGS.includes(t)))
  corpus = reportPages.map((p) => `===== ${p.path} =====\n${p.body || ''}`).join('\n')
  // backfill の主眼は done reconcile。作業レポート系ノートが期間内に 0 件だと corpus 空で done-scan が走れない。
  // 「走査して 0 件」と「対象ゼロで走らせていない」を戻りで区別するため明示フラグを立てる (decision: 決定論の件数判定)。
  if (reportPages.length === 0) flags.done_skipped_no_reports = true
  // schema enum (['①']) で ②③ は表現不能だが、script 側でも二重に防御する
  candidates = r.candidates.filter((c) => c.kind !== 'タスク' || c.label === '①')
  await parallel(candidates.filter(needsGate).map((c) => () => runGate(c)))
  log(`done sweep corpus: 作業レポート系 ${reportPages.length} 件 / 期間内 notes ${periodPages.length} 件`)
  if (flags.done_skipped_no_reports) log('期間内に作業レポート系ノート (無印) が無く done sweep をスキップ (reconcile 対象ゼロ)')
}
log(`素材整理: 候補 ${candidates.length} 件 (うち fold ${candidates.filter((c) => c.fold_into).length})`)

// ============================================================
phase('洞察検出')
const nonTask = candidates.filter((c) => c.kind !== 'タスク')
let extraMaterial = ''
let newNotesList = ''
let sourceExcerptEmptyCount = 0
if (MODE === 'drain') {
  // drain は corpus 全文注入を廃止し、各候補の source_excerpt 直結の lightMaterial を別途渡す (v6 plan・全体最適)。
  // newNotesList は insightPrompt の canonical anchor として保持 (`今回の新規/更新ノード` 節が "(なし)" になると洞察検出が
  // 新規 0 件と誤読する)。drain でも `[kind] title` 形式で必ず生成する (lightMaterial 側で gist=source_excerpt を補強する)。
  sourceExcerptEmptyCount = nonTask.filter((c) => !c.source_excerpt).length
  newNotesList = nonTask
    .map((c) => `- [${c.kind}] ${c.title}${c.fold_into ? ` (→ ${c.fold_into} へ畳む)` : ''}`)
    .join('\n')
  // lightMaterial: source_excerpt は長文時に lightMaterial 全体を肥大化させるので 200 字までで切る (洞察検出の入口素材として
  // 十分・行き止まりの絞り込みは subagent が MCP/Read で再取得する)。
  extraMaterial = `昇格元 inbox から立った新規気づき・候補 (path + gist=source_excerpt 直結・gist は 200 字までで truncate):\n${nonTask
    .map((c) => `- [${c.kind}] [[${c.title}]] (${c.inbox_origin || '(no origin)'}): ${(c.source_excerpt || '(no excerpt)').slice(0, 200)}`)
    .join('\n')}`
}
if (MODE === 'backfill') {
  // backfill は従来の newNotesList 生成を維持する (lightMaterial は drain と別経路)。
  newNotesList = nonTask
    .map((c) => `- [${c.kind}] ${c.title}${c.fold_into ? ` (→ ${c.fold_into} へ畳む)` : ''}`)
    .join('\n')
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
// INSIGHT_ZERO ログ (drain mode のみ・lightMaterial で素材足りているか観察するための指標)。
// 判定基準は本 script ではなく外側 (drain 実走を跨いだ 3 回連続発生) で行うので、ここでは件数指標だけ出す。
if (MODE === 'drain' && ir && ir.insights.length === 0) {
  // lightMaterial_count は nonTask.length と同値なので 1 つだけ残す (nonTask_count を撤去)
  log(`INSIGHT_ZERO: lightMaterial_count=${nonTask.length} source_excerpt_empty_count=${sourceExcerptEmptyCount}`)
}

// ============================================================
phase('タスク・完了検出')
let doneCandidates = []
let duplicateDetected = []
if (MODE === 'drain') {
  // drain は素材整理段の drain 抽出 subagent が done 検出責務を併合済み (v6 plan)。donePrompt 呼び出しは廃止。
  // quote_verified は drain 抽出 subagent の自己申告のみ。workflow 側の再照合は v6 plan で廃止 (drain mode では full inbox
  // 本文が workflow に流れず再包含照合できない・本格的な再照合 Read agent は YAGNI で別 cycle 候補)。schema で quote_verified
  // は boolean 確定済みなのでそのまま使う。
  doneCandidates = drainDoneCandidates
  // DUPLICATE_DETECTED: 同じ inbox_origin から done_candidates と promotions の両方が候補を出した場合の重複検出ログ。
  // prompt 内 order 強制 + 排他指示のフェイルセーフ。粗い判定で false positive が出る (作業レポート・気づき由来の duplicate も
  // 拾うため) が、false negative は減る方向 (v6 plan で受容済み)。kind === 'タスク' に絞らず全 promotions を対象にする。
  for (const d of doneCandidates) {
    const hits = candidates
      .filter((c) => c.inbox_origin === d.inbox_origin)
      .map((c) => ({ kind: c.kind, title: c.title }))
    if (hits.length) {
      duplicateDetected.push({ inbox_origin: d.inbox_origin, done_task_path: d.task_path, conflicting_promotions: hits })
    }
  }
  // 統計: quote_verified 件数と evidence_quote 長さ分布
  const verifiedCount = doneCandidates.filter((d) => d.quote_verified).length
  const quoteLengths = doneCandidates.map((d) => (d.evidence_quote || '').length)
  const avgQuoteLen = quoteLengths.length ? Math.round(quoteLengths.reduce((a, b) => a + b, 0) / quoteLengths.length) : 0
  log(
    `done 候補 (drain・併合済み): ${doneCandidates.length} 件 (quote_verified true ${verifiedCount} / evidence_quote 平均長 ${avgQuoteLen})`,
  )
  if (duplicateDetected.length) {
    log(`DUPLICATE_DETECTED: ${duplicateDetected.length} 件 (done と promotions が同じ inbox_origin から出た組)`)
    for (const dup of duplicateDetected) {
      log(`  - inbox=${dup.inbox_origin} done=${dup.done_task_path} promotions=${dup.conflicting_promotions.map((p) => `[${p.kind}]${p.title}`).join(', ')}`)
    }
  }
} else {
  // backfill は期間内作業レポート本文が corpus。corpus が空なら done sweep をスキップ (証拠ゼロ)。
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
  kizuki_derivation_incomplete: candidates.filter((c) => c.kind === '気づき' && !c.fold_into && !c.derivation_ok).length,
  done_candidates: doneCandidates.length,
  duplicate_detected: duplicateDetected.length,
}
log(
  `集計: ${totals.count} 候補 (気づき ${totals.kizuki} / 洞察 ${totals.insights} / タスク ${totals.tasks} / レポート・事実 ${totals.reports} / fold ${totals.folds}) 再命名 ${totals.renamed} / ゲート未解決 ${totals.gate_unresolved} / 検証落ち ${totals.validation_failed} / 洞察導出未完 ${totals.insights_derivation_incomplete} / 気づき導出未完 ${totals.kizuki_derivation_incomplete} / 重複検出 ${totals.duplicate_detected}`,
)

return {
  mode: MODE,
  candidates,
  link_rewrites: linkRewrites,
  done_candidates: doneCandidates,
  duplicate_detected: duplicateDetected, // drain mode のみ非空。done_candidates と promotions が同じ inbox_origin から出た組
  totals,
  flags,
}
