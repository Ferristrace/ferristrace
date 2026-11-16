import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sorted, toggled } from '../src/lib/sorting.ts'

type Row = { name: string; rate: number | null }
const rows: Row[] = [{ name: 'b', rate: 2 }, { name: 'a10', rate: null }, { name: 'a2', rate: 5 }, { name: 'c', rate: 2 }]
const value = (row: Row, key: 'name' | 'rate') => row[key]

test('@spec-l19-4 sortable headers order rows, keep ties stable and put missing values last', () => {
  assert.deepEqual(sorted(rows, { key: 'rate', dir: 'desc' }, value).map((r) => r.name), ['a2', 'b', 'c', 'a10'])
  assert.deepEqual(sorted(rows, { key: 'rate', dir: 'asc' }, value).map((r) => r.name), ['b', 'c', 'a2', 'a10'])
  assert.deepEqual(sorted(rows, { key: 'name', dir: 'asc' }, value).map((r) => r.name), ['a2', 'a10', 'b', 'c'])
  assert.deepEqual(sorted(rows, null, value), rows)
})

test('@spec-l19-4 clicking a header sorts by it, clicking again flips the direction', () => {
  assert.deepEqual(toggled(null, 'rate'), { key: 'rate', dir: 'desc' })
  assert.deepEqual(toggled({ key: 'rate', dir: 'desc' }, 'rate'), { key: 'rate', dir: 'asc' })
  assert.deepEqual(toggled({ key: 'rate', dir: 'asc' }, 'name', 'asc'), { key: 'name', dir: 'asc' })
})
