import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createElement, html, load, stop } from './harness.ts'

type Files = typeof import('../src/pages/dashboards/editor/files')
type Time = typeof import('../src/pages/dashboards/editor/duration')
type Fixtures = typeof import('../src/components/ft/panels/fixtures')

const files = await load<Files>('pages/dashboards/editor/files.ts')
const time = await load<Time>('pages/dashboards/editor/duration.ts')
const fixtures = await load<Fixtures>('components/ft/panels/fixtures.ts')

type Save = typeof import('../src/pages/dashboards/editor/saveError')
type Notice = typeof import('../src/pages/dashboards/editor/SaveNotice')
type Client = typeof import('../src/auth/client')

const save = await load<Save>('pages/dashboards/editor/saveError.ts')
const notice = await load<Notice>('pages/dashboards/editor/SaveNotice.tsx')
const client = await load<Client>('auth/client.ts')

after(stop)

const valid = { name: 'Checkout', tags: ['prod'], doc: fixtures.FIXTURE_DOC }

const text = (value: unknown): string => JSON.stringify(value)

const refused = (value: unknown): string => {
  const out = files.parseImport(typeof value === 'string' ? value : text(value))
  assert.equal(out.ok, false, 'the file is refused')
  return out.ok ? '' : out.error
}

describe('importing a dashboard file', () => {
  it('accepts an exported dashboard', () => {
    const out = files.parseImport(text(valid))
    assert.equal(out.ok, true)
    if (out.ok) {
      assert.equal(out.file.name, 'Checkout')
      assert.deepEqual(out.file.tags, ['prod'])
      assert.equal(out.file.doc.panels.length, 11)
    }
  })

  it('accepts a file with no tags and an empty document', () => {
    const out = files.parseImport(text({ name: 'Empty', doc: { schema_version: 1, duration: 3600 } }))
    assert.equal(out.ok, true)
    if (out.ok) {
      assert.deepEqual(out.file.tags, [])
      assert.deepEqual(out.file.doc.panels, [])
      assert.deepEqual(out.file.doc.layout, [])
      assert.deepEqual(out.file.doc.variables, [])
    }
  })

  it('keeps only name, tags and doc', () => {
    const out = files.parseImport(text({ ...valid, owner: 'x', id: 'y' }))
    assert.equal(out.ok, true)
    if (out.ok) assert.deepEqual(Object.keys(out.file).sort(), ['doc', 'name', 'tags'])
  })

  it('refuses text that is not JSON', () => {
    assert.match(refused('not json {'), /not valid JSON/i)
    assert.match(refused(''), /not valid JSON|empty/i)
  })

  it('refuses JSON that is not an object', () => {
    for (const value of ['[]', '12', 'null', '"x"']) assert.match(refused(value), /object/i, value)
  })

  it('refuses a missing or empty name, and one over 120 characters', () => {
    assert.match(refused({ doc: valid.doc }), /name/i)
    assert.match(refused({ ...valid, name: '  ' }), /name/i)
    assert.match(refused({ ...valid, name: 5 }), /name/i)
    assert.match(refused({ ...valid, name: 'x'.repeat(121) }), /120/)
  })

  it('refuses tags that are not a list of short distinct strings, at most ten', () => {
    assert.match(refused({ ...valid, tags: 'prod' }), /tags/i)
    assert.match(refused({ ...valid, tags: [1] }), /tags/i)
    assert.match(refused({ ...valid, tags: ['x'.repeat(33)] }), /32/)
    assert.match(refused({ ...valid, tags: Array.from({ length: 11 }, (_, at) => `t${at}`) }), /10 tags/)
  })

  it('refuses a file with no doc', () => {
    assert.match(refused({ name: 'x' }), /doc/i)
    assert.match(refused({ name: 'x', doc: [] }), /doc/i)
  })

  it('refuses a schema_version other than 1', () => {
    assert.match(refused({ ...valid, doc: { ...valid.doc, schema_version: 2 } }), /schema_version 2/)
    assert.match(refused({ ...valid, doc: { ...valid.doc, schema_version: '1' } }), /schema_version/)
    const { schema_version: _unused, ...bare } = valid.doc
    assert.match(refused({ ...valid, doc: bare }), /schema_version/)
  })

  it('refuses a document with more than 30 panels or 20 variables', () => {
    assert.match(refused({ ...valid, doc: { ...valid.doc, panels: Array.from({ length: 31 }, () => valid.doc.panels[0]) } }), /30 panels/)
    assert.match(refused({ ...valid, doc: { ...valid.doc, variables: Array.from({ length: 21 }, () => valid.doc.variables[0]) } }), /20 variables/)
  })

  it('refuses panels, variables or layout that are not lists', () => {
    for (const key of ['panels', 'variables', 'layout']) assert.match(refused({ ...valid, doc: { ...valid.doc, [key]: {} } }), new RegExp(key))
  })

  it('refuses a duration outside one minute to 31 days, or none', () => {
    assert.match(refused({ ...valid, doc: { ...valid.doc, duration: 30 } }), /duration/i)
    assert.match(refused({ ...valid, doc: { ...valid.doc, duration: 31 * 86_400 + 1 } }), /duration/i)
    assert.match(refused({ ...valid, doc: { ...valid.doc, duration: 'x' } }), /duration/i)
    const { duration: _unused, ...bare } = valid.doc
    assert.match(refused({ ...valid, doc: bare }), /duration/i)
  })

  it('refuses a file over 256 KB', () => {
    assert.match(refused(text({ ...valid, doc: { ...valid.doc, panels: [{ ...valid.doc.panels[0], description: 'x'.repeat(300_000) }] } })), /256 KB/)
  })

  it('refuses a panel that is not an object with an id and a kind', () => {
    assert.match(refused({ ...valid, doc: { ...valid.doc, panels: [1] } }), /panel 1/i)
    assert.match(refused({ ...valid, doc: { ...valid.doc, panels: [{ title: 'x' }] } }), /panel 1/i)
  })
})

describe('hostile import files', () => {
  it('refuses a file nested deeper than 32 levels', () => {
    const deep = `{"name":"x","doc":{"schema_version":1,"duration":3600,"panels":[],"extra":${'['.repeat(40)}${']'.repeat(40)}}}`
    assert.match(refused(deep), /nested/i)
  })

  it('refuses an absurdly deep file instead of throwing', () => {
    const deep = `{"name":"x","doc":${'['.repeat(200_000)}${']'.repeat(200_000)}}`
    assert.doesNotThrow(() => files.parseImport(deep))
    assert.equal(files.parseImport(deep).ok, false)
  })

  it('measures nesting without recursing past the limit', () => {
    assert.equal(files.nestingExceeds([[[]]], 3), false)
    assert.equal(files.nestingExceeds([[[[]]]], 3), true)
  })
})

describe('naming the exported file', () => {
  it('slugs the name as the server does', () => {
    assert.equal(files.slugOf('Checkout  Overview!'), 'checkout--overview')
    assert.equal(files.slugOf('---'), 'dashboard')
    assert.equal(files.slugOf(''), 'dashboard')
    assert.equal(files.slugOf('Été'), 't')
    assert.equal(files.fileNameOf('Checkout'), 'checkout.json')
  })

  it('serialises a file for download as pretty JSON', () => {
    const out = files.serialise({ name: 'x', tags: [], doc: { schema_version: 1, variables: [], panels: [], layout: [], duration: 60 } })
    assert.match(out, /\n  "name": "x"/)
    assert.equal(JSON.parse(out).doc.schema_version, 1)
  })
})

describe('durations', () => {
  it('parses seconds, minutes, hours, days and sums', () => {
    assert.equal(time.parseDuration('90s'), 90)
    assert.equal(time.parseDuration('15m'), 900)
    assert.equal(time.parseDuration('6 h'), 21_600)
    assert.equal(time.parseDuration('7d'), 604_800)
    assert.equal(time.parseDuration('1h30m'), 5400)
    assert.equal(time.parseDuration(' 2H '), 7200)
  })

  it('returns nothing for text it cannot read', () => {
    for (const bad of ['', 'x', '90', '1w', '-5m', '1.5h', 'h', '5m5']) assert.equal(time.parseDuration(bad), null, bad)
  })

  it('formats back to the shortest exact spelling', () => {
    assert.equal(time.formatDuration(90), '90 s')
    assert.equal(time.formatDuration(900), '15 m')
    assert.equal(time.formatDuration(3600), '1 h')
    assert.equal(time.formatDuration(5400), '90 m')
    assert.equal(time.formatDuration(86_400), '1 d')
    assert.equal(time.formatDuration(31 * 86_400), '31 d')
    assert.equal(time.formatDuration(86_401), '86401 s')
  })

  it('bounds a duration between 60 seconds and 31 days', () => {
    assert.equal(time.durationIssue(59), 'The default duration is at least one minute.')
    assert.equal(time.durationIssue(60), null)
    assert.equal(time.durationIssue(31 * 86_400), null)
    assert.equal(time.durationIssue(31 * 86_400 + 1), 'The default duration is at most 31 days.')
    assert.match(time.durationIssue(Number.NaN) ?? '', /whole number/)
    assert.match(time.durationIssue(60.5) ?? '', /whole number/)
  })

  it('offers presets that are all in range', () => {
    assert.ok(time.DURATION_PRESETS.length >= 5)
    for (const preset of time.DURATION_PRESETS) assert.equal(time.durationIssue(preset.seconds), null, preset.label)
    assert.deepEqual(time.DURATION_PRESETS.map((preset) => preset.seconds), [...time.DURATION_PRESETS.map((preset) => preset.seconds)].sort((a, b) => a - b))
  })
})

describe('mapping a refused save', () => {
  it('maps a 409 to the name being taken', () => {
    const out = save.describeSave(new client.ApiError(409, 'a dashboard of that name already exists in this project'))
    assert.equal(out.kind, 'name')
    assert.equal(out.message, 'A dashboard with that name already exists in this project.')
  })

  it('maps a 422 to the server reason', () => {
    const out = save.describeSave(new client.ApiError(422, 'a dashboard holds at most 30 panels'))
    assert.equal(out.kind, 'invalid')
    assert.match(out.message, /a dashboard holds at most 30 panels/)
  })

  it('has something to say when a 422 carries no reason', () => {
    assert.match(save.describeSave(new client.ApiError(422, '')).message, /refused/i)
  })

  it('maps 401, 403 and 404 to not being allowed, and says the edit stays here', () => {
    for (const status of [401, 403, 404]) {
      const out = save.describeSave(new client.ApiError(status, ''))
      assert.equal(out.kind, 'forbidden', String(status))
      assert.match(out.message, /not saved|can not|cannot/i)
    }
  })

  it('maps a 503 and anything else to a retry', () => {
    assert.equal(save.describeSave(new client.ApiError(503, '')).kind, 'unavailable')
    assert.equal(save.describeSave(new client.ApiError(500, 'boom')).kind, 'other')
  })

  it('maps a network failure to a retry that keeps the changes', () => {
    const out = save.describeSave(new TypeError('Failed to fetch'))
    assert.equal(out.kind, 'network')
    assert.match(out.message, /still here/i)
  })

  it('only the failures that mean no write access hide the Edit button', () => {
    assert.equal(save.cannotWrite(save.describeSave(new client.ApiError(404, ''))), true)
    assert.equal(save.cannotWrite(save.describeSave(new client.ApiError(401, ''))), true)
    assert.equal(save.cannotWrite(save.describeSave(new client.ApiError(409, ''))), false)
    assert.equal(save.cannotWrite(save.describeSave(new client.ApiError(422, 'x'))), false)
  })

  it('shows a 409 next to the name and a 422 as the reason, both as alerts', () => {
    const taken = html(createElement(notice.SaveNotice, { failure: save.describeSave(new client.ApiError(409, '')) }))
    assert.match(taken, /role="alert"/)
    assert.match(taken, /A dashboard with that name already exists in this project\./)
    assert.match(taken, /data-failure="name"/)
    const invalid = html(createElement(notice.SaveNotice, { failure: save.describeSave(new client.ApiError(422, 'panel `a` appears twice')) }))
    assert.match(invalid, /data-failure="invalid"/)
    assert.match(invalid, /panel `a` appears twice/)
  })

  it('shows nothing when nothing failed', () => {
    assert.equal(html(createElement(notice.SaveNotice, { failure: null })), '')
  })
})
