import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createElement, html, load, stop } from './harness.ts'

const geometry = await load<typeof import('../src/components/ft/panels/geometry')>('components/ft/panels/geometry.ts')
const math = await load<typeof import('../src/components/ft/chartMath')>('components/ft/chartMath.ts')
const charts = await load<typeof import('../src/components/ft/charts')>('components/ft/charts.tsx')
const frame = await load<typeof import('../src/components/ft/ChartFrame')>('components/ft/ChartFrame.tsx')
const lines = await load<typeof import('../src/components/ft/percentiles')>('components/ft/percentiles.ts')
const services = await load<typeof import('../src/data/services')>('data/services.ts')
const panels = await load<typeof import('../src/components/ft/panels/index')>('components/ft/panels/index.tsx')
const legend = await load<typeof import('../src/components/ft/panels/Legend')>('components/ft/panels/Legend.tsx')
const pick = await load<typeof import('../src/pages/dashboards/PickProject')>('pages/dashboards/PickProject.tsx')
const list = await load<typeof import('../src/pages/dashboards/Dashboards')>('pages/dashboards/Dashboards.tsx')

after(stop)

const MS = 1_000_000

describe('axis labels (@spec-l18-3)', () => {
  it('writes time in one unit across the whole axis', () => {
    assert.deepEqual(geometry.axisLabels([2000, 1000, 0], 'ms'), ['2 s', '1 s', '0 s'])
    assert.deepEqual(geometry.axisLabels([1200, 600, 0], 'ms'), ['1.2 s', '0.6 s', '0 s'])
    assert.deepEqual(geometry.axisLabels([500, 250, 0], 'ms'), ['500 ms', '250 ms', '0 ms'])
    assert.deepEqual(geometry.axisLabels([0.5, 0.25, 0], 'ms'), ['500 µs', '250 µs', '0 µs'])
    assert.deepEqual(geometry.axisLabels([900, 450, 0], 'ns'), ['900 ns', '450 ns', '0 ns'])
    assert.deepEqual(geometry.axisLabels([120, 60, 0], 's'), ['2 min', '1 min', '0 min'])
  })

  it('never mixes ns and ms on one axis', () => {
    const labels = geometry.axisLabels([998, 499, 0], 'ms')
    assert.equal(new Set(labels.map((label) => label.split(' ')[1])).size, 1)
  })

  it('keeps three significant figures at most', () => {
    assert.deepEqual(geometry.axisLabels([849.94, 424.97, 0], 'ms'), ['850 ms', '425 ms', '0 ms'])
    assert.deepEqual(geometry.axisLabels([2500, 1250, 0], 'ms'), ['2.5 s', '1.25 s', '0 s'])
  })

  it('writes bytes in one binary unit', () => {
    assert.deepEqual(geometry.axisLabels([600 * 1024 ** 2, 300 * 1024 ** 2, 0], 'bytes'), ['600 MiB', '300 MiB', '0 MiB'])
  })

  it('writes percentages with a space and the sign', () => {
    assert.deepEqual(geometry.axisLabels([25, 12.5, 0], '%'), ['25 %', '12.5 %', '0 %'])
  })

  it('writes rates with the per-second suffix', () => {
    assert.deepEqual(geometry.axisLabels([0.5, 0.25, 0], '/s'), ['0.5/s', '0.25/s', '0/s'])
    assert.deepEqual(geometry.axisLabels([12, 6, 0], '/s'), ['12/s', '6/s', '0/s'])
    assert.deepEqual(geometry.axisLabels([0.05, 0.025, 0], '/s'), ['0.05/s', '0.025/s', '0/s'])
  })

  it('writes counts compactly', () => {
    assert.deepEqual(geometry.axisLabels([20000, 10000, 0]), ['20K', '10K', '0'])
  })

  it('sizes the gutter from the longest label so nothing wraps', () => {
    const labels = ['1.37 s', '0.685 s', '0 s']
    assert.ok(frame.gutterOf(labels) >= Math.max(...labels.map((label) => label.length)) * 6.6)
  })

  it('marks every axis label as never wrapping', () => {
    const out = html(createElement(charts.LineChart, { title: 'Latency', values: [1, 2], hi: 2, yLabels: ['1.37 s', '0.685 s', '0 s'], xLabels: ['10:00', '10:30', '11:00'], aria: 'x' } as never))
    const marked = out.match(/whitespace-nowrap[^"]*text-chart-axis/g) ?? []
    assert.equal(marked.length, 2)
    assert.match(out, /text-micro/)
    assert.match(out, /tabular-nums/)
  })
})

describe('series wire (@spec-l18-1)', () => {
  const base = { step_ns: 60_000 * MS, requests: 10, errors: 1, p95_ns: 800 * MS }

  it('reads the old four-tuple with p50 and p99 absent', () => {
    const out = services.stepped({ ...base, points: [[1_000 * MS, 5, 0, 700 * MS], [2_000 * MS, 5, 1, null]] })
    assert.equal(out.spread, false)
    assert.equal(out.p50Ms, null)
    assert.equal(out.points[0].p95Ms, 700)
    assert.equal(out.points[0].p50Ms, null)
    assert.equal(out.points[1].p95Ms, null)
  })

  it('reads the new six-tuple and the whole-window percentiles', () => {
    const out = services.stepped({ ...base, p50_ns: 300 * MS, p99_ns: 1370 * MS, points: [[1_000 * MS, 5, 0, 700 * MS, 300 * MS, 1200 * MS], [2_000 * MS, 0, 0, null, null, null]] })
    assert.equal(out.spread, true)
    assert.equal(out.p50Ms, 300)
    assert.equal(out.p99Ms, 1370)
    assert.deepEqual([out.points[0].p50Ms, out.points[0].p95Ms, out.points[0].p99Ms], [300, 700, 1200])
    assert.deepEqual([out.points[1].p50Ms, out.points[1].p95Ms, out.points[1].p99Ms], [null, null, null])
  })

  it('keeps a bucket without spans as a gap, never zero', () => {
    const out = services.stepped({ ...base, p50_ns: null, p99_ns: null, points: [[1_000 * MS, 0, 0, null, null, null]] })
    const drawn = services.charted(out)
    assert.deepEqual([drawn.p50[0], drawn.p95[0], drawn.p99[0], drawn.errorRate[0]], [null, null, null, null])
  })

  it('falls back to p95 alone before the backend sends the spread', () => {
    const only = lines.percentileLines({ p50: [], p95: [1], p99: [], overall: { p50: null, p95: 1, p99: null }, spread: false })
    assert.deepEqual(only.map((one) => one.key), ['p95'])
  })
})

describe('percentile lines (@spec-l18-4)', () => {
  const spread = lines.percentileLines({ p50: [300, 310], p95: [831, 900], p99: [1370, 1500], overall: { p50: 300, p95: 831, p99: 1370 }, spread: true })
  const format = (ms: number) => geometry.formatValue(ms, 'ms')

  it('weights p50 thin and faded, p95 heavy, p99 thin and dashed', () => {
    assert.deepEqual(spread.map((one) => [one.key, one.weight, one.opacity ?? 1, one.dash ?? null]), [['p50', 1, lines.P50_OPACITY, null], ['p95', 1.75, 1, null], ['p99', 1, 1, '4 3']])
  })

  it('draws three polylines and no fill', () => {
    const out = html(createElement(charts.LineChart, { title: 'Latency', lines: spread, live: true, hi: 2000, yLabels: ['2 s', '1 s', '0 s'], xLabels: ['a', 'b'], aria: 'x', format } as never))
    assert.equal((out.match(/<polyline/g) ?? []).length, 3)
    assert.doesNotMatch(out, /<polygon/)
    assert.match(out, /stroke-dasharray="4 3"/)
  })

  it('writes the header legend with the live values', () => {
    assert.equal(math.liveSummary(spread, null, format), 'p50 300 ms · p95 831 ms · p99 1.37 s')
    const out = html(createElement(charts.LineChart, { title: 'Latency', lines: spread, live: true, hi: 2000, yLabels: ['2 s', '1 s', '0 s'], xLabels: ['a', 'b'], aria: 'x', format } as never))
    assert.match(out, /aria-label="p50 300 ms · p95 831 ms · p99 1\.37 s"/)
  })

  it('follows the pointer: the live summary reads the hovered point', () => {
    assert.equal(math.liveSummary(spread, 1, format), 'p50 310 ms · p95 900 ms · p99 1.5 s')
  })
})

describe('headline (@spec-l18-5)', () => {
  const values = [1, 2, 3, 0]
  const format = (value: number) => `${value} %`

  it('is the window aggregate, not the last bucket', () => {
    assert.equal(math.headlineOf(7.6, values, null, format), '7.6 %')
  })

  it('is replaced by the value at the pointer', () => {
    assert.equal(math.headlineOf(7.6, values, 2, format), '3 %')
  })

  it('shows a dash for a hovered gap and for an aggregate without data', () => {
    assert.equal(math.headlineOf(7.6, [1, null], 1, format), '—')
    assert.equal(math.headlineOf(null, values, null, format), '—')
  })

  it('renders the aggregate with the window named', () => {
    const out = html(createElement(charts.LineChart, { title: 'Error rate', values, overall: 7.6, windowLabel: 'last 1 h', format, hi: 4, yLabels: ['4 %', '2 %', '0 %'], xLabels: ['a', 'b'], aria: 'x' } as never))
    assert.match(out, />7\.6 %</)
    assert.match(out, />last 1 h</)
    assert.doesNotMatch(out, /text-heading[^>]*>0 %</)
  })
})

describe('legend (@spec-l18-4)', () => {
  const many = Array.from({ length: 20 }, (_, index) => ({ key: `series-${index}`, colour: 'var(--svc-1)' }))
  const render = (items: typeof many) => html(createElement(legend.Legend, { items, position: 'bottom' }))

  it('draws no bordered pill', () => {
    const out = render(many.slice(0, 2))
    assert.doesNotMatch(out, /rounded-sm border/)
    assert.doesNotMatch(out, / border /)
  })

  it('says how many more and keeps the full list in the title', () => {
    const out = render(many)
    assert.match(out, />and 8 more</)
    assert.match(out, /title="series-0, series-1/)
    assert.match(out, /series-19/)
  })

  it('says nothing when everything fits', () => {
    assert.doesNotMatch(render(many.slice(0, 5)), /more</)
  })

  it('counts what is hidden', () => {
    assert.equal(legend.moreText(3), 'and 3 more')
    assert.equal(legend.capped([1, 2, 3, 4], 2).hidden.length, 2)
  })
})

describe('duration columns (@spec-l18-7)', () => {
  const query = (aggregations: unknown[], group: unknown[] = [{ field: 'service' }]) => ({ name: 'A', signal: 'traces', aggregations, group_by: group, step: 'total' }) as never
  const panel = (aggregations: unknown[]) => ({ id: 'p', title: 'Slowest', description: '', kind: 'table', queries: [query(aggregations)], options: {} }) as never
  const render = (aggregations: unknown[], cells: number[]) =>
    html(createElement(panels.DataTablePanel, { panel: panel(aggregations), result: { kind: 'rows', columns: ['service', 'p95(duration)', 'count'], rows: [['api', ...cells]], truncated: false }, range: { fromNs: 0, toNs: 1 } } as never))

  const aggs = [{ function: 'p95', field: { field: 'duration' } }, { function: 'count' }]

  it('prints a duration with its unit', () => {
    const out = render(aggs, [922_503_087, 12])
    assert.match(out, />922\.5 ms</)
    assert.doesNotMatch(out, /922,503,087/)
  })

  it('leaves other numbers as they are', () => {
    assert.match(render(aggs, [922_503_087, 12]), />12</)
  })

  it('finds the column from the query, not from its label', () => {
    assert.deepEqual(geometry.durationColumns(query(aggs), ['service', 'p95(duration)', 'count']), [false, true, false])
    assert.deepEqual(geometry.durationColumns(query([{ function: 'p95', field: { attr: 'duration' } }, { function: 'count', field: { field: 'duration' } }]), ['service', 'x', 'y']), [false, false, false])
    assert.deepEqual(geometry.durationColumns(query([{ function: 'avg', field: { field: 'duration' } }], []), ['renamed']), [true])
  })

  it('writes each scale in its unit', () => {
    assert.equal(geometry.durationText(850), '850 ns')
    assert.equal(geometry.durationText(12_300), '12.3 µs')
    assert.equal(geometry.durationText(1_480_000_000), '1.48 s')
  })
})

describe('dashboards without a project (@spec-l18-8, @spec-l18-9)', () => {
  it('needs a project except for the fixture', () => {
    assert.equal(pick.needsProject(undefined, false), true)
    assert.equal(pick.needsProject('p1', false), false)
    assert.equal(pick.needsProject(undefined, true), false)
  })

  it('shows the same Pick a project state as the list', () => {
    const out = html(createElement(pick.PickProject, { what: 'this dashboard' }))
    assert.match(out, /Pick a project/)
    assert.doesNotMatch(out, /animate-pulse/)
  })

  it('shows the fixture help only in development', () => {
    assert.equal(html(createElement(list.FixtureHelp, { dev: false })), '')
    assert.notEqual(list.FixtureHelp({ dev: true }), null)
  })
})
