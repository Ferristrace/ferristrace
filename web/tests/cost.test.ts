import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import type { Bill, Hour, Metered, Pricing, ProjectUsage } from '../src/data/usage.ts'
import { load, stop } from './harness.ts'

type Money = typeof import('../src/pages/cost/money')
type Shape = typeof import('../src/pages/cost/shape')

const money = await load<Money>('pages/cost/money.ts')
const shape = await load<Shape>('pages/cost/shape.ts')

after(stop)

const DAY = 86_400_000
const GB = 1_000_000_000
const NOV = Date.UTC(2026, 10, 1)
const DEC = Date.UTC(2026, 11, 1)
const OCT = Date.UTC(2026, 9, 1)
const NOW = NOV + 10 * DAY

const pricing: Pricing = {
  currency: 'EUR',
  spans_gb_micros: 300_000,
  logs_gb_micros: 100_000,
  metrics_million_micros: 100_000,
  included: { spans_bytes: 12 * GB, logs_bytes: 0, metrics_points: 0 },
}

const hour = (day: number, spans: number, logs: number, metrics: number): Hour => ({
  started_at_ms: NOV + day * DAY,
  ingested_bytes: spans + logs,
  spans_bytes: spans,
  logs_bytes: logs,
  metrics_points: metrics,
})

const hours = Array.from({ length: 10 }, (_, day) => hour(day, GB, 2 * GB, 1_000_000))

const checkout: ProjectUsage = {
  project: 'a1',
  name: 'checkout',
  spans_bytes: 6 * GB,
  logs_bytes: 12 * GB,
  metrics_points: 6_000_000,
  days: Array.from({ length: 6 }, (_, day) => ({ day_ms: NOV + day * DAY, spans_bytes: GB, logs_bytes: 2 * GB, metrics_points: 1_000_000 })),
}

const rest: ProjectUsage = {
  project: null,
  name: null,
  spans_bytes: 4 * GB,
  logs_bytes: 8 * GB,
  metrics_points: 4_000_000,
  days: Array.from({ length: 4 }, (_, day) => ({ day_ms: NOV + (6 + day) * DAY, spans_bytes: GB, logs_bytes: 2 * GB, metrics_points: 1_000_000 })),
}

const gone: ProjectUsage = { project: 'b2', name: null, spans_bytes: 0, logs_bytes: GB, metrics_points: 0, days: [{ day_ms: NOV, spans_bytes: 0, logs_bytes: GB, metrics_points: 0 }] }

const priced: Metered = {
  ingested_bytes: 30 * GB,
  included_bytes: null,
  by_signal: { spans_bytes: 10 * GB, logs_bytes: 20 * GB, metrics_points: 10_000_000, unsplit_hours: 0 },
  hours,
  pricing,
  projects: [checkout, rest],
}

const earlier: Metered = {
  ...priced,
  by_signal: { spans_bytes: 5 * GB, logs_bytes: 10 * GB, metrics_points: 5_000_000, unsplit_hours: 0 },
  hours: [],
  projects: [{ ...checkout, spans_bytes: 3 * GB, logs_bytes: 6 * GB, metrics_points: 3_000_000, days: [] }],
}

const at = { from: NOV, to: DEC, now: NOW }

describe('cost money', () => {
  it('@spec-l21-2 prices a volume with the vectors Rust shares', () => {
    const spans = { ...pricing, included: { spans_bytes: 0, logs_bytes: 0, metrics_points: 0 } }
    assert.equal(money.valueMicros(spans, 'spans', 1_500_000_000), 450_000)
    assert.equal(money.valueMicros(spans, 'spans', 1), 0)
    assert.equal(money.valueMicros({ ...spans, spans_gb_micros: 200 }, 'spans', 2_500_000), 1)
    assert.equal(money.valueMicros({ ...spans, metrics_million_micros: 100_000 }, 'metrics', 3_000_000), 300_000)
  })

  it('@spec-l21-2 bills only what is above the allowance', () => {
    const one = { ...pricing, spans_gb_micros: 300_000, included: { spans_bytes: GB, logs_bytes: 0, metrics_points: 0 } }
    assert.equal(money.billableMicros(one, 'spans', 1_500_000_000), 150_000)
    assert.equal(money.billableMicros(one, 'spans', 500_000_000), 0)
    assert.equal(money.valueMicros(one, 'spans', 1_500_000_000), 450_000)
  })

  it('@spec-l21-2 saturates at the largest 64 bit figure and counts nothing for no volume', () => {
    const huge = { ...pricing, spans_gb_micros: Number.MAX_SAFE_INTEGER }
    assert.equal(money.valueMicros(huge, 'spans', Number.MAX_SAFE_INTEGER * 4000), Number((1n << 64n) - 1n))
    assert.equal(money.valueMicros(pricing, 'logs', 0), 0)
    assert.equal(money.valueMicros(pricing, 'logs', Number.NaN), 0)
  })

  it('@spec-l21-3 projects at the pace of the elapsed time, with a one hour floor', () => {
    assert.equal(money.projectedVolume(100, NOV, DEC, NOW), 300)
    assert.equal(money.projectedVolume(10, NOV, DEC, NOV + 60_000), 7200)
    assert.equal(money.projectedVolume(100, OCT, NOV, NOW), 100)
    assert.equal(money.projectedVolume(0, NOV, DEC, NOW), 0)
  })

  it('@spec-l21-3 dates the day an allowance is passed, only inside the window', () => {
    assert.equal(money.passesAt(100, 200, NOV, DEC, NOW), NOV + 20 * DAY)
    assert.equal(money.passesAt(100, 1000, NOV, DEC, NOW), null)
    assert.equal(money.passesAt(100, 0, NOV, DEC, NOW), null)
    assert.equal(money.passesAt(100, 200, OCT, NOV, NOW), null)
  })

  it('@spec-l21-3 builds a whole bill from volumes', () => {
    const bill = money.billOf(pricing, { spans: 10 * GB, logs: 20 * GB, metrics: 10_000_000 }, NOV, DEC, NOW)
    assert.equal(bill.value_micros, 6_000_000)
    assert.equal(bill.billable_micros, 3_000_000)
    assert.equal(bill.projected_value_micros, 18_000_000)
    assert.equal(bill.projected_billable_micros, 14_400_000)
    assert.equal(bill.by_signal.spans.passes_at_ms, NOV + 12 * DAY)
    assert.equal(bill.by_signal.logs.passes_at_ms, null)
  })

  it('@spec-l21-7 formats money from micros, rounding half up to the currency digits', () => {
    assert.equal(money.formatMoney(233_750_000, 'EUR'), '€233.75')
    assert.equal(money.formatMoney(233_750_000, 'USD'), '$233.75')
    assert.equal(money.formatMoney(1_005_000, 'USD'), '$1.01')
    assert.equal(money.formatMoney(1_500_000, 'JPY'), '¥2')
    assert.equal(money.formatMoney(0, 'EUR'), '€0.00')
    assert.equal(money.formatMoney(1_500_000, 'EU'), '1.50 EU')
    assert.equal(money.axisMoney(300_000_000, 'USD'), '$300')
    assert.equal(money.axisMoney(2_500_000, 'USD'), '$2.50')
  })

  it('@spec-l21-7 compares with the same days of last month', () => {
    assert.equal(money.percentChange(106, 100), 6)
    assert.equal(money.percentChange(96, 100), -4)
    assert.equal(money.percentChange(5, 0), null)
    assert.equal(money.percentChange(5, undefined), null)
    assert.equal(money.signed(6), '+6 %')
    assert.equal(money.signed(-4), '-4 %')
    assert.equal(money.signed(0), '0 %')
  })
})

describe('cost page shaping', () => {
  it('@spec-l21-7 picks the month and the same elapsed days of the one before', () => {
    assert.deepEqual(shape.windowOf('this', NOW), [NOV, DEC])
    assert.deepEqual(shape.windowOf('last', NOW), [OCT, NOV])
    assert.deepEqual(shape.previousWindow(NOV, DEC, NOW), [OCT, OCT + 10 * DAY])
    assert.deepEqual(shape.previousWindow(OCT, NOV, NOW), [Date.UTC(2026, 8, 1), OCT])
    assert.equal(shape.pillOf(NOV, DEC, NOW), 'November, day 11 of 30')
    assert.equal(shape.pillOf(OCT, NOV, NOW), 'October, 31 days')
  })

  it('@spec-l21-7 shows the bill, the projection and the allowance most used', () => {
    const view = shape.viewOf({ metered: priced, before: earlier, choice: shape.ALL, ...at })
    assert.equal(view.priced, true)
    assert.equal(view.single, false)
    assert.deepEqual(view.tiles.map((tile) => tile.label), ['Spend to date', 'Projected bill', 'Spans included', 'Usage value'])
    assert.equal(view.tiles[0].value, '€3.00')
    assert.equal(view.tiles[0].sub, '+100 % vs the same days of last month')
    assert.equal(view.tiles[1].value, '€14.40')
    assert.equal(view.tiles[1].sub, 'renews Dec 1')
    assert.equal(view.tiles[2].value, '83 %')
    assert.equal(view.tiles[2].tone, 'warn')
    assert.equal(view.tiles[2].sub, '10.0 GB of 12.0 GB · passes it Nov 13')
    assert.equal(view.tiles[3].value, '€6.00')
    assert.equal(view.tiles[3].sub, '€3.00 covered by what is included')
  })

  it('@spec-l21-7 turns the tile red once an allowance is used up', () => {
    const over = { ...priced, pricing: { ...pricing, included: { ...pricing.included, spans_bytes: 5 * GB } } }
    const tile = shape.viewOf({ metered: over, before: undefined, choice: shape.ALL, ...at }).tiles[2]
    assert.equal(tile.tone, 'err')
    assert.equal(tile.value, '200 %')
    assert.match(tile.sub ?? '', /over it/)
  })

  it('@spec-l21-7 shows the bill the server sent as it came', () => {
    const bill: Bill = { ...money.billOf(pricing, { spans: 10 * GB, logs: 20 * GB, metrics: 10_000_000 }, NOV, DEC, NOW), billable_micros: 123_450_000 }
    const view = shape.viewOf({ metered: { ...priced, bill }, before: undefined, choice: shape.ALL, ...at })
    assert.equal(view.tiles[0].value, '€123.45')
    assert.equal(view.tiles[0].sub, undefined)
  })

  it('@spec-l21-7 draws the usage value to date, then a dashed projection to the month end, even under the allowance', () => {
    const view = shape.viewOf({ metered: priced, before: undefined, choice: shape.ALL, ...at })
    assert.equal(view.slots, 30)
    assert.equal(view.last, 10)
    assert.equal(view.actual[10], 6_000_000)
    assert.equal(view.actual[11], null)
    assert.equal(view.ahead[9], null)
    assert.equal(view.ahead[10], 6_000_000)
    assert.equal(view.ahead[29], 18_000_000)
    assert.equal(view.total, 6_000_000)
    assert.equal(view.bars.length, 11)
    assert.equal(view.bars.reduce((sum, bar) => sum + bar.total, 0), 6_000_000)
    assert.ok(view.bars[0].parts.spans > 0)
    assert.equal(view.slices.reduce((sum, slice) => sum + slice.value, 0), 6_000_000)
    assert.ok(view.slices.every((slice) => slice.value > 0))
  })

  it('@spec-l21-7 lays out one quota bar per signal, with the pace', () => {
    const view = shape.viewOf({ metered: priced, before: undefined, choice: shape.ALL, ...at })
    assert.deepEqual(view.quotas.map((quota) => quota.signal), ['spans', 'logs', 'metrics'])
    assert.equal(view.quotas[0].note, 'on pace to pass 12.0 GB on Nov 13')
    assert.equal(view.quotas[0].tone, 'warn')
    assert.equal(view.quotas[1].share, null)
    assert.equal(view.quotas[1].note, 'on pace for 60.0 GB')
    assert.equal(view.quotas[2].note, 'on pace for 30.0 M')
  })

  it('@spec-l21-7 shows the value of one project and hides the bill and the allowances', () => {
    const view = shape.viewOf({ metered: priced, before: earlier, choice: 'a1', ...at })
    assert.equal(view.single, true)
    assert.deepEqual(view.tiles.map((tile) => tile.label), ['Value to date', 'Projected value', 'Share of the organisation'])
    assert.equal(view.tiles[0].value, '€3.60')
    assert.equal(view.tiles[0].sub, '+100 % vs the same days of last month')
    assert.equal(view.tiles[1].value, '€10.80')
    assert.equal(view.tiles[2].value, '60 %')
    assert.deepEqual(view.quotas, [])
    assert.equal(view.total, 3_600_000)
    assert.equal(view.actual[10], 3_600_000)
    assert.equal(view.bars.reduce((sum, bar) => sum + bar.total, 0), 3_600_000)
  })

  it('@spec-l21-7 reads the project key, the nameless ones and an unknown pick', () => {
    const named = { ...priced, projects: [checkout, rest, gone] }
    assert.deepEqual(shape.choicesOf(named), [
      { value: 'all', label: 'All projects' },
      { value: 'a1', label: 'checkout' },
      { value: 'b2', label: 'Deleted project' },
      { value: 'none', label: 'No project' },
    ])
    assert.deepEqual(shape.totalsOf(named, 'none'), { spans: 4 * GB, logs: 8 * GB, metrics: 4_000_000 })
    assert.deepEqual(shape.totalsOf(named, 'missing'), { spans: 0, logs: 0, metrics: 0 })
    assert.deepEqual(shape.totalsOf(undefined, shape.ALL), { spans: 0, logs: 0, metrics: 0 })
  })

  it('@spec-l21-7 counts hours without a split for nothing', () => {
    const unsplit: Hour = { started_at_ms: NOV, ingested_bytes: 9 * GB, spans_bytes: null, logs_bytes: null, metrics_points: null }
    const days = shape.daysOf({ ...priced, hours: [unsplit, hour(0, GB, 0, 0)] }, shape.ALL, NOV, 30)
    assert.equal(days.spans[0], GB)
    assert.equal(days.logs[0], 0)
  })

  it('@spec-l21-7 lists the projects with their value, per day and change', () => {
    const rows = shape.rowsOf({ metered: priced, before: earlier, signal: shape.ALL, ...at })
    assert.deepEqual(rows.map((row) => row.name), ['checkout', 'No project'])
    assert.equal(rows[0].figure, 3_600_000)
    assert.equal(rows[0].change, 100)
    assert.equal(rows[1].change, null)
    assert.equal(rows[0].days.length, 11)
    assert.equal(rows[0].days.reduce((sum, value) => sum + value, 0), rows[0].figure)
    const logs = shape.rowsOf({ metered: priced, before: earlier, signal: 'logs', ...at })
    assert.equal(logs[0].figure, 1_200_000)
  })

  it('@spec-l21-7 falls back to volumes when the server has no prices or no project split', () => {
    const old: Metered = { ingested_bytes: 30 * GB, included_bytes: null, by_signal: priced.by_signal, hours }
    const view = shape.viewOf({ metered: old, before: undefined, choice: shape.ALL, ...at })
    assert.equal(view.priced, false)
    assert.deepEqual(view.tiles.map((tile) => tile.label), ['Ingested to date', 'Projected at month end', 'Metric datapoints', 'Busiest day'])
    assert.equal(view.tiles[0].value, '30.0 GB')
    assert.equal(view.tiles[1].value, '90.0 GB')
    assert.equal(view.tiles[2].value, '10.0 M')
    assert.equal(view.tiles[3].value, '3.00 GB')
    assert.equal(view.tiles[3].sub, 'Nov 1')
    assert.deepEqual(view.shown, ['logs', 'spans'])
    assert.equal(view.format(2_500_000_000), '2.50 GB')
    assert.equal(view.actual[10], 30 * GB)
    assert.ok(view.quotas.every((quota) => quota.included === null && quota.share === null))
    assert.deepEqual(shape.rowsOf({ metered: old, before: undefined, signal: shape.ALL, ...at }), [])
    assert.deepEqual(shape.choicesOf(old), [{ value: 'all', label: 'All projects' }])
  })

  it('@spec-l21-7 closes a past month without a projection or a pace', () => {
    const last = shape.viewOf({ metered: { ...priced, hours: [] }, before: undefined, choice: shape.ALL, from: OCT, to: NOV, now: NOW })
    assert.equal(last.last, 30)
    assert.ok(last.ahead.every((value) => value === null))
    assert.equal(last.tiles[1].label, 'Bill for the month')
    assert.equal(last.tiles[1].sub, 'month closed')
    assert.equal(last.quotas[1].note, 'month closed')
  })
})
