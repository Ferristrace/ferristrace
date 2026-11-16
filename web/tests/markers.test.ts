import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { load, stop } from './harness.ts'

const layer = await load<typeof import('../src/components/ft/MarkerLayer')>('components/ft/MarkerLayer.tsx')
const panels = await load<typeof import('../src/components/ft/panels/MarkerLayer')>('components/ft/panels/MarkerLayer.tsx')

after(stop)

const pin = (frac: number, label = `r${frac}`) => ({ frac, label })

describe('release clusters', () => {
  it('keeps releases that are far apart on their own', () => {
    const clusters = layer.clusterPins([pin(0.1), pin(0.5), pin(0.9)], 600)
    assert.deepEqual(clusters.map((cluster) => cluster.pins.length), [1, 1, 1])
  })

  it('merges releases closer than twelve pixels into one cluster', () => {
    const clusters = layer.clusterPins([pin(0.5), pin(0.505), pin(0.51), pin(0.9)], 600)
    assert.deepEqual(clusters.map((cluster) => cluster.pins.length), [3, 1])
    assert.ok(Math.abs(clusters[0].frac - 0.505) < 1e-9)
  })

  it('does not chain a long run into one cluster', () => {
    const run = Array.from({ length: 10 }, (_, at) => pin(0.2 + at * 0.01))
    const clusters = layer.clusterPins(run, 600)
    assert.ok(clusters.length > 1)
    assert.equal(clusters.reduce((total, cluster) => total + cluster.pins.length, 0), 10)
  })

  it('sorts its input and survives an empty list', () => {
    assert.deepEqual(layer.clusterPins([], 600), [])
    assert.deepEqual(layer.clusterPins([pin(0.8), pin(0.2)], 600).map((cluster) => cluster.pins[0].label), ['r0.2', 'r0.8'])
  })
})

describe('releases near the pointer', () => {
  const marks = [
    { atNs: 1_000, label: 'a', to: '/releases/a' },
    { atNs: 1_050, label: 'b', to: '/releases/b' },
    { atNs: 9_000, label: 'c', to: '/releases/c' },
  ]

  it('lists the releases within two percent of the range, oldest first', () => {
    assert.deepEqual(panels.releasesNear(marks, 1_040, 10_000).map((mark) => mark.label), ['a', 'b'])
  })

  it('lists none far from every release', () => {
    assert.deepEqual(panels.releasesNear(marks, 5_000, 10_000), [])
  })
})
