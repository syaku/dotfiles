// harvest-pipeline-pure.test.js — scoreRelatedness v2 の単体テスト (node:test)
// 実行: cd ~/.claude/workflows && node --test harvest-pipeline-pure.test.js
//
// v2 (2026-07-06 チャネル evidence 再設計) のテストケース:
//   1. 同入力 → 同出力 (決定論性)
//   2. fold_candidates ⊆ related (不変条件)
//   3. 空入力 → { related: [], fold_candidates: [] }
//   4. BM25-only hit (score_knn=0.0 欠測) が related に乗る (v1 からの回帰の核心)
//   5. BM25 相対 floor 境界 (top 比 0.15 で採用 / 未満で除外)
//   6. note 単位 dedup (同 path の複数 section が related に 1 回だけ乗る)
//   7. fold: 両チャネル共起 + BM25 強一致のみ / kNN 単独は高 cosine でも fold に乗らない
//   8. 事前条件違反 throw: opts で foldBm25Rel < bm25RelFloor
//   9. ランキング: 共起 > kNN 単独 > BM25 単独・同値は入力順 (stable)
//  10. relatedMax / foldMax の cap

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  scoreRelatedness,
  BM25_REL_FLOOR,
  FOLD_BM25_REL,
  RELATED_MAX,
  FOLD_MAX,
} from './harvest-pipeline-pure.js'

test('定数が v2 の裏取り済み設定と一致 (sanity check)', () => {
  assert.equal(BM25_REL_FLOOR, 0.15)
  assert.equal(FOLD_BM25_REL, 0.5)
  assert.equal(RELATED_MAX, 6)
  assert.equal(FOLD_MAX, 2)
})

test('1. 同入力 → 同出力 (決定論性)', () => {
  const hits = [
    { path: 'notes/a.md', score_bm25: 100, score_knn: 0.92 },
    { path: 'notes/b.md', score_bm25: 40, score_knn: 0 },
    { path: 'notes/c.md', score_bm25: 0, score_knn: 0.93 },
  ]
  const r1 = scoreRelatedness(hits)
  const r2 = scoreRelatedness(hits)
  assert.deepEqual(r1, r2)
})

test('2. fold_candidates ⊆ related (不変条件・全件で確認)', () => {
  const hits = [
    { path: 'notes/a.md', score_bm25: 100, score_knn: 0.92 },
    { path: 'notes/b.md', score_bm25: 60, score_knn: 0.9 },
    { path: 'notes/c.md', score_bm25: 0, score_knn: 0.95 },
    { path: 'notes/d.md', score_bm25: 10, score_knn: 0 },
  ]
  const { related, fold_candidates } = scoreRelatedness(hits)
  for (const p of fold_candidates) {
    assert.ok(related.includes(p), `fold_candidate ${p} が related に含まれていない`)
  }
})

test('3. 空入力 → { related: [], fold_candidates: [] }', () => {
  assert.deepEqual(scoreRelatedness([]), { related: [], fold_candidates: [] })
})

test('4. BM25-only hit (score_knn=0.0 欠測) が related に乗る — v1 回帰の核心', () => {
  // 実測の再現: 「全体の強度…」クエリで 良い索引 (bm25 29.5 / knn 0.0・top 比 0.246) が v1 で全滅していたケース
  const hits = [
    { path: 'notes/self.md', score_bm25: 119.7, score_knn: 0.92 },
    { path: 'notes/related-by-bm25.md', score_bm25: 29.5, score_knn: 0.0 },
  ]
  const { related } = scoreRelatedness(hits)
  assert.ok(related.includes('notes/related-by-bm25.md'), 'BM25-only の真の関連が related から落ちている')
})

test('5. BM25 相対 floor 境界 (top 比 0.15 で採用 / 未満で除外・kNN 窓外)', () => {
  const onFloor = scoreRelatedness([
    { path: 'notes/top.md', score_bm25: 100, score_knn: 0 },
    { path: 'notes/x.md', score_bm25: 15, score_knn: 0 }, // 100 × 0.15 = 15 ちょうど
  ])
  assert.ok(onFloor.related.includes('notes/x.md'))

  const belowFloor = scoreRelatedness([
    { path: 'notes/top.md', score_bm25: 100, score_knn: 0 },
    { path: 'notes/y.md', score_bm25: 14.9, score_knn: 0 },
  ])
  assert.ok(!belowFloor.related.includes('notes/y.md'))
})

test('6. note 単位 dedup: 同 path の複数 section が related に 1 回だけ乗る', () => {
  const hits = [
    { path: 'notes/a.md', score_bm25: 100, score_knn: 0.91 },
    { path: 'notes/a.md', score_bm25: 100, score_knn: 0.93 },
    { path: 'notes/a.md', score_bm25: 90, score_knn: 0 },
    { path: 'notes/b.md', score_bm25: 50, score_knn: 0 },
  ]
  const { related } = scoreRelatedness(hits)
  assert.deepEqual(
    related.filter((p) => p === 'notes/a.md').length,
    1,
    '同一 note が related に複数回乗っている',
  )
  assert.ok(related.includes('notes/b.md'))
})

test('7. fold: 両チャネル共起 + BM25 強一致 (top 比 0.5 以上) のみ。kNN 単独は高 cosine でも乗らない', () => {
  const hits = [
    { path: 'notes/strong-both.md', score_bm25: 100, score_knn: 0.94 }, // fold 候補
    { path: 'notes/weak-bm25.md', score_bm25: 30, score_knn: 0.93 }, // bm25Rel 0.3 < 0.5 → related のみ
    { path: 'notes/knn-only.md', score_bm25: 0, score_knn: 0.96 }, // 窓内最高 cosine でも fold 不可
  ]
  const { related, fold_candidates } = scoreRelatedness(hits)
  assert.deepEqual(fold_candidates, ['notes/strong-both.md'])
  assert.ok(related.includes('notes/weak-bm25.md'))
  assert.ok(related.includes('notes/knn-only.md'))
})

test('8. 事前条件違反 throw: opts で foldBm25Rel < bm25RelFloor', () => {
  assert.throws(
    () => scoreRelatedness([], { bm25RelFloor: 0.5, foldBm25Rel: 0.4 }),
    /foldBm25Rel.*must be >= bm25RelFloor/,
  )
  // 等号は OK
  assert.doesNotThrow(() => scoreRelatedness([], { bm25RelFloor: 0.5, foldBm25Rel: 0.5 }))
})

test('9. ランキング: 共起 > kNN 単独 > BM25 単独・グループ内同値は入力順 (stable)', () => {
  const hits = [
    { path: 'notes/bm25-only.md', score_bm25: 80, score_knn: 0 },
    { path: 'notes/knn-only-1.md', score_bm25: 0, score_knn: 0.9 },
    { path: 'notes/both.md', score_bm25: 50, score_knn: 0.91 },
    { path: 'notes/knn-only-2.md', score_bm25: 0, score_knn: 0.9 }, // knn-only-1 と同値 → 入力順
  ]
  const { related } = scoreRelatedness(hits)
  assert.deepEqual(related, [
    'notes/both.md',
    'notes/knn-only-1.md',
    'notes/knn-only-2.md',
    'notes/bm25-only.md',
  ])
})

test('10. relatedMax / foldMax の cap', () => {
  const hits = Array.from({ length: 10 }, (_, i) => ({
    path: `notes/n${i}.md`,
    score_bm25: 100 - i,
    score_knn: 0.9,
  }))
  const r = scoreRelatedness(hits)
  assert.equal(r.related.length, RELATED_MAX)
  assert.equal(r.fold_candidates.length, FOLD_MAX)

  const loose = scoreRelatedness(hits, { relatedMax: 3, foldMax: 1 })
  assert.equal(loose.related.length, 3)
  assert.equal(loose.fold_candidates.length, 1)
})

// 追加サニティ: 純関数性 (入力配列を破壊しない)
test('入力配列を破壊しない (純関数性)', () => {
  const hits = [
    { path: 'notes/a.md', score_bm25: 10, score_knn: 0.5 },
    { path: 'notes/b.md', score_bm25: 100, score_knn: 0.95 },
  ]
  const snapshot = JSON.parse(JSON.stringify(hits))
  scoreRelatedness(hits)
  assert.deepEqual(hits, snapshot)
})

// 追加サニティ: path 欠落 hit を skip する (欠落耐性)
test('path の無い hit は無視する', () => {
  const hits = [
    { score_bm25: 100, score_knn: 0.95 },
    null,
    { path: 'notes/a.md', score_bm25: 50, score_knn: 0.9 },
  ]
  const { related } = scoreRelatedness(hits)
  assert.deepEqual(related, ['notes/a.md'])
})
