import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { load, stop } from './harness.ts'

const model = await load<typeof import('../src/components/ft/datatable/model')>('components/ft/datatable/model.ts')
const spark = await load<typeof import('../src/components/ft/datatable/sparkGeometry')>('components/ft/datatable/sparkGeometry.ts')
const services = await load<typeof import('../src/lib/serviceRows')>('lib/serviceRows.ts')

after(stop)

type Row = { id: string; svc: string; ms: number | null; note: string }

const rows: Row[] = [
  { id: 'a', svc: 'checkout', ms: 2410, note: 'POST /checkout' },
  { id: 'b', svc: 'payments', ms: 120, note: 'POST /pay' },
  { id: 'c', svc: 'checkout', ms: 980, note: 'GET /cart' },
  { id: 'd', svc: 'orders', ms: null, note: 'GET /orders' },
]

const columns: import('../src/components/ft/datatable/model').ColumnModel<Row>[] = [
  { id: 'note', header: 'Root operation', hideable: false, sort: (r) => r.note, firstDir: 'asc' },
  { id: 'svc', header: 'Service', sort: (r) => r.svc, filter: { kind: 'values', value: (r) => r.svc } },
  { id: 'ms', header: 'Duration', sort: (r) => r.ms, filter: { kind: 'number', unit: 'ms', presets: [100, 500, 1000], format: model.formatMs, value: (r) => r.ms } },
  { id: 'id', header: 'Trace ID', text: (r) => r.id },
]

const ids = (list: Row[]) => list.map((r) => r.id)

describe('data table', () => {
  it('@spec-l22-2 a checklist filter keeps rows whose value is ticked, a duration filter compares with the operator', () => {
    assert.deepEqual(ids(model.filterRows(rows, columns, [{ column: 'svc', kind: 'values', values: ['checkout', 'orders'] }], '')), ['a', 'c', 'd'])
    assert.deepEqual(ids(model.filterRows(rows, columns, [{ column: 'ms', kind: 'number', op: 'above', value: 500 }], '')), ['a', 'c'])
    assert.deepEqual(ids(model.filterRows(rows, columns, [{ column: 'ms', kind: 'number', op: 'below', value: 500 }], '')), ['b'])
    assert.deepEqual(ids(model.filterRows(rows, columns, [{ column: 'svc', kind: 'values', values: ['checkout'] }, { column: 'ms', kind: 'number', op: 'above', value: 1000 }], '')), ['a'])
  })

  it('@spec-l22-2 the search reads every column, ignoring case', () => {
    assert.deepEqual(ids(model.filterRows(rows, columns, [], 'CART')), ['c'])
    assert.deepEqual(ids(model.filterRows(rows, columns, [], ' d ')), ['d'])
    assert.deepEqual(ids(model.filterRows(rows, columns, [], '')), ['a', 'b', 'c', 'd'])
  })

  it('@spec-l22-2 the checklist offers the values of the loaded rows with their counts', () => {
    const def = columns[1].filter
    assert.ok(def?.kind === 'values')
    assert.deepEqual(model.valueCounts(rows, def), [{ value: 'checkout', count: 2 }, { value: 'orders', count: 1 }, { value: 'payments', count: 1 }])
  })

  it('@spec-l22-2 one filter per column, an empty checklist removes it, chips read like the board', () => {
    let filters = model.withFilter([], { column: 'svc', kind: 'values', values: ['checkout'] })
    filters = model.withFilter(filters, { column: 'ms', kind: 'number', op: 'above', value: 500 })
    filters = model.withFilter(filters, { column: 'svc', kind: 'values', values: ['checkout', 'payments'] })
    assert.equal(filters.length, 2)
    assert.equal(filters[0].column, 'svc')
    assert.deepEqual(model.filterLabel(filters[0], columns[1]), { field: 'Service', text: 'is checkout, payments' })
    assert.deepEqual(model.filterLabel(filters[1], columns[2]), { field: 'Duration', text: '> 500 ms' })
    assert.deepEqual(model.filterLabel({ column: 'ms', kind: 'number', op: 'below', value: 1500 }, columns[2]), { field: 'Duration', text: '< 1.5 s' })
    assert.deepEqual(model.withFilter(filters, { column: 'svc', kind: 'values', values: [] }).map((f) => f.column), ['ms'])
    assert.deepEqual(model.withoutFilter(filters, 'ms').map((f) => f.column), ['svc'])
  })

  it('@spec-l22-2 headers sort the rows, missing values last, a second click flips', () => {
    assert.deepEqual(ids(model.sortRows(rows, columns, { key: 'ms', dir: 'desc' })), ['a', 'c', 'b', 'd'])
    assert.deepEqual(ids(model.sortRows(rows, columns, { key: 'ms', dir: 'asc' })), ['b', 'c', 'a', 'd'])
    assert.deepEqual(ids(model.sortRows(rows, columns, null)), ['a', 'b', 'c', 'd'])
    assert.deepEqual(ids(model.sortRows(rows, columns, { key: 'id', dir: 'asc' })), ['a', 'b', 'c', 'd'])
    assert.deepEqual(model.nextSorting(null, columns[0]), { key: 'note', dir: 'asc' })
    assert.deepEqual(model.nextSorting({ key: 'ms', dir: 'desc' }, columns[2]), { key: 'ms', dir: 'asc' })
  })

  it('@spec-l22-2 columns can be hidden except the fixed ones, and the stored choice is checked', () => {
    const visible = model.defaultVisible(columns, ['svc', 'ms'])
    assert.deepEqual(visible, ['note', 'svc', 'ms'])
    assert.deepEqual(model.visibleColumns(columns, ['svc']).map((c) => c.id), ['note', 'svc'])
    assert.deepEqual(model.toggledColumn(['note', 'svc'], 'svc', false), ['note'])
    assert.deepEqual(model.toggledColumn(['note'], 'id', true), ['note', 'id'])
    assert.deepEqual(model.storedVisible('["svc","gone",3]', ['note', 'svc', 'ms']), ['svc'])
    assert.equal(model.storedVisible('not json', ['svc']), null)
    assert.equal(model.storedVisible('[]', ['svc']), null)
    assert.equal(model.storedVisible(null, ['svc']), null)
  })

  it('@spec-l22-2 CSV export quotes fields as RFC 4180 and lines end with CRLF', () => {
    assert.equal(model.csvField('plain'), 'plain')
    assert.equal(model.csvField('a,b'), '"a,b"')
    assert.equal(model.csvField('say "hi"'), '"say ""hi"""')
    assert.equal(model.csvField('two\nlines'), '"two\nlines"')
    assert.equal(model.csvField(' padded'), '" padded"')
    assert.equal(model.csvField(null), '')
    assert.equal(model.csvField(12.5), '12.5')
    const csv = model.csvOf([{ id: 'x', svc: 'a,b', ms: 3, note: 'GET "/"' }], columns)
    assert.equal(csv, 'Root operation,Service,Duration,Trace ID\r\n"GET ""/""","a,b",3,x\r\n')
  })

  it('@spec-l22-2 the header box selects the page, shows partial selection, and a second click clears it', () => {
    const page = ['a', 'b', 'c']
    assert.equal(model.selectionOf(page, new Set()), 'none')
    assert.equal(model.selectionOf(page, new Set(['a'])), 'some')
    assert.equal(model.selectionOf(page, new Set(['a', 'b', 'c', 'z'])), 'all')
    assert.deepEqual([...model.toggledAll(page, new Set(['a', 'z']))].sort(), ['a', 'b', 'c', 'z'])
    assert.deepEqual([...model.toggledAll(page, new Set(['a', 'b', 'c', 'z']))], ['z'])
    assert.deepEqual([...model.toggledOne(new Set(['a']), 'a')], [])
    assert.deepEqual([...model.toggledOne(new Set(['a']), 'b')], ['a', 'b'])
    assert.deepEqual([...model.kept(new Set(['a', 'gone']), ['a', 'b'])], ['a'])
  })

  it('@spec-l22-2 pages slice the rows and clamp the page number', () => {
    const many = Array.from({ length: 23 }, (_, i) => i)
    assert.deepEqual(model.pageOf(many, 1, 10), { rows: many.slice(0, 10), page: 1, pages: 3 })
    assert.deepEqual(model.pageOf(many, 3, 10).rows, [20, 21, 22])
    assert.equal(model.pageOf(many, 9, 10).page, 3)
    assert.equal(model.pageOf(many, 0, 10).page, 1)
    assert.deepEqual(model.pageOf([], 2, 10), { rows: [], page: 1, pages: 1 })
  })

  it('@spec-l22-2 chart cells scale to their box and hover picks the nearest point', () => {
    const spots = spark.spotsOf([0, 5, 10], 100, 20, 0)
    assert.deepEqual(spots.map((s) => [s.x, s.y]), [[0, 20], [50, 10], [100, 0]])
    assert.equal(spark.spotsOf([null, null], 100, 20).length, 0)
    assert.equal(spark.linePath(spots), 'M0.0 20.0 L50.0 10.0 L100.0 0.0')
    const bars = spark.barsOf([0, 10], 20, 10, 0)
    assert.deepEqual(bars.map((b) => [b.x, b.height]), [[0, 1], [10, 10]])
    assert.equal(spark.indexAt(0.49, 3), 1)
    assert.equal(spark.indexAt(2, 3), 2)
    assert.equal(spark.bucketAt(0.99, 4), 3)
    assert.equal(spark.bucketAt(0.5, 0), -1)
  })
})

describe('services table', () => {
  it('@spec-l22-2 status comes from the error-rate threshold and its critical factor', () => {
    assert.equal(services.healthOf(null, 2, 3), null)
    assert.equal(services.healthOf(0.4, 2, 3), 'healthy')
    assert.equal(services.healthOf(2, 2, 3), 'degraded')
    assert.equal(services.healthOf(6, 2, 3), 'down')
  })

  it('@spec-l22-2 the release shown is the one seen last for each service', () => {
    const found = services.latestReleases([
      { service: 'api', version: 'v1', firstSeenMs: 1, lastSeenMs: 10 },
      { service: 'api', version: 'v2', firstSeenMs: 5, lastSeenMs: 20 },
      { service: 'web', version: 'w1', firstSeenMs: 1, lastSeenMs: 9 },
      { service: 'web', version: 'w2', firstSeenMs: 3, lastSeenMs: 9 },
    ])
    assert.deepEqual([...found], [['api', 'v2'], ['web', 'w2']])
  })

  it('@spec-l22-2 the error-rate change is shown in points only when both windows have traffic', () => {
    assert.equal(services.deltaOf(15.7, 1.8), 13.9)
    assert.equal(services.deltaOf(1, null), null)
    assert.equal(services.deltaOf(null, 1), null)
    assert.equal(services.deltaOf(1.02, 1), null)
    assert.equal(services.deltaText(13.9), '▲ +13.9 pt')
    assert.equal(services.deltaText(-2), '▼ -2.0 pt')
  })

  it('@spec-l22-2 added chart columns are read back safely and never twice', () => {
    assert.deepEqual(services.storedCharts('[{"metric":"p99","style":"bars"},{"metric":"p99","style":"bars"},{"metric":"nope","style":"line"}]'), [{ metric: 'p99', style: 'bars' }])
    assert.deepEqual(services.storedCharts('{'), [])
    assert.equal(services.withChart([{ metric: 'p99', style: 'bars' }], { metric: 'p99', style: 'bars' }).length, 1)
    assert.equal(services.withChart([], { metric: 'err', style: 'line' }).length, 1)
    assert.equal(services.chartId({ metric: 'err', style: 'line' }), 'chart:err:line')
  })
})
