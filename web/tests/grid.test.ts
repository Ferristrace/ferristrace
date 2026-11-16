import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { load, stop } from './harness.ts'

type Grid = typeof import('../src/pages/dashboards/editor/grid')

const grid = await load<Grid>('pages/dashboards/editor/grid.ts')

after(stop)

type Item = { panel: string; x: number; y: number; w: number; h: number }

const at = (items: Item[], id: string): Item => {
  const found = items.find((one) => one.panel === id)
  assert.ok(found, `${id} is placed`)
  return found
}

const noGaps = (items: Item[]) => {
  for (const one of items) {
    if (one.y === 0) continue
    const lifted = { ...one, y: one.y - 1 }
    assert.ok(
      items.some((other) => other !== one && grid.collides(other, lifted)),
      `${one.panel} could still move up`,
    )
  }
}

const noOverlap = (items: Item[]) => {
  items.forEach((one, index) => {
    items.slice(index + 1).forEach((other) => assert.equal(grid.collides(one, other), false, `${one.panel} overlaps ${other.panel}`))
  })
}

const stack: Item[] = [
  { panel: 'a', x: 0, y: 0, w: 12, h: 2 },
  { panel: 'b', x: 0, y: 2, w: 12, h: 3 },
]

const pair: Item[] = [
  { panel: 'a', x: 0, y: 0, w: 6, h: 2 },
  { panel: 'b', x: 6, y: 0, w: 6, h: 2 },
]

describe('compaction', () => {
  it('lifts every panel until it rests on another or the top', () => {
    const out = grid.compact([
      { panel: 'a', x: 0, y: 5, w: 4, h: 2 },
      { panel: 'b', x: 6, y: 9, w: 4, h: 2 },
      { panel: 'c', x: 0, y: 12, w: 12, h: 1 },
    ])
    assert.deepEqual(out.map((one) => [one.panel, one.y]), [['a', 0], ['b', 0], ['c', 2]])
    noGaps(out)
  })

  it('pushes overlapping panels down instead of stacking them', () => {
    const out = grid.compact([
      { panel: 'a', x: 0, y: 0, w: 6, h: 3 },
      { panel: 'b', x: 3, y: 1, w: 6, h: 3 },
    ])
    noOverlap(out)
    assert.equal(at(out, 'a').y, 0)
    assert.equal(at(out, 'b').y, 3)
  })

  it('clamps a panel to the twelve columns and to one cell at least', () => {
    const [one] = grid.compact([{ panel: 'a', x: 10, y: -3, w: 9, h: 0 }])
    assert.deepEqual(one, { panel: 'a', x: 3, y: 0, w: 9, h: 1 })
    const [wide] = grid.compact([{ panel: 'a', x: 0, y: 0, w: 40, h: 2 }])
    assert.equal(wide.w, 12)
  })

  it('leaves an already compact layout alone', () => {
    assert.deepEqual(grid.compact(stack), stack)
  })

  it('does not change the input', () => {
    const input = [{ panel: 'a', x: 0, y: 4, w: 3, h: 2 }]
    grid.compact(input)
    assert.equal(input[0].y, 4)
  })
})

describe('keyboard move', () => {
  it('moves a panel one column right and pushes the neighbour down', () => {
    const out = grid.nudge(pair, 'a', 1, 0)
    assert.equal(at(out, 'a').x, 1)
    assert.ok(at(out, 'b').y >= 2)
    noOverlap(out)
    noGaps(out)
  })

  it('stops at the right edge', () => {
    const out = grid.nudge(pair, 'b', 1, 0)
    assert.equal(at(out, 'b').x, 6)
  })

  it('stops at the left edge', () => {
    const out = grid.nudge(pair, 'a', -1, 0)
    assert.equal(at(out, 'a').x, 0)
  })

  it('moves a panel down past the one below it', () => {
    const out = grid.nudge(stack, 'a', 0, 1)
    assert.equal(at(out, 'b').y, 0)
    assert.equal(at(out, 'a').y, 3)
    noOverlap(out)
  })

  it('moves a panel up past the one above it', () => {
    const out = grid.nudge(stack, 'b', 0, -1)
    assert.equal(at(out, 'b').y, 0)
    assert.equal(at(out, 'a').y, 3)
  })

  it('does nothing when moving up from the top', () => {
    assert.deepEqual(grid.nudge(stack, 'a', 0, -1), stack)
  })

  it('does nothing for an unknown panel', () => {
    assert.deepEqual(grid.nudge(stack, 'zzz', 1, 0), stack)
  })
})

describe('keyboard resize', () => {
  it('widens by one column and pushes the neighbour down', () => {
    const out = grid.resizeBy(pair, 'a', 1, 0)
    assert.equal(at(out, 'a').w, 7)
    noOverlap(out)
    assert.equal(at(out, 'b').y, 2)
  })

  it('never goes below one cell', () => {
    const out = grid.resizeBy([{ panel: 'a', x: 0, y: 0, w: 1, h: 1 }], 'a', -1, -1)
    assert.deepEqual(out[0], { panel: 'a', x: 0, y: 0, w: 1, h: 1 })
  })

  it('never goes past the right edge', () => {
    const out = grid.resizeBy([{ panel: 'a', x: 8, y: 0, w: 4, h: 2 }], 'a', 3, 0)
    assert.equal(out[0].w, 4)
  })

  it('grows taller and keeps the layout compact', () => {
    const out = grid.resizeBy(stack, 'a', 0, 2)
    assert.equal(at(out, 'a').h, 4)
    assert.equal(at(out, 'b').y, 4)
    noGaps(out)
  })

  it('caps the height', () => {
    const out = grid.resizeBy([{ panel: 'a', x: 0, y: 0, w: 4, h: grid.MAX_ROWS }], 'a', 0, 5)
    assert.equal(out[0].h, grid.MAX_ROWS)
  })
})

describe('size presets', () => {
  it('has small, medium, large and full width', () => {
    assert.deepEqual(grid.SIZES.map((one) => one.key), ['s', 'm', 'l', 'full'])
  })

  it('applies a preset and keeps the layout compact', () => {
    const out = grid.setSize(pair, 'a', 'full')
    assert.equal(at(out, 'a').w, 12)
    assert.equal(at(out, 'a').x, 0)
    noOverlap(out)
    assert.equal(at(out, 'a').h, 2)
  })

  it('keeps the height of a panel for full width', () => {
    const out = grid.setSize([{ panel: 'a', x: 0, y: 0, w: 4, h: 7 }], 'a', 'full')
    assert.deepEqual(out[0], { panel: 'a', x: 0, y: 0, w: 12, h: 7 })
  })

  it('moves a panel left when the preset would overflow', () => {
    const out = grid.setSize([{ panel: 'a', x: 9, y: 0, w: 3, h: 2 }], 'a', 'm')
    assert.equal(at(out, 'a').x + at(out, 'a').w <= 12, true)
    assert.equal(at(out, 'a').w, 6)
  })
})

describe('add, duplicate, remove', () => {
  it('appends a panel below the others at the left edge', () => {
    const out = grid.append(stack, 'c', 6, 4)
    assert.deepEqual(at(out, 'c'), { panel: 'c', x: 0, y: 5, w: 6, h: 4 })
  })

  it('puts the new panel under a short one, not beside it', () => {
    const out = grid.append([{ panel: 'a', x: 0, y: 0, w: 4, h: 3 }], 'b', 4, 3)
    assert.deepEqual(at(out, 'b'), { panel: 'b', x: 0, y: 3, w: 4, h: 3 })
  })

  it('duplicates under the original with the same size', () => {
    const out = grid.duplicate(stack, 'a', 'a2')
    assert.equal(out.length, 3)
    assert.deepEqual(at(out, 'a2'), { panel: 'a2', x: 0, y: 2, w: 12, h: 2 })
    assert.equal(at(out, 'b').y, 4)
    noOverlap(out)
  })

  it('removes a panel and closes the gap', () => {
    const out = grid.remove(stack, 'a')
    assert.deepEqual(out, [{ panel: 'b', x: 0, y: 0, w: 12, h: 3 }])
  })

  it('removes nothing for an unknown panel', () => {
    assert.deepEqual(grid.remove(stack, 'zzz'), stack)
  })
})

describe('reading order on a narrow screen', () => {
  it('moves a panel later in the reading order', () => {
    const out = grid.reorder(pair, 'a', 1)
    const order = [...out].sort((l, r) => l.y - r.y || l.x - r.x).map((one) => one.panel)
    assert.deepEqual(order, ['b', 'a'])
    noOverlap(out)
  })

  it('moves a panel earlier', () => {
    const out = grid.reorder(stack, 'b', -1)
    const order = [...out].sort((l, r) => l.y - r.y || l.x - r.x).map((one) => one.panel)
    assert.deepEqual(order, ['b', 'a'])
  })

  it('keeps the first panel first when asked to go earlier', () => {
    assert.deepEqual(grid.reorder(stack, 'a', -1), stack)
  })

  it('keeps every size', () => {
    const out = grid.reorder(pair, 'a', 1)
    assert.deepEqual([at(out, 'a').w, at(out, 'a').h, at(out, 'b').w, at(out, 'b').h], [6, 2, 6, 2])
  })
})

describe('what the server accepts', () => {
  it('reports a layout that fits as valid', () => {
    assert.equal(grid.fits(stack), true)
    assert.equal(grid.fits([{ panel: 'a', x: 8, y: 0, w: 5, h: 1 }]), false)
    assert.equal(grid.fits([{ panel: 'a', x: 0, y: 0, w: 0, h: 1 }]), false)
  })

  it('always yields a layout that fits after compaction', () => {
    const out = grid.compact([{ panel: 'a', x: 11, y: 0, w: 12, h: 1 }, { panel: 'b', x: 7, y: 0, w: 9, h: 2 }])
    assert.equal(grid.fits(out), true)
  })
})
