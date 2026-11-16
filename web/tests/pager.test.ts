import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageNumbers, pagesOf } from '../src/lib/paging.ts'

test('@spec-l19-4 the pager counts pages and elides the middle', () => {
  assert.equal(pagesOf(0, 10), 1)
  assert.equal(pagesOf(48, 10), 5)
  assert.deepEqual(pageNumbers(1, 5), [1, 2, 3, 4, 5])
  assert.deepEqual(pageNumbers(1, 42), [1, 2, null, 42])
  assert.deepEqual(pageNumbers(20, 42), [1, null, 19, 20, 21, null, 42])
  assert.deepEqual(pageNumbers(42, 42), [1, null, 41, 42])
})
