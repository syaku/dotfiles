// harvest-pipeline-pure.js — harvest-pipeline workflow から決定論部分 (関連ノート抽出の閾値判定)
// だけを切り出した純関数モジュール。agent / parallel / log / phase を呼ばず、純粋な hits 配列の判定だけを担う。
// validateCandidate (harvest-pipeline.js L444-476) と同じパターン (入力 1 つ・出力は結果 object・workflow API 非依存)。
//
// 設計の正本: workbench/harvest-pipeline関連ノート抽出の純関数化/plan.md (status: final)
// 入出力契約: Hit = { path: string, score_bm25: number, score_knn: number }
//             戻り = { related: string[], fold_candidates: string[] } (fold_candidates ⊆ related が不変条件)

// v1 暫定値 (plan.md Approach 節参照)。
// score_knn を主軸に置く理由: BM25 (Lucene の unbounded スコア) は index 構成変更でドリフトするため
// 閾値の意味が変わる。kNN cosine は 0.0〜1.0 の bounded で意味が安定する。
export const RELATED_KNN_MIN = 0.70
export const FOLD_KNN_MIN = 0.85
export const FOLD_REQUIRES_BM25_HIT = true

export function scoreRelatedness(hits, opts = {}) {
  // opts: { relatedKnnMin, foldKnnMin, foldRequiresBm25Hit } で閾値を上書き可
  //   (テストで境界値を打つため・本番デフォルトは module 定数)。
  //   `??` は legitimate な 0 / false を残しつつ undefined/null だけを default に落とす
  //   (`||` だと relatedKnnMin: 0 や foldRequiresBm25Hit: false が default に書き換わって意図が壊れる)。
  const relatedKnnMin = opts.relatedKnnMin ?? RELATED_KNN_MIN
  const foldKnnMin = opts.foldKnnMin ?? FOLD_KNN_MIN
  const foldRequiresBm25Hit = opts.foldRequiresBm25Hit ?? FOLD_REQUIRES_BM25_HIT

  // 事前条件: foldKnnMin >= relatedKnnMin
  // 違反すると fold_candidates ⊆ related の不変条件が壊れる (fold 閾値が緩いと related に乗らないものが fold に乗る)。
  // 関連認定より緩い fold 閾値は意味的にも誤りで、上書き時のミスを検出して早期に止める。
  if (foldKnnMin < relatedKnnMin) {
    throw new Error(`scoreRelatedness: foldKnnMin (${foldKnnMin}) must be >= relatedKnnMin (${relatedKnnMin})`)
  }

  // 空入力は決定論で空伝播 (例外は投げない)
  if (!Array.isArray(hits) || hits.length === 0) {
    return { related: [], fold_candidates: [] }
  }

  // ランキング: score_knn 降順で、同 score のとき入力順序を保つ (stable sort)。
  // Array.prototype.sort は ECMAScript 2019 から stable が要求されるので Node.js でも安全。
  // 元配列を破壊しないため slice() してから sort する。
  const ranked = hits.slice().sort((a, b) => (b.score_knn || 0) - (a.score_knn || 0))

  const related = []
  const fold_candidates = []
  for (const h of ranked) {
    const knn = h.score_knn || 0
    const bm25 = h.score_bm25 || 0
    if (knn >= relatedKnnMin) {
      related.push(h.path)
      if (knn >= foldKnnMin && (!foldRequiresBm25Hit || bm25 > 0)) {
        fold_candidates.push(h.path)
      }
    }
  }

  return { related, fold_candidates }
}
