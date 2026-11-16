import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { load, stop } from './harness.ts'

const math = await load<typeof import('../src/components/ft/chartMath')>('components/ft/chartMath.ts')
const geometry = await load<typeof import('../src/components/ft/panels/geometry')>('components/ft/panels/geometry.ts')
const marks = await load<typeof import('../src/components/ft/panels/MarkerLayer')>('components/ft/panels/MarkerLayer.tsx')

after(stop)

describe('nearestPoint', () => {
  it('snaps a pointer fraction to the closest data point', () => {
    assert.equal(math.nearestPoint(5, 0), 0)
    assert.equal(math.nearestPoint(5, 1), 4)
    assert.equal(math.nearestPoint(5, 0.37), 1)
    assert.equal(math.nearestPoint(5, 0.38), 2)
  })

  it('clamps a pointer outside the plot', () => {
    assert.equal(math.nearestPoint(5, -2), 0)
    assert.equal(math.nearestPoint(5, 7), 4)
  })

  it('has no point for an empty series and one for a single value', () => {
    assert.equal(math.nearestPoint(0, 0.5), -1)
    assert.equal(math.nearestPoint(1, 0.9), 0)
  })
})

describe('stepIndex', () => {
  it('moves one point with the arrows and stops at the ends', () => {
    assert.equal(math.stepIndex(2, 'ArrowRight', 5), 3)
    assert.equal(math.stepIndex(2, 'ArrowLeft', 5), 1)
    assert.equal(math.stepIndex(4, 'ArrowRight', 5), 4)
    assert.equal(math.stepIndex(0, 'ArrowLeft', 5), 0)
  })

  it('starts from the first point going right and from the last going left', () => {
    assert.equal(math.stepIndex(null, 'ArrowRight', 5), 0)
    assert.equal(math.stepIndex(null, 'ArrowLeft', 5), 4)
  })

  it('jumps with Home and End', () => {
    assert.equal(math.stepIndex(2, 'Home', 5), 0)
    assert.equal(math.stepIndex(2, 'End', 5), 4)
  })

  it('ignores other keys and empty series', () => {
    assert.equal(math.stepIndex(2, 'a', 5), null)
    assert.equal(math.stepIndex(null, 'ArrowRight', 0), null)
  })
})

describe('lineRows', () => {
  it('lists the main line, the second line and the threshold in that order', () => {
    const rows = math.lineRows({ title: 'Error rate', values: [1, 2, 3], second: [4, 5, 6], secondLabel: 'Before', threshold: 2 }, 1)
    assert.deepEqual(rows.map((row) => [row.key, row.value]), [['Error rate', 2], ['Before', 5], ['threshold', 2]])
  })

  it('leaves out the second line and the threshold when they are not given', () => {
    const rows = math.lineRows({ title: 'Requests', values: [1, 2, 3] }, 0)
    assert.deepEqual(rows.map((row) => row.key), ['Requests'])
  })

  it('reports a missing or non finite value as null', () => {
    const rows = math.lineRows({ title: 'p95', values: [1, null, Number.NaN], second: [1] }, 1)
    assert.equal(rows[0].value, null)
    assert.equal(rows[1].value, null)
    assert.equal(math.lineRows({ title: 'p95', values: [1, null, Number.NaN] }, 2)[0].value, null)
  })

  it('gives every row its own index and marks none as nearest', () => {
    const rows = math.lineRows({ title: 'a', values: [1], second: [2], threshold: 3 }, 0)
    assert.deepEqual(rows.map((row) => row.at), [0, 1, 2])
    assert.ok(rows.every((row) => !row.nearest))
  })
})

describe('stackRows', () => {
  it('starts with the total then lists the layers from the largest', () => {
    const rows = math.stackRows([{ key: 'a', values: [1, 2] }, { key: '', values: [3, 1] }], 0, ['x', 'y'])
    assert.deepEqual(rows.map((row) => [row.key, row.value]), [['total', 4], ['(none)', 3], ['a', 1]])
    assert.deepEqual(rows.map((row) => row.colour).slice(1), ['y', 'x'])
  })
})

describe('time of a point', () => {
  it('reads the time of a point and interpolates between two', () => {
    assert.equal(math.timeAtIndex([1000, 2000, 3000], 1), 2000)
    assert.equal(math.timeAtIndex([1000, 2000, 3000], 1.5), 2500)
    assert.equal(math.timeAtIndex([1000, 2000, 3000], 5), 3000)
    assert.equal(math.timeAtIndex([], 0), null)
  })
})

describe('clockOf', () => {
  const at = new Date(2026, 0, 5, 14, 3, 9).getTime()

  it('shows seconds only for a step under a minute', () => {
    assert.equal(math.clockOf(at, 15_000, 3_600_000), '14:03:09')
    assert.equal(math.clockOf(at, 60_000, 3_600_000), '14:03')
    assert.equal(math.clockOf(at, 300_000, 3_600_000), '14:03')
  })

  it('adds the day when the range is longer than a day', () => {
    assert.equal(math.clockOf(at, 3_600_000, 7 * 86_400_000), '01-05 14:03')
  })
})

describe('headerOf', () => {
  it('uses the time of the point when times are given', () => {
    const at = new Date(2026, 0, 5, 14, 3, 0).getTime()
    assert.equal(math.headerOf([at, at + 60_000], ['a', 'b'], 1), '14:04')
  })

  it('falls back to an x label only when the point sits on it', () => {
    const labels = ['10:00', '10:15', '10:30', '10:45', '11:00']
    assert.equal(math.headerOf(undefined, labels, 0, 5), '10:00')
    assert.equal(math.headerOf(undefined, labels, 4, 5), '11:00')
  })

  it('never invents a time between two labels', () => {
    const labels = ['10:00', '10:15', '10:30', '10:45', '11:00']
    assert.equal(math.headerOf(undefined, labels, 7, 33), null)
  })
})

describe('placeTooltip', () => {
  it('opens to the right of the guide when there is room', () => {
    assert.equal(math.placeTooltip(100, 160, 0, 600), 108)
  })

  it('flips to the left near the right edge', () => {
    assert.equal(math.placeTooltip(500, 160, 0, 560), 332)
  })

  it('never leaves the allowed box on a narrow screen', () => {
    const x = math.placeTooltip(150, 320, -50, 300)
    assert.ok(x >= -50 && x + 320 <= 300)
    assert.equal(math.placeTooltip(10, 400, -50, 300), -50)
  })
})

describe('zoomRange', () => {
  it('maps two fractions onto the times of the chart', () => {
    assert.deepEqual(math.zoomRange(0.5, 0.25, [1000, 2000, 3000, 4000, 5000]), { fromMs: 2000, toMs: 3000 })
  })

  it('gives nothing for an empty drag or a single point', () => {
    assert.equal(math.zoomRange(0.3, 0.3, [1000, 2000]), null)
    assert.equal(math.zoomRange(0, 1, [1000]), null)
  })
})

describe('nearbyBy', () => {
  it('keeps what lies within two percent of the span around a centre', () => {
    const found = geometry.nearbyBy([{ p: 10 }, { p: 12.5 }, { p: 13 }], (one) => one.p, 10, 100)
    assert.deepEqual(found.map((one) => one.p), [10])
    const wide = geometry.nearbyBy([{ p: 10 }, { p: 12.5 }, { p: 13 }], (one) => one.p, 10, 1000)
    assert.deepEqual(wide.map((one) => one.p), [10, 12.5, 13])
  })

  it('is what releasesNear uses on the dashboard', () => {
    const near = marks.releasesNear([{ atNs: 100, label: 'a', to: '/a' }, { atNs: 5000, label: 'b', to: '/b' }], 110, 1000)
    assert.deepEqual(near.map((one) => one.label), ['a'])
  })
})
