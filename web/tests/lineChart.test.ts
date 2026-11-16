import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createElement, html, load, stop } from './harness.ts'

const charts = await load<typeof import('../src/components/ft/charts')>('components/ft/charts.tsx')

after(stop)

const LABELS = ['10:00', '10:15', '10:30', '10:45', '11:00']

const base = { title: 'Requests', hi: 10, yLabels: ['10', '5', '0'] as [string, string, string], xLabels: LABELS, aria: 'Requests per second of api', height: 120 }

const render = (props: Record<string, unknown>) => html(createElement(charts.LineChart, { ...base, values: [], ...props } as never))

describe('LineChart markup', () => {
  it('draws the title, the grid and one polyline for a series', () => {
    const out = render({ values: [1, 4, 2, 8] })
    assert.match(out, /Requests/)
    assert.equal((out.match(/<polyline/g) ?? []).length, 1)
  })

  it('is a focusable group that names its keys', () => {
    const out = render({ values: [1, 4, 2, 8] })
    assert.match(out, /role="group"/)
    assert.match(out, /tabindex="0"/)
    assert.match(out, /aria-label="Requests per second of api\.[^"]*arrow[^"]*Home[^"]*P[^"]*Escape/i)
  })

  it('lets the page scroll vertically while a finger drags across', () => {
    assert.match(render({ values: [1, 4] }), /touch-pan-y/)
  })

  it('shows no tooltip and no live text at rest', () => {
    const out = render({ values: [1, 4, 2, 8], times: [1, 2, 3, 4] })
    assert.doesNotMatch(out, /role="tooltip"/)
    assert.doesNotMatch(out, /aria-live="polite"[^>]*>[^<]+</)
  })

  it('shows the latest value in the header, formatted', () => {
    const out = render({ values: [1, 4, 2, 8], format: (value: number) => `${value} req/s` })
    assert.match(out, /8 req\/s/)
  })

  it('draws the threshold as a dashed line', () => {
    const out = render({ values: [1, 4], threshold: 5 })
    assert.match(out, /stroke-dasharray="4 4"/)
  })

  it('draws the second line when given', () => {
    const out = render({ values: [1, 4], second: [2, 3] })
    assert.equal((out.match(/<polyline/g) ?? []).length, 2)
  })
})

describe('LineChart edge cases', () => {
  it('renders an empty series without a line, a value or a crash', () => {
    const out = render({ values: [] })
    assert.doesNotMatch(out, /<polyline/)
    assert.match(out, /role="group"/)
    assert.match(out, /—/)
  })

  it('renders one point as a dot', () => {
    const out = render({ values: [3] })
    assert.doesNotMatch(out, /<polyline/)
    assert.match(out, /<circle/)
  })

  it('breaks the line at a missing value', () => {
    const out = render({ values: [1, 2, null, 4, 5] })
    assert.equal((out.match(/<polyline/g) ?? []).length, 2)
  })

  it('shows a dash as the latest value when it is missing', () => {
    const out = render({ values: [1, 2, null] })
    assert.match(out, /—/)
  })

  it('does not draw NaN into a path', () => {
    const out = render({ values: [1, Number.NaN, 3] })
    assert.doesNotMatch(out, /NaN/)
  })
})

describe('StackedChart markup', () => {
  const stacked = (props: Record<string, unknown>) =>
    html(createElement(charts.StackedChart, { title: 'Spend', layers: [{ key: 'a', values: [1, 2, 3] }, { key: 'b', values: [2, 1, 0] }], yLabels: () => ['3', '1', '0'], xLabels: LABELS, aria: 'Spend', ...props } as never))

  it('is a focusable group with one band per layer', () => {
    const out = stacked({})
    assert.match(out, /role="group"/)
    assert.match(out, /tabindex="0"/)
    assert.equal((out.match(/<polygon/g) ?? []).length, 2)
  })

  it('renders with no layer', () => {
    assert.match(stacked({ layers: [] }), /role="group"/)
  })
})
