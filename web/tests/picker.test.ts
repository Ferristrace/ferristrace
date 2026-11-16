import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createElement, html, load, stop } from './harness.ts'

type Picker = typeof import('../src/pages/dashboards/editor/PanelPicker')
type Thumb = typeof import('../src/pages/dashboards/editor/Thumbnail')
type Dash = typeof import('../src/data/dashboards')

const picker = await load<Picker>('pages/dashboards/editor/PanelPicker.tsx')
const thumb = await load<Thumb>('pages/dashboards/editor/Thumbnail.tsx')
const dash = await load<Dash>('data/dashboards.ts')

after(stop)

const body = (props: { initialText?: string; initialGroup?: string | null } = {}): string => html(createElement(picker.PickerBody, { onPick: () => undefined, ...props }))

const kindsIn = (out: string): string[] => [...out.matchAll(/data-kind="([a-z_]+)"/g)].map((match) => match[1])

const groupsIn = (out: string): string[] => [...out.matchAll(/data-group="([a-z]+)"/g)].map((match) => match[1])

describe('the panel picker', () => {
  it('lists all eleven kinds under the six groups, in order', () => {
    const out = body()
    assert.deepEqual(kindsIn(out), ['time_series', 'area', 'bar', 'pie', 'scatter', 'histogram', 'heatmap', 'number', 'table', 'list', 'text'])
    assert.deepEqual(groupsIn(out), ['trends', 'compare', 'distributions', 'single', 'raw', 'docs'])
    for (const label of ['Trends over time', 'Compare &amp; rank', 'Distributions', 'Single values', 'Raw records', 'Documentation']) assert.match(out, new RegExp(`>${label}<`))
  })

  it('shows a name, a one line description and a thumbnail for every kind', () => {
    const out = body()
    for (const kind of dash.PANEL_KINDS) {
      assert.match(out, new RegExp(`data-thumbnail="${kind}"`))
      assert.match(out, new RegExp(`data-kind="${kind}"`))
    }
    for (const name of ['Time Series', 'Area Chart', 'Bar Chart', 'Pie Chart', 'Scatter Plot', 'Histogram', 'Heatmap', 'Number', 'Table', 'List', 'Text']) assert.match(out, new RegExp(`>${name}<`))
  })

  it('searches by name', () => {
    assert.deepEqual(kindsIn(body({ initialText: 'pie' })), ['pie'])
    assert.deepEqual(kindsIn(body({ initialText: 'HEAT' })), ['heatmap'])
  })

  it('searches by description', () => {
    assert.ok(kindsIn(body({ initialText: 'markdown' })).includes('text'))
  })

  it('hides the groups that have no match', () => {
    const out = body({ initialText: 'pie' })
    assert.deepEqual(groupsIn(out), ['compare'])
    assert.doesNotMatch(out, /<h3[^>]*>Trends over time</)
  })

  it('says so when nothing matches', () => {
    const out = body({ initialText: 'zzzz' })
    assert.deepEqual(kindsIn(out), [])
    assert.match(out, /No panel type matches/)
  })

  it('filters by group chip', () => {
    assert.deepEqual(kindsIn(body({ initialGroup: 'raw' })), ['table', 'list'])
    assert.deepEqual(kindsIn(body({ initialGroup: 'distributions' })), ['histogram', 'heatmap'])
  })

  it('combines the search and the chip', () => {
    assert.deepEqual(kindsIn(body({ initialGroup: 'compare', initialText: 'bar' })), ['bar'])
    assert.deepEqual(kindsIn(body({ initialGroup: 'raw', initialText: 'pie' })), [])
  })

  it('draws a chip for every group and marks the chosen one', () => {
    const out = body({ initialGroup: 'single' })
    assert.equal((out.match(/aria-pressed="true"/g) ?? []).length, 1)
    assert.equal((out.match(/aria-pressed="false"/g) ?? []).length, 6)
    assert.match(out, /aria-pressed="true"[^>]*>Single values</)
  })

  it('has a labelled search box that takes the focus', () => {
    const out = body()
    assert.match(out, /aria-label="Search panel types"/)
    assert.match(out, /type="search"/)
  })

  it('every option is a real button, so the keyboard reaches it', () => {
    const out = body()
    assert.equal((out.match(/<button[^>]*data-kind=/g) ?? []).length, 11)
    assert.equal((out.match(/<button[^>]*type="button"[^>]*data-kind=/g) ?? []).length, 11)
  })

  it('draws a thumbnail for each of the eleven kinds', () => {
    for (const kind of dash.PANEL_KINDS) {
      const out = html(createElement(thumb.Thumbnail, { kind }))
      assert.match(out, /<svg[^>]*aria-hidden="true"/)
      assert.match(out, /<(g|text)\b/)
      assert.doesNotMatch(out, /NaN|undefined/)
    }
  })
})
