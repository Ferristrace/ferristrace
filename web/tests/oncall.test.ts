import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gaps, place } from '../src/pages/oncall/timeline.ts'

test('@spec-l19-8 shifts are placed as fractions of the window and clipped to it', () => {
  const placed = place([{ from_ms: 0, to_ms: 50 }, { from_ms: 50, to_ms: 150 }, { from_ms: 200, to_ms: 300 }], 0, 100)
  assert.deepEqual(placed.map((one) => [one.left, one.width]), [[0, 0.5], [0.5, 0.5]])
})

test('@spec-l19-8 the gaps are the stretches nobody covers', () => {
  assert.deepEqual(gaps([{ from_ms: 10, to_ms: 40 }, { from_ms: 60, to_ms: 100 }], 0, 100), [{ from_ms: 0, to_ms: 10 }, { from_ms: 40, to_ms: 60 }])
  assert.deepEqual(gaps([], 0, 100), [{ from_ms: 0, to_ms: 100 }])
  assert.deepEqual(gaps([{ from_ms: 0, to_ms: 100 }], 0, 100), [])
})
