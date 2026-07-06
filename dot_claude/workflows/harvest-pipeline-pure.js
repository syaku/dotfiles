// harvest-pipeline-pure.js — harvest-pipeline workflow から決定論部分 (関連ノート抽出の evidence 判定)
// だけを切り出した純関数モジュール。agent / parallel / log / phase を呼ばず、純粋な hits 配列の判定だけを担う。
//
// 入出力契約: Hit = { path: string, score_bm25: number, score_knn: number } (section 粒度・同一 path 複数可)
//             戻り = { related: string[], fold_candidates: string[] } (fold_candidates ⊆ related が不変条件)
//
// v2 (2026-07-06 裏取りに基づく再設計。裏取り: 正例 50 = frontmatter source:/related: 実リンク・負例 100 = 無作為ペア):
// - 絶対値 cosine 閾値は廃止。e5-base の cosine は正例 p50 0.890 / 負例 p50 0.838 で分布が重なり、
//   正例 90% を通す閾値 (0.855) で負例 29% が混入する——関連/無関係を分ける絶対値は存在しない。
// - score_knn=0.0 は「kNN 取得窓 (over_fetch) に入らなかった」欠測マーカー (MCP server が BM25-only doc に
//   0.0 を埋める) であって実測 cosine ではない。v1 はこれを cosine として RELATED_KNN_MIN と比較し、
//   BM25 側から浮上した真の関連ノートを構造的に全滅させていた (drain 産ノートの related 0〜2 件の主因)。
// - 判定は「チャネル evidence」に置換: kNN 窓に入った (score_knn > 0) ∪ BM25 相対上位。両チャネルとも
//   単独 recall は 30〜40% しかない (タイトル BM25 recall@10=30%・doc-vector kNN recall@20=40%) ので、
//   片チャネルでも浮上すれば related に拾い、確証は下流の本文 Read (SKILL 4.7 step 2.2) に委ねる。
// - BM25 の絶対値は index 構成変更でドリフトするため使わず、クエリ内 top スコア比 (相対値) で切る。
// - fold (同一物検出) に cosine は使えない (「ただの関連」ペアの 9 割が旧閾値 0.85 を超える)。
//   両チャネル共起かつ BM25 強一致だけを候補にし、最終判定は集約段の本文 Read 確認が担う。
export const BM25_REL_FLOOR = 0.15 // related 認定: bm25 がクエリ内 top の 15% 以上 (語彙一致の far-tail ノイズだけ落とす。実測の真関連は top 比 0.18〜0.27 に分布——self/強一致が top を吊り上げるため floor は緩く取り、選別は ranking + relatedMax + 人ゲートに委ねる)
export const FOLD_BM25_REL = 0.5 // fold 候補認定: bm25 が top の 50% 以上 (強い語彙一致) かつ kNN 窓内
export const RELATED_MAX = 6 // related 上限 (backlink_edits の過剰生成を抑制。limit 引き上げ後の窓は最大 20 超 note)
export const FOLD_MAX = 2 // fold 候補上限 (下流の本文 Read 確認コストの上限)

export function scoreRelatedness(hits, opts = {}) {
  // opts: { bm25RelFloor, foldBm25Rel, relatedMax, foldMax } で上書き可 (テストで境界を打つため)。
  //   `??` は legitimate な 0 を残しつつ undefined/null だけを default に落とす。
  const bm25RelFloor = opts.bm25RelFloor ?? BM25_REL_FLOOR
  const foldBm25Rel = opts.foldBm25Rel ?? FOLD_BM25_REL
  const relatedMax = opts.relatedMax ?? RELATED_MAX
  const foldMax = opts.foldMax ?? FOLD_MAX

  // 事前条件: foldBm25Rel >= bm25RelFloor
  // fold 側が緩いと「related に乗らないのに fold に乗る」が構成でき fold ⊆ related の不変条件が壊れる。
  if (foldBm25Rel < bm25RelFloor) {
    throw new Error(`scoreRelatedness: foldBm25Rel (${foldBm25Rel}) must be >= bm25RelFloor (${bm25RelFloor})`)
  }

  // 空入力は決定論で空伝播 (例外は投げない)
  if (!Array.isArray(hits) || hits.length === 0) {
    return { related: [], fold_candidates: [] }
  }

  // note (path) 単位に集約: index は section 粒度で 1 note が複数 hit を占めるため、
  // チャネル別の最大値を note 代表値に取る (limit=5 時代に distinct 3.7 note に潰れていた重複の解消)。
  const byPath = new Map()
  for (const h of hits) {
    if (!h || !h.path) continue
    let e = byPath.get(h.path)
    if (!e) {
      e = { path: h.path, knnMax: 0, bm25Max: 0, order: byPath.size }
      byPath.set(h.path, e)
    }
    e.knnMax = Math.max(e.knnMax, h.score_knn || 0)
    e.bm25Max = Math.max(e.bm25Max, h.score_bm25 || 0)
  }
  const notes = [...byPath.values()]
  const bm25Top = notes.reduce((m, n) => Math.max(m, n.bm25Max), 0)

  for (const n of notes) {
    n.inKnn = n.knnMax > 0 // kNN 窓に入った (0.0 は欠測なので「窓外」とだけ読む)
    n.bm25Rel = bm25Top > 0 ? n.bm25Max / bm25Top : 0
    n.inBm25 = bm25Top > 0 && n.bm25Rel >= bm25RelFloor
  }

  // ランキング: 両チャネル共起 > kNN 単独 > BM25 単独。スケール非互換なので合成スコアは作らず、
  // 共起/BM25 単独グループ内は bm25Rel 降順・kNN 単独グループ内は knnMax 降順。同値は入力順 (stable)。
  const group = (n) => (n.inKnn && n.inBm25 ? 0 : n.inKnn ? 1 : 2)
  const cands = notes.filter((n) => n.inKnn || n.inBm25)
  cands.sort((a, b) => {
    const ga = group(a)
    const gb = group(b)
    if (ga !== gb) return ga - gb
    const ka = ga === 1 ? a.knnMax : a.bm25Rel
    const kb = ga === 1 ? b.knnMax : b.bm25Rel
    return kb - ka || a.order - b.order
  })

  const related = cands.slice(0, relatedMax).map((n) => n.path)
  const fold_candidates = cands
    .filter((n) => n.inKnn && n.bm25Rel >= foldBm25Rel)
    .slice(0, foldMax)
    .map((n) => n.path)
    .filter((p) => related.includes(p)) // fold ⊆ related (relatedMax cap で切れた path の保護)

  return { related, fold_candidates }
}
