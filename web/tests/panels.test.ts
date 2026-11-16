import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createElement, html, load, stop } from './harness.ts'

type Dash = typeof import('../src/data/dashboards')
type Fixtures = typeof import('../src/components/ft/panels/fixtures')
type Panels = typeof import('../src/components/ft/panels/index')
type Link = typeof import('../src/lib/safeLink')
type Markdown = typeof import('../src/lib/markdown')

const dash = await load<Dash>('data/dashboards.ts')
const fixtures = await load<Fixtures>('components/ft/panels/fixtures.ts')
const panels = await load<Panels>('components/ft/panels/index.tsx')
const link = await load<Link>('lib/safeLink.ts')
const markdown = await load<Markdown>('lib/markdown.tsx')

after(stop)

const FROM = 1_700_000_000_000_000_000
const TO = FROM + 3_600_000_000_000

const render = (kind: import('../src/data/dashboards').PanelKind, empty: boolean) => {
  const panel = fixtures.FIXTURE_DOC.panels.find((one) => one.kind === kind)
  assert.ok(panel, `the fixture holds a ${kind} panel`)
  const result = fixtures.fixtureResult(kind, FROM, TO, empty)
  return html(createElement(panels.PanelBody, { panel: { ...panel, options: empty && kind === 'text' ? {} : panel.options }, result, range: { fromNs: FROM, toNs: TO } }))
}

describe('the eleven renderers', () => {
  for (const kind of dash.PANEL_KINDS) {
    it(`${kind} renders from a fixture`, () => {
      const out = render(kind, false)
      assert.match(out, /data-state="data"/)
      assert.doesNotMatch(out, /No data in this range/)
      assert.doesNotMatch(out, /NaN|undefined/)
    })

    it(`${kind} shows its empty state when the query returns nothing`, () => {
      const out = render(kind, true)
      assert.match(out, /data-state="empty"/)
      assert.match(out, kind === 'text' ? /This text panel is empty/ : /No data in this range/)
    })
  }

  it('draws a legend only where the options ask for one', () => {
    const series = panels.TimeSeriesPanel
    const panel = { ...fixtures.FIXTURE_DOC.panels[0] }
    const result = fixtures.fixtureResult('time_series', FROM, TO)
    const at = (legend: 'bottom' | 'right' | 'hidden') => html(createElement(series, { panel: { ...panel, options: { legend } }, result, range: { fromNs: FROM, toNs: TO } }))
    assert.match(at('bottom'), /data-legend="bottom"/)
    assert.match(at('right'), /data-legend="right"/)
    assert.doesNotMatch(at('hidden'), /aria-label="Legend/)
  })

  it('formats the number panel with its unit and decimals', () => {
    const panel = { ...fixtures.FIXTURE_DOC.panels.find((one) => one.kind === 'number')!, options: { unit: 'ms', decimals: 1 } }
    const out = html(createElement(panels.PanelBody, { panel, result: { kind: 'scalar', value: 12.345 }, range: { fromNs: FROM, toNs: TO } }))
    assert.match(out, /12\.3/)
    assert.match(out, /ms/)
  })

  it('tells the reader when a table was cut', () => {
    const panel = fixtures.FIXTURE_DOC.panels.find((one) => one.kind === 'table')!
    const result = { kind: 'rows' as const, columns: ['a'], rows: [['x']], truncated: true }
    assert.match(html(createElement(panels.PanelBody, { panel, result, range: { fromNs: FROM, toNs: TO } })), /the query matched more/)
  })
})

describe('the text panel', () => {
  it('accepts only safe link targets', () => {
    for (const target of ['https://example.com', 'http://example.com/a?b=c', 'mailto:a@b.c', '/releases', '/traces?q=a']) assert.equal(link.isSafeHref(target), true, target)
    for (const target of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>', 'vbscript:x', '//evil.example', '/\\evil.example', '\\\\evil.example', '', 'ftp://x']) assert.equal(link.isSafeHref(target), false, JSON.stringify(target))
  })

  const md = (source: string) => html(createElement(markdown.Markdown, { source }))

  it('renders headings, lists, bold, code and links', () => {
    const out = md('## Title\n\n- one\n- **two**\n\nuse `code` and [docs](https://example.com)')
    assert.match(out, /<h2[^>]*>Title<\/h2>/)
    assert.match(out, /<ul[^>]*><li>one<\/li><li><strong>two<\/strong><\/li><\/ul>/)
    assert.match(out, /<code[^>]*>code<\/code>/)
    assert.match(out, /<a [^>]*href="https:\/\/example.com"[^>]*rel="noreferrer noopener"/)
  })

  it('never emits a raw HTML element from the source', () => {
    const out = md('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<b onclick="x()">hi</b>')
    assert.doesNotMatch(out, /<script/)
    assert.doesNotMatch(out, /<img/)
    assert.doesNotMatch(out, /<b[ >]/)
    assert.match(out, /&lt;script&gt;/)
  })

  it('turns an unsafe link into plain text', () => {
    const out = md('[click](javascript:alert(1)) and [x](data:text/html,hi) and [y](//evil.example)')
    assert.doesNotMatch(out, /href=/)
    assert.match(out, /click/)
  })
})
