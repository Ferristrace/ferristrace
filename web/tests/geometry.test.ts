import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { load, stop } from './harness.ts'

const g = await load<typeof import('../src/components/ft/panels/geometry')>('components/ft/panels/geometry.ts')
const r = await load<typeof import('../src/components/ft/panels/result')>('components/ft/panels/result.ts')

after(stop)

describe('series geometry', () => {
  const series = [
    { labels: { service: 'a' }, points: [[0, 1], [10, 3], [20, null]] as [number, number | null][] },
    { labels: { service: 'b' }, points: [[10, 5], [20, 2], [30, 4]] as [number, number | null][] },
  ]

  it('aligns series on the union of their times', () => {
    const table = g.alignSeries(series)
    assert.deepEqual(table.times, [0, 10, 20, 30])
    assert.deepEqual(table.rows[0], [1, 3, null, null])
    assert.deepEqual(table.rows[1], [null, 5, 2, 4])
  })

  it('frames a plain chart from zero to the highest value', () => {
    const frame = g.frameOf(g.alignSeries(series), [false, false], false, false)
    assert.equal(frame.lo, 0)
    assert.equal(frame.hi, 5)
    assert.equal(frame.t0, 0)
    assert.equal(frame.t1, 30)
  })

  it('ignores hidden series when framing', () => {
    const frame = g.frameOf(g.alignSeries(series), [false, true], false, false)
    assert.equal(frame.hi, 3)
  })

  it('frames a stacked chart on the highest total', () => {
    const frame = g.frameOf(g.alignSeries(series), [false, false], true, false)
    assert.equal(frame.hi, 8)
  })

  it('pads the frame by half a step for bars', () => {
    const frame = g.frameOf(g.alignSeries(series), [false, false], false, true)
    assert.equal(frame.t0, -5)
    assert.equal(frame.t1, 35)
  })

  it('never returns an empty range', () => {
    const frame = g.frameOf({ times: [], rows: [] }, [], false, false)
    assert.ok(frame.t1 > frame.t0)
    assert.ok(frame.hi > frame.lo)
  })

  it('scales values and times to fractions', () => {
    const frame = { t0: 0, t1: 100, lo: 0, hi: 10 }
    assert.equal(g.xFraction(25, frame), 0.25)
    assert.equal(g.yFraction(10, frame), 0)
    assert.equal(g.yFraction(0, frame), 1)
    assert.equal(g.valueAtFraction(0.5, frame), 5)
  })

  it('breaks a line where a value is missing', () => {
    const parts = g.segmentsOf([[0, 1], [1, null], [2, 3], [3, 4]], (t) => t, (v) => v)
    assert.deepEqual(parts, [[[0, 1]], [[2, 3], [3, 4]]])
  })

  it('stacks layers on top of each other and treats gaps as zero', () => {
    const layers = g.stackLayers(g.alignSeries(series), [false, false])
    assert.deepEqual(layers[0].upper, [1, 3, 0, 0])
    assert.deepEqual(layers[1].lower, [1, 3, 0, 0])
    assert.deepEqual(layers[1].upper, [1, 8, 2, 4])
  })

  it('leaves hidden layers flat', () => {
    const layers = g.stackLayers(g.alignSeries(series), [true, false])
    assert.deepEqual(layers[0].upper, [0, 0, 0, 0])
    assert.deepEqual(layers[1].upper, [0, 5, 2, 4])
  })

  it('finds the median step', () => {
    assert.equal(g.stepOf([0, 10, 20, 35]), 10)
    assert.equal(g.stepOf([5]), 0)
  })
})

describe('nearest time and series', () => {
  it('finds the closest time', () => {
    const times = [0, 10, 20, 30]
    assert.equal(g.nearestIndex(times, -4), 0)
    assert.equal(g.nearestIndex(times, 4), 0)
    assert.equal(g.nearestIndex(times, 6), 1)
    assert.equal(g.nearestIndex(times, 26), 3)
    assert.equal(g.nearestIndex(times, 99), 3)
    assert.equal(g.nearestIndex([], 3), -1)
  })

  const entries = [
    { key: 'a', colour: '#111', value: 2 },
    { key: 'b', colour: '#222', value: 9 },
    { key: 'c', colour: '#333', value: null },
    { key: 'd', colour: '#444', value: 5 },
  ]

  it('lists every series by value with gaps last', () => {
    const rows = g.tooltipRows(entries, null)
    assert.deepEqual(rows.map((row) => row.key), ['b', 'd', 'a', 'c'])
  })

  it('marks the series nearest to the pointer', () => {
    const rows = g.tooltipRows(entries, 4)
    assert.deepEqual(rows.filter((row) => row.nearest).map((row) => row.key), ['d'])
    assert.deepEqual(g.tooltipRows(entries, 100).filter((row) => row.nearest).map((row) => row.key), ['b'])
  })

  it('falls back to the highest series without a pointer value', () => {
    assert.deepEqual(g.tooltipRows(entries, null).filter((row) => row.nearest).map((row) => row.key), ['b'])
  })

  it('marks nothing when no series has a value', () => {
    const rows = g.tooltipRows([{ key: 'x', colour: '#000', value: null }], 1)
    assert.equal(rows.some((row) => row.nearest), false)
  })
})

describe('pie', () => {
  it('turns rows into labelled values', () => {
    const items = g.pieItems(['service', 'env', 'count'], [['a', 'prod', 3], ['b', 'dev', 1], ['c', 'dev', null]])
    assert.deepEqual(items.map((item) => item.label), ['a · prod', 'b · dev'])
    assert.deepEqual(items[0].labels, { service: 'a', env: 'prod' })
  })

  it('names an ungrouped row after its value column', () => {
    assert.equal(g.pieItems(['total'], [[7]])[0].label, 'total')
  })

  it('shares sum to one and slices run clockwise from the top', () => {
    const slices = g.pieSlices([{ label: 'a', value: 1, labels: {} }, { label: 'b', value: 3, labels: {} }])
    assert.equal(slices[0].label, 'b')
    assert.ok(Math.abs(slices.reduce((sum, slice) => sum + slice.share, 0) - 1) < 1e-9)
    assert.ok(Math.abs(slices[0].start + Math.PI / 2) < 1e-9)
    assert.ok(Math.abs(slices[1].end - (3 * Math.PI) / 2) < 1e-9)
  })

  it('folds the tail into Other and drops zero or negative values', () => {
    const items = Array.from({ length: 13 }, (_, at) => ({ label: `s${at}`, value: 13 - at, labels: {} }))
    items.push({ label: 'zero', value: 0, labels: {} }, { label: 'neg', value: -2, labels: {} })
    const slices = g.pieSlices(items, 10)
    assert.equal(slices.length, 11)
    assert.equal(slices[10].label, 'Other (3)')
    assert.equal(slices[10].value, 6)
    assert.equal(slices[10].other, true)
  })

  it('draws a whole ring when one slice has everything', () => {
    const [only] = g.pieSlices([{ label: 'a', value: 5, labels: {} }])
    const path = g.arcPath(50, 50, 40, 24, only.start, only.end)
    assert.equal(path.split('M').length - 1, 2)
    assert.ok(!path.includes('NaN'))
  })
})

describe('histogram, heatmap, scatter', () => {
  it('lays buckets out by their range and scales heights to the peak', () => {
    const { bars, peak } = g.histogramBars([{ from: 0, to: 10, count: 2 }, { from: 10, to: 40, count: 8 }])
    assert.equal(peak, 8)
    assert.deepEqual(bars.map((bar) => [bar.x0, bar.x1, bar.height]), [[0, 0.25, 0.25], [0.25, 1, 1]])
  })

  it('spreads buckets evenly when they have no width', () => {
    const { bars } = g.histogramBars([{ from: 5, to: 5, count: 1 }, { from: 5, to: 5, count: 2 }])
    assert.deepEqual(bars.map((bar) => [bar.x0, bar.x1]), [[0, 0.5], [0.5, 1]])
  })

  it('places heat cells on the grid with the lowest range at the bottom', () => {
    const { cells, peak } = g.heatCells([0, 1], [{ from: 0, to: 1 }, { from: 1, to: 2 }], [[0, 0, 5], [1, 1, 10], [1, 0, 0], [7, 0, 3]])
    assert.equal(peak, 10)
    assert.equal(cells.length, 2)
    assert.deepEqual([cells[0].x0, cells[0].x1, cells[0].y0, cells[0].y1], [0, 0.5, 0.5, 1])
    assert.deepEqual([cells[1].x0, cells[1].x1, cells[1].y0, cells[1].y1], [0.5, 1, 0, 0.5])
    assert.equal(cells[1].intensity, 1)
    assert.equal(cells[0].intensity, 0.5)
  })

  it('frames scatter points and colours them by group', () => {
    const points = [{ group: { s: 'a' }, x: 0, y: 0 }, { group: { s: 'b' }, x: 10, y: 20 }, { group: { s: 'a' }, x: 5, y: 10 }]
    const frame = g.scatterFrame(points)
    assert.deepEqual(frame, { xLo: 0, xHi: 10, yLo: 0, yHi: 20 })
    const dots = g.scatterDots(points, frame, (labels) => labels.s)
    assert.deepEqual(dots.map((dot) => [dot.x, dot.y]), [[0, 1], [1, 0], [0.5, 0.5]])
    assert.equal(dots[0].colour, dots[2].colour)
    assert.notEqual(dots[0].colour, dots[1].colour)
  })
})

describe('ranges and formatting', () => {
  it('builds a drilldown range from a bucket start and its step', () => {
    assert.deepEqual(g.drillRange(1_700_000_000_000_000_000, 60_000_000_000, 3_600e9), { fromMs: 1_700_000_000_000, toMs: 1_700_000_060_000 })
  })

  it('falls back to a sixtieth of the range, at least a minute', () => {
    const range = g.drillRange(0, 0, 60e9)
    assert.equal(range.toMs - range.fromMs, 60_000)
  })

  it('turns a dragged band into nanoseconds, whichever way it was dragged', () => {
    const frame = { t0: 1000, t1: 2000, lo: 0, hi: 1 }
    assert.deepEqual(g.selectRange(0.75, 0.25, frame), { fromNs: 1250, toNs: 1750 })
    assert.equal(g.selectRange(0.5, 0.5, frame), null)
    assert.deepEqual(g.selectRange(-1, 2, frame), { fromNs: 1000, toNs: 2000 })
  })

  it('formats values with a unit and decimals', () => {
    assert.equal(g.formatValue(1234.567, 'ms'), '1.23 s')
    assert.equal(g.formatValue(12.3456, '%', 1), '12.3%')
    assert.equal(g.formatValue(0.123456, ''), '0.1235')
    assert.equal(g.formatValue(3, null, 2), '3.00')
    assert.equal(g.formatValue(Number.NaN, 'ms'), '—')
  })

  it('formats clock and axis labels in UTC', () => {
    const at = Date.UTC(2026, 10, 16, 9, 5, 7) * 1e6
    assert.equal(g.clockOf(at), '2026-11-16 09:05:07 UTC')
    assert.equal(g.axisTime(at, 3_600e9), '09:05')
    assert.equal(g.axisTime(at, 7 * 86_400e9), '11-16 09:05')
  })

  it('picks a tone from thresholds', () => {
    assert.equal(g.thresholdTone(5), 'neutral')
    assert.equal(g.thresholdTone(5, { warn: 3, critical: 10 }), 'warn')
    assert.equal(g.thresholdTone(10, { warn: 3, critical: 10 }), 'critical')
    assert.equal(g.thresholdTone(null, { warn: 3 }), 'neutral')
  })

  it('sorts rows by number or text and keeps gaps last', () => {
    const rows = [['b', 2], ['a', 10], ['c', null]]
    assert.deepEqual(g.sortRows(rows, 1, 'desc').map((row) => row[0]), ['a', 'b', 'c'])
    assert.deepEqual(g.sortRows(rows, 1, 'asc').map((row) => row[0]), ['b', 'a', 'c'])
    assert.deepEqual(g.sortRows(rows, 0, 'asc').map((row) => row[0]), ['a', 'b', 'c'])
    assert.equal(g.isNumericColumn(rows, 1), true)
    assert.equal(g.isNumericColumn(rows, 0), false)
  })
})

describe('results', () => {
  it('knows when a result holds nothing', () => {
    assert.equal(r.isEmpty({ kind: 'series', series: [] }), true)
    assert.equal(r.isEmpty({ kind: 'series', series: [{ labels: {}, points: [[1, null]] }] }), true)
    assert.equal(r.isEmpty({ kind: 'series', series: [{ labels: {}, points: [[1, 0]] }] }), false)
    assert.equal(r.isEmpty({ kind: 'scalar', value: null }), true)
    assert.equal(r.isEmpty({ kind: 'scalar', value: 0 }), false)
    assert.equal(r.isEmpty({ kind: 'rows', columns: ['a'], rows: [], truncated: false }), true)
    assert.equal(r.isEmpty({ kind: 'buckets', buckets: [{ from: 0, to: 1, count: 0 }] }), true)
    assert.equal(r.isEmpty({ kind: 'heat', x: [1], y: [{ from: 0, to: 1 }], cells: [[0, 0, 0]] }), true)
    assert.equal(r.isEmpty({ kind: 'heat', x: [1], y: [{ from: 0, to: 1 }], cells: [[0, 0, 2]] }), false)
    assert.equal(r.isEmpty({ kind: 'pairs', points: [] }), true)
  })

  it('tags series with their query when a panel has several', () => {
    const one = { kind: 'series' as const, series: [{ labels: { service: 'a' }, points: [] }] }
    const merged = r.mergeResults([one, one], ['rate', 'errors'])
    assert.equal(merged?.kind === 'series' && merged.series.length, 2)
    assert.equal(merged?.kind === 'series' && r.labelOf(merged.series[1].labels), 'errors: a')
    const alone = r.mergeResults([one], ['rate'])
    assert.equal(alone?.kind === 'series' && r.labelOf(alone.series[0].labels), 'a')
  })

  it('labels series by their values', () => {
    assert.equal(r.labelOf({}), 'all')
    assert.equal(r.labelOf({ a: '1', b: '2' }), 'a=1, b=2')
    assert.equal(r.labelOf({ [r.QUERY_LABEL]: 'q' }), 'q')
  })

  it('explains each failure the query route can give', () => {
    const many = r.describeFailure(422, '{"error":"too_many_series","count":51,"max":50}')
    assert.equal(many.kind, 'too_many_series')
    assert.match(many.message, /51 series/)
    assert.match(many.message, /50/)
    const bad = r.describeFailure(422, '{"error":"invalid","reason":"the filter names a field this signal lacks"}')
    assert.equal(bad.kind, 'invalid')
    assert.match(bad.message, /filter names a field/)
    assert.equal(r.describeFailure(504, '').kind, 'timeout')
    assert.equal(r.describeFailure(503, '').kind, 'unavailable')
    assert.equal(r.describeFailure(500, '').kind, 'other')
  })
})

describe('large inputs and review fixes', () => {
  it('frames hundreds of thousands of points without a RangeError', () => {
    const points = Array.from({ length: 400_000 }, (_, at) => ({ group: {}, x: at, y: at * 2 }))
    const frame = g.scatterFrame(points)
    assert.equal(frame.xHi, 399_999)
    assert.equal(frame.yHi, 799_998)
    assert.equal(g.maxOf(points.map((p) => p.x)), 399_999)
    assert.equal(g.minOf([]), Infinity)
  })

  it('caps rendered points evenly and keeps small sets whole', () => {
    const all = Array.from({ length: 10_000 }, (_, at) => at)
    const kept = g.capPoints(all, 2000)
    assert.equal(kept.length, 2000)
    assert.equal(kept[0], 0)
    assert.ok(kept[1999] > 9900)
    assert.equal(g.capPoints([1, 2, 3], 2000).length, 3)
  })

  it('finds the nearest stacked layer from its anchor, not its raw value', () => {
    const entries = [
      { key: 'low', colour: '', value: 1, anchor: 9 },
      { key: 'high', colour: '', value: 50, anchor: 10 },
    ]
    assert.deepEqual(g.tooltipRows(entries, 10).filter((row) => row.nearest).map((row) => row.key), ['high'])
    assert.deepEqual(g.tooltipRows([{ key: 'a', colour: '', value: 1 }, { key: 'b', colour: '', value: 50 }], 10).filter((row) => row.nearest).map((row) => row.key), ['a'])
  })

  it('lists the busiest heat cells first', () => {
    const { cells } = g.heatCells([0, 1], [{ from: 0, to: 1 }], [[0, 0, 2], [1, 0, 9]])
    assert.deepEqual(g.topCells(cells, 1).map((cell) => cell.count), [9])
  })

  it('puts the query tag last so a server label cannot override it', () => {
    const one = { kind: 'series' as const, series: [{ labels: { __query: 'spoof', service: 'a' }, points: [] }] }
    const merged = r.mergeResults([one, one], ['rate', 'errors'])
    assert.equal(merged?.kind === 'series' && merged.series[0].labels.__query, 'rate')
    assert.equal(merged?.kind === 'series' && Object.keys(merged.series[0].labels).at(-1), '__query')
  })

  it('counts the queries a panel cannot draw', () => {
    const rows = { kind: 'rows' as const, columns: [], rows: [], truncated: false }
    const series = { kind: 'series' as const, series: [] }
    assert.equal(r.droppedQueries([series, series]), 0)
    assert.equal(r.droppedQueries([rows, rows, series]), 2)
    assert.equal(r.droppedQueries([series, rows]), 1)
    assert.equal(r.droppedQueries([]), 0)
  })
})

describe('unit formatting', () => {
  it('writes durations in the unit that reads best', () => {
    assert.equal(g.formatValue(250_014_939, 'ns'), '250 ms')
    assert.equal(g.formatValue(850, 'ns'), '850 ns')
    assert.equal(g.formatValue(1_500_000_000, 'ns'), '1.5 s')
    assert.equal(g.formatValue(90_000_000_000, 'ns'), '1.5 min')
    assert.equal(g.formatValue(12, 'ms'), '12 ms')
  })

  it('writes sizes in binary units', () => {
    assert.equal(g.formatValue(683 * 1024 * 1024, 'bytes'), '683 MiB')
    assert.equal(g.formatValue(512, 'bytes'), '512 B')
  })

  it('leaves other units to the number format', () => {
    assert.equal(g.formatValue(1234.5, 'EUR'), '1,235 EUR')
    assert.equal(g.formatValue(12.5, '%'), '12.5%')
    assert.equal(g.formatValue(Number.NaN, 'ns'), '—')
  })

  it('shortens axis labels with the unit', () => {
    assert.equal(g.axisValue(332_500_000, 'ns'), '333 ms')
    assert.equal(g.axisValue(20_000), '20K')
    assert.equal(g.isScaledUnit('ns'), true)
    assert.equal(g.isScaledUnit('EUR'), false)
  })
})
