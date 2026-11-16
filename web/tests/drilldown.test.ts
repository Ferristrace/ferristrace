import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { load, stop } from './harness.ts'

const d = await load<typeof import('../src/components/ft/panels/drilldown')>('components/ft/panels/drilldown.ts')
const v = await load<typeof import('../src/pages/dashboards/variables')>('pages/dashboards/variables.ts')
const l = await load<typeof import('../src/pages/dashboards/layout')>('pages/dashboards/layout.ts')
const b = await load<typeof import('../src/lib/bounds')>('lib/bounds.ts')
const fx = await load<typeof import('../src/components/ft/panels/fixtures')>('components/ft/panels/fixtures.ts')

type Query = import('../src/data/dashboards').QueryDoc

after(stop)

const plain = (value: unknown) => JSON.parse(JSON.stringify(value))

const base: Query = { name: 'q', signal: 'traces', aggregations: [{ function: 'count' }], step: 'auto' }

describe('drilldown', () => {
  it('opens traces with the panel filter, the group value and the range', () => {
    const query: Query = { ...base, filter: { field: 'status', op: 'eq', value: 'error' }, group_by: [{ field: 'service' }] }
    const target = d.drillTarget({ query, labels: { service: 'checkout' }, variables: {}, fromMs: 1000, toMs: 61000 })
    assert.deepEqual(target, { to: '/traces', search: { from: '1000', to: '61000', q: 'status = error AND service = checkout' } })
  })

  it('opens logs for a logs query', () => {
    const query: Query = { ...base, signal: 'logs', filter: { field: 'severity', op: 'eq', value: 'error' } }
    const target = d.drillTarget({ query, labels: {}, variables: {}, fromMs: 1, toMs: 2 })
    assert.equal(target?.to, '/logs')
    assert.equal(target?.search.q, 'severity = error')
  })

  it('leaves out q when nothing filters', () => {
    const target = d.drillTarget({ query: base, labels: {}, variables: {}, fromMs: 1, toMs: 2 })
    assert.deepEqual(target, { to: '/traces', search: { from: '1', to: '2' } })
  })

  it('reads a group on a custom key as an attribute and a number as a number', () => {
    const query: Query = { ...base, group_by: [{ attr: 'region' }, { field: 'http_status_code' }] }
    const target = d.drillTarget({ query, labels: { region: 'eu west', http_status_code: '503' }, variables: {}, fromMs: 1, toMs: 2 })
    assert.equal(target?.search.q, 'region = "eu west" AND http_status_code = 503')
  })

  it('ignores the query tag a merged panel adds', () => {
    const target = d.drillTarget({ query: base, labels: { __query: 'rate', service: 'a' }, variables: {}, fromMs: 1, toMs: 2 })
    assert.equal(target?.search.q, 'service = a')
  })

  it('fills a variable with the chosen values and drops it when none are chosen', () => {
    const query: Query = { ...base, filter: { all: [{ field: 'service', op: 'eq', value: { var: 'service' } }, { field: 'status', op: 'eq', value: 'error' }] } }
    const one = d.drillTarget({ query, labels: {}, variables: { service: ['a'] }, fromMs: 1, toMs: 2 })
    assert.equal(one?.search.q, 'service = a AND status = error')
    const several = d.drillTarget({ query, labels: {}, variables: { service: ['a', 'b'] }, fromMs: 1, toMs: 2 })
    assert.equal(several?.search.q, 'service IN (a, b) AND status = error')
    const all = d.drillTarget({ query, labels: {}, variables: {}, fromMs: 1, toMs: 2 })
    assert.equal(all?.search.q, 'status = error')
  })

  it('quotes a variable value so it cannot change the filter', () => {
    const query: Query = { ...base, filter: { field: 'name', op: 'eq', value: { var: 'route' } } }
    const target = d.drillTarget({ query, labels: {}, variables: { route: ['x") OR (service = "y'] }, fromMs: 1, toMs: 2 })
    assert.equal(target?.search.q, 'name = "x\\") OR (service = \\"y"')
  })

  it('opens the metrics explorer with the metric, the labels and the range', () => {
    const query: Query = {
      name: 'mem',
      signal: 'metrics',
      aggregations: [{ metric: 'k8s.node.memory.usage', time: 'avg', space: 'sum' }],
      group_by: [{ attr: 'k8s.node.name' }],
      step: 'auto',
    }
    const target = d.drillTarget({ query, labels: { 'k8s.node.name': 'node-1' }, variables: {}, fromMs: 5, toMs: 9 })
    assert.equal(target?.to, '/metrics')
    const f = new URLSearchParams(target?.search.f)
    assert.equal(f.get('metric'), 'k8s.node.memory.usage')
    assert.deepEqual(f.getAll('by'), ['k8s.node.name'])
    assert.equal(f.get('from'), '5')
    assert.equal(f.get('to'), '9')
    assert.equal(f.get('w'), 'k8s.node.name = node-1')
  })

  it('gives no target for a metrics query without a metric', () => {
    assert.equal(d.drillTarget({ query: { ...base, signal: 'metrics' }, labels: {}, variables: {}, fromMs: 1, toMs: 2 }), null)
  })

  it('drops an or-group holding an unset variable, since it could match anything', () => {
    const filter = { any: [{ field: 'service' as const, op: 'eq' as const, value: { var: 'service' } }, { field: 'status' as const, op: 'eq' as const, value: 'error' }] }
    assert.equal(d.resolveFilter(filter, {}), null)
  })
})

describe('variables', () => {
  const variables = [
    { name: 'env', label: 'Environment', source: { kind: 'static' as const, values: ['prod', 'dev'] }, multi: false, all: false },
    { name: 'service', label: 'Service', source: { kind: 'attribute' as const, signal: 'traces' as const, key: 'service' }, multi: true, all: true },
  ]

  it('defaults to the first static value, or All where allowed', () => {
    assert.deepEqual(v.choiceOf(variables[0], {}), { values: ['prod'] })
    assert.deepEqual(v.choiceOf(variables[1], {}), { all: true })
  })

  it('round-trips the choice through the address', () => {
    const chosen = { env: { values: ['dev'] }, service: { values: ['a b', 'c&d'] } }
    assert.deepEqual(plain(v.decodeVars(v.encodeVars(chosen))), chosen)
    assert.deepEqual(plain(v.decodeVars(v.encodeVars({ service: { all: true } }))), { service: { all: true } })
    assert.equal(v.encodeVars({}), undefined)
  })

  it('sends only chosen values, and none for All', () => {
    assert.deepEqual(plain(v.sentVariables(variables, {})), { env: ['prod'] })
    assert.deepEqual(plain(v.sentVariables(variables, { service: { values: ['a', 'b'] }, env: { values: ['dev', 'prod'] } })), { env: ['dev'], service: ['a', 'b'] })
  })

  it('sends a query only the variables its filter uses', () => {
    const query: Query = { ...base, filter: { field: 'service', op: 'in', value: [{ var: 'service' }] } }
    assert.deepEqual(plain(v.variablesFor(query, { env: ['prod'], service: ['a'] })), { service: ['a'] })
    assert.deepEqual(v.usedVariables({ not: { all: [{ attr: 'x', op: 'eq', value: { var: 'env' } }] } }), ['env'])
  })
})

describe('layout', () => {
  it('orders panels by row then column and appends unplaced ones', () => {
    const doc = {
      ...fx.FIXTURE_DOC,
      panels: [...fx.FIXTURE_DOC.panels, { id: 'extra', kind: 'text' as const, title: '', description: '', queries: [], options: {} }],
    }
    const out = l.placed(doc)
    assert.equal(out.length, 12)
    assert.equal(out[0].panel.id, 'requests')
    assert.equal(out[11].panel.id, 'extra')
    assert.deepEqual([out[11].x, out[11].w, out[11].y], [0, 12, 25])
  })

  it('keeps a panel inside the twelve columns', () => {
    const doc = { ...fx.FIXTURE_DOC, panels: [fx.FIXTURE_DOC.panels[0]], layout: [{ panel: 'requests', x: 10, y: 0, w: 9, h: 0 }] }
    const [only] = l.placed(doc)
    assert.deepEqual([only.x, only.w, only.h], [10, 2, 1])
  })
})

describe('review fixes', () => {
  it('resolves a group label against the query group_by, attribute or built-in', () => {
    const asAttr: Query = { ...base, group_by: [{ attr: 'status' }] }
    assert.equal(d.drillTarget({ query: asAttr, labels: { status: 'x' }, variables: {}, fromMs: 1, toMs: 2 })?.search.q, '"status" = x')
    const chips = d.labelChips({ status: 'x' }, asAttr)
    assert.deepEqual(chips[0], { field: { attr: 'status' }, op: 'eq', value: 'x' })
    const asBuilt = d.labelChips({ status: 'x' }, { ...base, group_by: [{ field: 'status' }] })
    assert.deepEqual(asBuilt[0], { field: { built: 'status' }, op: 'eq', value: 'x' })
  })

  it('ors contains clauses, ands not_contains, and never emits an empty list', () => {
    const contains: Query = { ...base, filter: { field: 'name', op: 'contains', value: { var: 'r' } } }
    assert.equal(d.drillTarget({ query: contains, labels: {}, variables: { r: ['a', 'b'] }, fromMs: 1, toMs: 2 })?.search.q, 'name CONTAINS a OR name CONTAINS b')
    const not: Query = { ...base, filter: { field: 'name', op: 'not_contains', value: { var: 'r' } } }
    assert.equal(d.drillTarget({ query: not, labels: {}, variables: { r: ['a', 'b'] }, fromMs: 1, toMs: 2 })?.search.q, 'name NOT CONTAINS a AND name NOT CONTAINS b')
    const empty: Query = { ...base, filter: { field: 'service', op: 'in', value: [] } }
    assert.equal(d.drillTarget({ query: empty, labels: {}, variables: {}, fromMs: 1, toMs: 2 })?.search.q, undefined)
    const single: Query = { ...base, filter: { field: 'service', op: 'in', value: { var: 'r' } } }
    assert.equal(d.drillTarget({ query: single, labels: {}, variables: { r: ['a'] }, fromMs: 1, toMs: 2 })?.search.q, 'service IN (a)')
  })

  it('treats a variable named like an Object.prototype member as an ordinary name', () => {
    const query: Query = { ...base, filter: { field: 'service', op: 'eq', value: { var: 'constructor' } } }
    assert.equal(d.drillTarget({ query, labels: {}, variables: {}, fromMs: 1, toMs: 2 })?.search.q, undefined)
    const sent = JSON.parse(JSON.stringify({ constructor: ['x'] }))
    assert.equal(d.drillTarget({ query, labels: {}, variables: sent, fromMs: 1, toMs: 2 })?.search.q, 'service = x')
  })

  it('refuses reserved variable names in the address and keeps the prototype intact', () => {
    const chosen = v.decodeVars('v.__proto__=x&v.constructor=y&all=prototype&v.env=dev&all=__proto__')
    assert.deepEqual(Object.keys(chosen), ['env'])
    assert.equal(Object.getPrototypeOf(chosen), null)
    assert.equal(({} as Record<string, unknown>).x, undefined)
    assert.equal(Object.hasOwn(Object.prototype, 'x'), false)
    assert.deepEqual(v.choiceOf({ name: 'constructor', label: '', source: { kind: 'static', values: ['a'] }, multi: false, all: false }, chosen), { values: ['a'] })
    assert.deepEqual(v.choiceOf({ name: 'toString', label: '', source: { kind: 'static', values: [] }, multi: false, all: true }, chosen), { all: true })
  })

  it('sends a variable named constructor like any other', () => {
    const variable = { name: 'constructor', label: '', source: { kind: 'static' as const, values: ['a', 'b'] }, multi: true, all: false }
    const sent = v.sentVariables([variable], { constructor: { values: ['b'] } })
    assert.deepEqual(JSON.parse(JSON.stringify(sent)), { constructor: ['b'] })
    const query: Query = { ...base, filter: { field: 'service', op: 'eq', value: { var: 'constructor' } } }
    assert.deepEqual(JSON.parse(JSON.stringify(v.variablesFor(query, sent))), { constructor: ['b'] })
  })

  it('rejects addresses beyond the year 2100 and keeps sane ones', () => {
    assert.equal(b.asMs('1e300'), null)
    assert.equal(b.asMs('9007199254740991'), null)
    assert.equal(b.asMs(String(b.MAX_MS + 1)), null)
    assert.equal(b.asMs('1700000000000'), 1700000000000)
    assert.equal(b.asMs('Infinity'), null)
  })
})
