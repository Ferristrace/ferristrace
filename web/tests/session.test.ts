import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { load, stop } from './harness.ts'

type Session = typeof import('../src/pages/dashboards/editor/session')

const session = await load<Session>('pages/dashboards/editor/session.ts')

after(stop)

describe('detecting a save over someone else', () => {
  it('is a conflict when the server version moved', () => {
    assert.equal(session.hasConflict(10, 11), true)
  })

  it('is not when the versions match, or when the base has none', () => {
    assert.equal(session.hasConflict(10, 10), false)
    assert.equal(session.hasConflict(undefined, 10), false)
  })
})
