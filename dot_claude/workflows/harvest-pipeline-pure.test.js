// harvest-pipeline-pure.test.js — scoreRelatedness の単体テスト (node:test)
// 実行: cd ~/.claude/workflows && node --test harvest-pipeline-pure.test.js
//
// 必須テストケース 8 種 (plan.md Verification > Phase 1 を逐語踏襲):
//   1. 同入力 → 同出力 (決定論性)
//   2. fold_candidates ⊆ related (不変条件)
//   3. 空入力 → { related: [], fold_candidates: [] }
//   4. リンク対象認定の閾値境界 (score_knn = 0.70 で採用 / 0.69 で除外)
//   5. fold 候補認定の閾値境界 (score_knn = 0.85 + score_bm25 > 0 で fold / score_bm25 = 0 だと related のみ)
//   6. score_knn = 0 で score_bm25 のみ正 → fold にも related にも乗らない
//   7. 降順かつ安定: 同 score の入力順序を保つ
//   8. 事前条件違反 throw: opts で foldKnnMin < relatedKnnMin

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreRelatedness, RELATED_KNN_MIN, FOLD_KNN_MIN, FOLD_REQUIRES_BM25_HIT } from './harvest-pipeline-pure.js'

test('閾値定数が plan.md の v1 暫定値と一致 (sanity check)', () => {
  assert.equal(RELATED_KNN_MIN, 0.70)
  assert.equal(FOLD_KNN_MIN, 0.85)
  assert.equal(FOLD_REQUIRES_BM25_HIT, true)
})

test('1. 同入力 → 同出力 (決定論性)', () => {
  const hits = [
    { path: 'notes/a.md', score_bm25: 2.1, score_knn: 0.92 },
    { path: 'notes/b.md', score_bm25: 1.5, score_knn: 0.78 },
    { path: 'notes/c.md', score_bm25: 0.3, score_knn: 0.55 },
  ]
  const r1 = scoreRelatedness(hits)
  const r2 = scoreRelatedness(hits)
  assert.deepEqual(r1, r2)
})

test('2. fold_candidates ⊆ related (不変条件・全件で確認)', () => {
  const hits = [
    { path: 'notes/a.md', score_bm25: 2.1, score_knn: 0.92 },
    { path: 'notes/b.md', score_bm25: 1.5, score_knn: 0.78 },
    { path: 'notes/c.md', score_bm25: 0.0, score_knn: 0.95 }, // fold 閾値超だが bm25 0 → related のみ
    { path: 'notes/d.md', score_bm25: 0.3, score_knn: 0.55 }, // related 閾値未満
  ]
  const { related, fold_candidates } = scoreRelatedness(hits)
  for (const p of fold_candidates) {
    assert.ok(related.includes(p), `fold_candidate ${p} が related に含まれていない`)
  }
})

test('3. 空入力 → { related: [], fold_candidates: [] }', () => {
  assert.deepEqual(scoreRelatedness([]), { related: [], fold_candidates: [] })
})

test('4. リンク対象認定の閾値境界 (score_knn = 0.70 で採用 / 0.69 で除外)', () => {
  const onBoundary = scoreRelatedness([{ path: 'notes/x.md', score_bm25: 1.0, score_knn: 0.70 }])
  assert.deepEqual(onBoundary.related, ['notes/x.md'])

  const justBelow = scoreRelatedness([{ path: 'notes/y.md', score_bm25: 1.0, score_knn: 0.69 }])
  assert.deepEqual(justBelow.related, [])
  assert.deepEqual(justBelow.fold_candidates, [])
})

test('5. fold 候補認定の閾値境界 (score_knn = 0.85 + score_bm25 > 0 で fold / score_bm25 = 0 で related のみ)', () => {
  // 0.85 ちょうど + bm25 > 0 → fold + related 両方
  const onFold = scoreRelatedness([{ path: 'notes/x.md', score_bm25: 1.5, score_knn: 0.85 }])
  assert.deepEqual(onFold.related, ['notes/x.md'])
  assert.deepEqual(onFold.fold_candidates, ['notes/x.md'])

  // 0.85 ちょうど + bm25 = 0 → related のみ (fold から外れる)
  const noBm25 = scoreRelatedness([{ path: 'notes/y.md', score_bm25: 0, score_knn: 0.85 }])
  assert.deepEqual(noBm25.related, ['notes/y.md'])
  assert.deepEqual(noBm25.fold_candidates, [])

  // 0.84 ちょうど + bm25 > 0 → related のみ (fold 閾値未満)
  const justBelowFold = scoreRelatedness([{ path: 'notes/z.md', score_bm25: 1.5, score_knn: 0.84 }])
  assert.deepEqual(justBelowFold.related, ['notes/z.md'])
  assert.deepEqual(justBelowFold.fold_candidates, [])
})

test('6. score_knn = 0 / score_bm25 のみ正 → fold にも related にも乗らない (kNN 主軸の意図的挙動)', () => {
  const hits = [
    { path: 'notes/a.md', score_bm25: 5.0, score_knn: 0 },
    { path: 'notes/b.md', score_bm25: 10.0, score_knn: 0 },
  ]
  const { related, fold_candidates } = scoreRelatedness(hits)
  assert.deepEqual(related, [])
  assert.deepEqual(fold_candidates, [])
})

test('7. 降順かつ安定: 同 score の入力順序を保つ', () => {
  // 同 score_knn の入力順序が保たれることを 3 件揃えて確認
  const hits = [
    { path: 'notes/first.md', score_bm25: 1.0, score_knn: 0.80 },
    { path: 'notes/middle.md', score_bm25: 1.0, score_knn: 0.90 }, // 一番上に来る
    { path: 'notes/second.md', score_bm25: 1.0, score_knn: 0.80 },
    { path: 'notes/third.md', score_bm25: 1.0, score_knn: 0.80 },
  ]
  const { related } = scoreRelatedness(hits)
  assert.deepEqual(related, ['notes/middle.md', 'notes/first.md', 'notes/second.md', 'notes/third.md'])
})

test('8. 事前条件違反 throw: opts で foldKnnMin < relatedKnnMin', () => {
  assert.throws(
    () => scoreRelatedness([], { relatedKnnMin: 0.8, foldKnnMin: 0.7 }),
    /foldKnnMin.*must be >= relatedKnnMin/,
  )
  // 等号は OK (foldKnnMin === relatedKnnMin)
  assert.doesNotThrow(() => scoreRelatedness([], { relatedKnnMin: 0.8, foldKnnMin: 0.8 }))
})

// 追加サニティ: 純関数性 (入力配列を破壊しない)
test('入力配列を破壊しない (純関数性)', () => {
  const hits = [
    { path: 'notes/a.md', score_bm25: 1.0, score_knn: 0.50 },
    { path: 'notes/b.md', score_bm25: 1.0, score_knn: 0.95 },
  ]
  const snapshot = JSON.parse(JSON.stringify(hits))
  scoreRelatedness(hits)
  assert.deepEqual(hits, snapshot)
})

// 追加サニティ: opts で foldRequiresBm25Hit=false を指定すると BM25=0 でも fold に乗る
test('opts.foldRequiresBm25Hit=false で BM25 制約を緩めると BM25=0 でも fold に乗る', () => {
  const hits = [{ path: 'notes/x.md', score_bm25: 0, score_knn: 0.90 }]
  const r = scoreRelatedness(hits, { foldRequiresBm25Hit: false })
  assert.deepEqual(r.related, ['notes/x.md'])
  assert.deepEqual(r.fold_candidates, ['notes/x.md'])
})
