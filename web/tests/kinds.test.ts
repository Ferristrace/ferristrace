import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { load, stop } from './harness.ts'

type Kinds = typeof import('../src/pages/dashboards/editor/kinds')
type Dash = typeof import('../src/data/dashboards')
type Panel = import('../src/data/dashboards').PanelDoc
type Query = import('../src/data/dashboards').QueryDoc

const kinds = await load<Kinds>('pages/dashboards/editor/kinds.ts')
const dash = await load<Dash>('data/dashboards.ts')

after(stop)

const rich: Panel = {
  id: 'rich',
  title: 'Rich',
  description: '',
  kind: 'time_series',
  queries: [
    {
      name: 'a',
      signal: 'traces',
      aggregations: [{ function: 'count' }],
      filter: { field: 'service', op: 'eq', value: 'checkout' },
      group_by: [{ field: 'service' }, { field: 'status' }, { attr: 'http.route' }],
      order: { by: { aggregation: 0 }, direction: 'desc' },
      limit: 50,
      step: { fixed: 30 },
    },
  ],
  options: { unit: 'req', legend: 'right', stacked: true },
}

const converted = (kind: Panel['kind'], from: Panel = rich): Panel => kinds.changeKind(from, kind)

const first = (panel: Panel): Query => {
  const [query] = panel.queries
  assert.ok(query, 'the panel keeps a query')
  return query
}

describe('the picker catalogue', () => {
  it('groups the eleven kinds as SigNoz does', () => {
    assert.deepEqual(kinds.KIND_GROUPS.map((group) => group.label), ['Trends over time', 'Compare & rank', 'Distributions', 'Single values', 'Raw records', 'Documentation'])
    assert.deepEqual(kinds.KIND_GROUPS.map((group) => group.kinds), [['time_series', 'area'], ['bar', 'pie', 'scatter'], ['histogram', 'heatmap'], ['number'], ['table', 'list'], ['text']])
  })

  it('names and describes every kind', () => {
    for (const kind of dash.PANEL_KINDS) {
      assert.ok(kinds.KIND_INFO[kind].name.length > 0)
      assert.ok(kinds.KIND_INFO[kind].description.length > 10)
    }
    assert.equal(kinds.KIND_INFO.time_series.name, 'Time Series')
    assert.equal(kinds.KIND_INFO.scatter.name, 'Scatter Plot')
  })

  it('finds kinds by name, description or group, and by group chip', () => {
    assert.deepEqual(kinds.searchKinds('pie', null), ['pie'])
    assert.deepEqual(kinds.searchKinds('  AREA ', null), ['area'])
    assert.ok(kinds.searchKinds('over time', null).includes('time_series'))
    assert.deepEqual(kinds.searchKinds('', 'raw'), ['table', 'list'])
    assert.deepEqual(kinds.searchKinds('zzzz', null), [])
    assert.deepEqual(kinds.searchKinds('table', 'trends'), [])
    assert.equal(kinds.searchKinds('', null).length, 11)
  })
})

describe('changing the panel kind keeps the shape rule', () => {
  it('time series keeps a timed step and its grouping', () => {
    const out = converted('time_series')
    assert.deepEqual(first(out).step, { fixed: 30 })
    assert.equal(first(out).group_by?.length, 3)
    assert.deepEqual(kinds.panelIssues(out), [])
  })

  it('area keeps a timed step', () => {
    const out = converted('area')
    assert.deepEqual(first(out).step, { fixed: 30 })
    assert.deepEqual(kinds.panelIssues(out), [])
  })

  it('bar needs a timed step, so a total step becomes auto', () => {
    const total = converted('table')
    assert.equal(first(total).step, 'total')
    const out = converted('bar', total)
    assert.equal(first(out).step, 'auto')
    assert.deepEqual(kinds.panelIssues(out), [])
  })

  it('pie needs a total step and may group', () => {
    const out = converted('pie')
    assert.equal(first(out).step, 'total')
    assert.equal(first(out).group_by?.length, 3)
    assert.deepEqual(kinds.panelIssues(out), [])
  })

  it('scatter needs a total step, two aggregations and at most one group by', () => {
    const out = converted('scatter')
    assert.equal(first(out).step, 'total')
    assert.ok(first(out).aggregations.length >= 2)
    assert.equal(first(out).group_by?.length, 1)
    assert.deepEqual(first(out).group_by, [{ field: 'service' }])
    assert.deepEqual(kinds.panelIssues(out), [])
  })

  it('histogram needs a total step, no group by and a field aggregation', () => {
    const out = converted('histogram')
    assert.equal(first(out).step, 'total')
    assert.deepEqual(first(out).group_by, [])
    assert.deepEqual(first(out).aggregations[0], { function: 'avg', field: { field: 'duration' } })
    assert.equal(first(out).order, null)
    assert.deepEqual(kinds.panelIssues(out), [])
  })

  it('heatmap needs a timed step, no group by and a field aggregation', () => {
    const out = converted('heatmap')
    assert.deepEqual(first(out).step, { fixed: 30 })
    assert.deepEqual(first(out).group_by, [])
    assert.deepEqual(first(out).aggregations[0], { function: 'avg', field: { field: 'duration' } })
    assert.deepEqual(kinds.panelIssues(out), [])
  })

  it('heatmap from a total step becomes auto', () => {
    const out = converted('heatmap', converted('pie'))
    assert.equal(first(out).step, 'auto')
    assert.deepEqual(kinds.panelIssues(out), [])
  })

  it('number needs a total step and no group by', () => {
    const out = converted('number')
    assert.equal(first(out).step, 'total')
    assert.deepEqual(first(out).group_by, [])
    assert.equal(first(out).order, null)
    assert.deepEqual(kinds.panelIssues(out), [])
  })

  it('table needs a total step and may group', () => {
    const out = converted('table')
    assert.equal(first(out).step, 'total')
    assert.equal(first(out).group_by?.length, 3)
    assert.deepEqual(kinds.panelIssues(out), [])
  })

  it('list needs a total step', () => {
    const out = converted('list')
    assert.equal(first(out).step, 'total')
    assert.deepEqual(kinds.panelIssues(out), [])
  })

  it('text has no queries', () => {
    const out = converted('text')
    assert.deepEqual(out.queries, [])
    assert.deepEqual(kinds.panelIssues(out), [])
  })

  it('a text panel given a kind with queries gets a default query', () => {
    const out = converted('time_series', converted('text'))
    assert.equal(out.queries.length, 1)
    assert.deepEqual(kinds.panelIssues(out), [])
  })

  it('keeps title, id and options', () => {
    const out = converted('pie')
    assert.equal(out.id, 'rich')
    assert.equal(out.title, 'Rich')
    assert.equal(out.options.unit, 'req')
  })

  it('does not change the panel it was given', () => {
    const before = JSON.stringify(rich)
    converted('histogram')
    assert.equal(JSON.stringify(rich), before)
  })

  it('every kind from every kind leaves no issue', () => {
    for (const from of dash.PANEL_KINDS) {
      const start = converted(from)
      for (const to of dash.PANEL_KINDS) assert.deepEqual(kinds.panelIssues(converted(to, start)), [], `${from} to ${to}`)
    }
  })

  it('a logs panel that needs a field asks for one instead of guessing', () => {
    const logs = kinds.changeKind({ ...rich, queries: [{ ...first(rich), signal: 'logs', group_by: [], filter: null }] }, 'histogram')
    assert.ok(kinds.panelIssues(logs).some((issue) => /field/i.test(issue)))
  })

  it('a metrics panel keeps its metric aggregation', () => {
    const metric: Panel = { ...rich, queries: [{ ...first(rich), signal: 'metrics', aggregations: [{ metric: 'node_memory', time: 'avg', space: 'avg' }], filter: null, group_by: [{ attr: 'node' }] }] }
    const out = kinds.changeKind(metric, 'histogram')
    assert.deepEqual(first(out).aggregations[0], { metric: 'node_memory', time: 'avg', space: 'avg' })
    assert.deepEqual(kinds.panelIssues(out), [])
    const pairs = kinds.changeKind(metric, 'scatter')
    assert.equal(first(pairs).aggregations.length, 2)
    assert.deepEqual(kinds.panelIssues(pairs), [])
  })
})

describe('an inline message when a setting is not allowed for the kind', () => {
  const query = (kind: Panel['kind'], changes: Partial<Query>): string[] => kinds.queryIssues(kind, { ...first(converted(kind)), ...changes })

  it('number refuses a timed step', () => {
    assert.match(query('number', { step: 'auto' }).join(' '), /Number.*step.*Total/i)
  })

  it('number refuses a group by', () => {
    assert.match(query('number', { group_by: [{ field: 'service' }] }).join(' '), /Number.*group/i)
  })

  it('time series refuses a total step', () => {
    assert.match(query('time_series', { step: 'total' }).join(' '), /Time Series.*timed step/i)
  })

  it('bar refuses a total step', () => {
    assert.match(query('bar', { step: 'total' }).join(' '), /Bar Chart.*timed step/i)
  })

  it('histogram refuses a count aggregation', () => {
    assert.match(query('histogram', { aggregations: [{ function: 'count' }] }).join(' '), /Histogram.*field/i)
  })

  it('heatmap refuses a group by', () => {
    assert.match(query('heatmap', { group_by: [{ field: 'service' }] }).join(' '), /Heatmap.*group/i)
  })

  it('scatter refuses a single aggregation and two group bys', () => {
    const out = query('scatter', { aggregations: [{ function: 'count' }], group_by: [{ field: 'service' }, { field: 'status' }] }).join(' ')
    assert.match(out, /Scatter Plot.*two aggregations/i)
    assert.match(out, /Scatter Plot.*one field/i)
  })

  it('table, list and pie refuse a timed step', () => {
    for (const kind of ['table', 'list', 'pie'] as const) assert.match(query(kind, { step: { fixed: 60 } }).join(' '), /step.*Total/i)
  })

  it('refuses a limit outside 1 to 1000', () => {
    assert.match(query('table', { limit: 0 }).join(' '), /limit/i)
    assert.match(query('table', { limit: 1001 }).join(' '), /limit/i)
    assert.deepEqual(query('table', { limit: 1000 }), [])
  })

  it('refuses more than three group bys and a repeated one', () => {
    assert.match(query('table', { group_by: [{ field: 'service' }, { field: 'status' }, { field: 'kind' }, { field: 'name' }] }).join(' '), /at most 3/)
    assert.match(query('table', { group_by: [{ field: 'service' }, { field: 'service' }] }).join(' '), /once/)
  })

  it('refuses a field that does not exist on the signal', () => {
    assert.match(query('table', { signal: 'logs', group_by: [{ field: 'duration' }] }).join(' '), /duration.*logs/i)
  })

  it('refuses a sum over a non numeric field and a count with a field', () => {
    assert.match(query('table', { aggregations: [{ function: 'sum', field: { field: 'service' } }] }).join(' '), /numeric/i)
    assert.match(query('table', { aggregations: [{ function: 'count', field: { field: 'service' } }] }).join(' '), /takes no field/i)
    assert.match(query('table', { aggregations: [{ function: 'avg' }] }).join(' '), /needs a field/i)
  })

  it('accepts count_distinct over any field', () => {
    assert.deepEqual(query('table', { aggregations: [{ function: 'count_distinct', field: { field: 'service' } }] }), [])
  })

  it('refuses an order that names a missing aggregation or a group that is not there', () => {
    assert.match(query('table', { order: { by: { aggregation: 3 }, direction: 'asc' } }).join(' '), /order/i)
    assert.match(query('table', { group_by: [], order: { by: 'group', direction: 'asc' } }).join(' '), /order/i)
  })

  it('asks for a metric name, and for a filter value', () => {
    assert.match(query('number', { signal: 'metrics', aggregations: [{ metric: '', time: 'avg', space: 'avg' }] }).join(' '), /metric/i)
    assert.match(query('table', { filter: { field: 'service', op: 'eq' } }).join(' '), /value/i)
    assert.deepEqual(query('table', { filter: { field: 'service', op: 'exists' } }), [])
  })

  it('refuses a fixed step under one second', () => {
    assert.match(query('time_series', { step: { fixed: 0 } }).join(' '), /step/i)
  })

  it('a text panel refuses a query and other kinds need one', () => {
    assert.match(kinds.panelIssues({ ...rich, kind: 'text' }).join(' '), /Text.*no query/i)
    assert.match(kinds.panelIssues({ ...rich, kind: 'table', queries: [] }).join(' '), /needs a query/i)
  })

  it('refuses a title that is too long', () => {
    assert.match(kinds.panelIssues({ ...rich, title: 'x'.repeat(121) }).join(' '), /title/i)
  })
})

describe('telling the user what a kind change adjusted', () => {
  it('lists the step, the group by and the aggregation it changed', () => {
    const notes = kinds.kindChangeNotes(rich, kinds.changeKind(rich, 'histogram')).join(' ')
    assert.match(notes, /step is now Total/)
    assert.match(notes, /no group by/)
    assert.match(notes, /first aggregation is now avg\(duration\)/)
    assert.match(notes, /order was cleared/)
  })

  it('says a second aggregation was added for a scatter plot', () => {
    assert.match(kinds.kindChangeNotes(rich, kinds.changeKind(rich, 'scatter')).join(' '), /two aggregations/)
    assert.match(kinds.kindChangeNotes(rich, kinds.changeKind(rich, 'scatter')).join(' '), /at most one field/)
  })

  it('says nothing when nothing changed', () => {
    assert.deepEqual(kinds.kindChangeNotes(rich, kinds.changeKind(rich, 'area')), [])
  })
})

describe('options a kind does not support', () => {
  it('strips them when the kind changes', () => {
    const table = converted('table')
    assert.deepEqual(table.options, {})
    assert.deepEqual(converted('pie').options, { unit: 'req', legend: 'right' })
    assert.deepEqual(converted('area').options, { unit: 'req', legend: 'right', stacked: true })
    const text = converted('text', { ...rich, options: { ...rich.options, content: 'hello' } })
    assert.deepEqual(text.options, { content: 'hello' })
    assert.equal(converted('time_series', text).options.content, undefined)
  })

  it('counts characters, not UTF-16 units', () => {
    assert.equal(kinds.points('😀😀'), 2)
    assert.deepEqual(kinds.panelIssues({ ...rich, title: '😀'.repeat(120) }), [])
    assert.match(kinds.panelIssues({ ...rich, title: '😀'.repeat(121) }).join(' '), /title/i)
  })
})

describe('switching the signal of a query', () => {
  it('trades event aggregations for a metric aggregation', () => {
    const out = kinds.withSignal(first(rich), 'metrics')
    assert.equal(out.signal, 'metrics')
    assert.deepEqual(out.aggregations, [{ metric: '', time: 'avg', space: 'avg' }])
  })

  it('drops grouping and filters that do not exist on the new signal', () => {
    const out = kinds.withSignal({ ...first(rich), filter: { all: [{ field: 'duration', op: 'gt', value: 5 }, { field: 'service', op: 'eq', value: 'a' }] } }, 'logs')
    assert.deepEqual(out.group_by, [{ field: 'service' }, { attr: 'http.route' }])
    assert.deepEqual(out.filter, { all: [{ field: 'service', op: 'eq', value: 'a' }] })
  })

  it('goes back to a count over events', () => {
    const metrics = kinds.withSignal(first(rich), 'metrics')
    assert.deepEqual(kinds.withSignal(metrics, 'traces').aggregations, [{ function: 'count' }])
  })

  it('keeps the query as it is for the same signal', () => {
    assert.deepEqual(kinds.withSignal(first(rich), 'traces'), first(rich))
  })
})

describe('new panels', () => {
  it('builds a valid panel for every kind', () => {
    for (const kind of dash.PANEL_KINDS) {
      const panel = kinds.newPanel(kind, `p-${kind}`)
      assert.deepEqual(kinds.panelIssues(panel), [], kind)
      assert.equal(panel.kind, kind)
      assert.equal(panel.title, kinds.KIND_INFO[kind].name)
    }
  })

  it('a new text panel has no query and some content to replace', () => {
    const panel = kinds.newPanel('text', 'n')
    assert.deepEqual(panel.queries, [])
    assert.match(panel.options.content ?? '', /\S/)
  })

  it('options offered per kind', () => {
    assert.deepEqual(kinds.optionSupport('text'), { unit: false, decimals: false, legend: false, stacked: false, content: true, centre: false })
    assert.equal(kinds.optionSupport('area').stacked, true)
    assert.equal(kinds.optionSupport('time_series').stacked, false)
    assert.equal(kinds.optionSupport('number').legend, false)
    assert.equal(kinds.optionSupport('pie').legend, true)
  })
})

describe('the centre label of a pie', () => {
  const pie = (content?: string): Panel => ({ ...kinds.newPanel('pie', 'p'), options: content === undefined ? {} : { content } })

  it('is a pie option and no other kind keeps it', () => {
    assert.equal(kinds.optionSupport('pie').centre, true)
    assert.equal(kinds.optionSupport('bar').centre, false)
    assert.deepEqual(kinds.pruneOptions('pie', { content: 'memory' }), { content: 'memory' })
    assert.deepEqual(kinds.pruneOptions('bar', { content: 'memory' }), {})
  })

  it('does not become the markdown of a text panel, nor the other way round', () => {
    assert.equal(kinds.changeKind(pie('memory'), 'text').options.content?.startsWith('## Notes'), true)
    const text = kinds.changeKind(pie('memory'), 'text')
    assert.equal(kinds.changeKind(text, 'pie').options.content, undefined)
  })

  it('is at most forty characters, counted as characters', () => {
    assert.deepEqual(kinds.panelIssues(pie('x'.repeat(40))), [])
    assert.equal(kinds.panelIssues(pie('x'.repeat(41))).some((issue) => issue.includes('centre label')), true)
    assert.deepEqual(kinds.panelIssues(pie('é'.repeat(40))), [])
  })
})
