import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { load, stop } from './harness.ts'

type Draft = typeof import('../src/pages/dashboards/editor/draft')
type Fixtures = typeof import('../src/components/ft/panels/fixtures')
type Doc = import('../src/data/dashboards').DashboardDoc

const draft = await load<Draft>('pages/dashboards/editor/draft.ts')
const fixtures = await load<Fixtures>('components/ft/panels/fixtures.ts')

after(stop)

const stored = { name: 'Checkout', tags: ['prod', 'web'], doc: fixtures.FIXTURE_DOC }

const base = draft.draftOf(stored)

describe('document to editor state and back', () => {
  it('reads a stored dashboard as a draft', () => {
    assert.equal(base.name, 'Checkout')
    assert.deepEqual(base.tags, ['prod', 'web'])
    assert.equal(base.doc.panels.length, 11)
    assert.equal(base.doc.layout.length, 11)
  })

  it('writes the same document back unchanged', () => {
    const file = draft.fileOf(base)
    assert.equal(file.name, 'Checkout')
    assert.deepEqual(file.tags, ['prod', 'web'])
    assert.deepEqual(file.doc.panels.map((panel) => panel.id), fixtures.FIXTURE_DOC.panels.map((panel) => panel.id))
    assert.deepEqual(file.doc.layout, fixtures.FIXTURE_DOC.layout)
    assert.equal(file.doc.duration, 3600)
    assert.equal(file.doc.schema_version, 1)
  })

  it('round trips through the editor twice to the same file', () => {
    const once = draft.fileOf(base)
    const twice = draft.fileOf(draft.draftOf(once))
    assert.equal(JSON.stringify(twice), JSON.stringify(once))
  })

  it('places a panel the layout forgot and drops a layout item with no panel', () => {
    const doc: Doc = { ...fixtures.FIXTURE_DOC, layout: [...fixtures.FIXTURE_DOC.layout.filter((item) => item.panel !== 'notes'), { panel: 'ghost', x: 0, y: 99, w: 3, h: 3 }] }
    const file = draft.fileOf(draft.draftOf({ ...stored, doc }))
    assert.equal(file.doc.layout.length, 11)
    assert.ok(file.doc.layout.some((item) => item.panel === 'notes'))
    assert.ok(!file.doc.layout.some((item) => item.panel === 'ghost'))
  })

  it('leaves a stored layout with gaps alone until the user moves something', () => {
    const doc: Doc = { ...fixtures.FIXTURE_DOC, panels: fixtures.FIXTURE_DOC.panels.slice(0, 1), layout: [{ panel: 'requests', x: 0, y: 8, w: 8, h: 5 }] }
    const opened = draft.draftOf({ ...stored, doc })
    assert.equal(draft.fileOf(opened).doc.layout[0].y, 8)
    assert.equal(draft.isDirty(opened, draft.draftOf({ ...stored, doc })), false)
    assert.equal(draft.fileOf(draft.setLayout(opened, opened.doc.layout)).doc.layout[0].y, 0)
  })

  it('remembers the version it was read at', () => {
    assert.equal(draft.draftOf({ ...stored, updated_at_ms: 42 }).updatedAt, 42)
    assert.equal(draft.isDirty(draft.draftOf({ ...stored, updated_at_ms: 42 }), draft.draftOf({ ...stored, updated_at_ms: 43 })), false)
  })

  it('counts a title in characters, not UTF-16 units, when duplicating', () => {
    const long = draft.updatePanel(base, { ...base.doc.panels[0], title: '😀'.repeat(115) })
    const { draft: out, id } = draft.duplicatePanel(long, base.doc.panels[0].id)
    const title = out.doc.panels.find((panel) => panel.id === id)?.title ?? ''
    assert.equal(Array.from(title).length <= 120, true)
    assert.match(title, /\(copy\)$/)
  })

  it('trims the name, and trims and de-duplicates the tags', () => {
    const file = draft.fileOf({ ...base, name: '  Checkout  ', tags: [' a ', 'a', '', 'b'] })
    assert.equal(file.name, 'Checkout')
    assert.deepEqual(file.tags, ['a', 'b'])
  })

  it('drops empty filter groups and the empty options the server would not need', () => {
    const panel = { ...fixtures.FIXTURE_DOC.panels[0], queries: [{ ...fixtures.FIXTURE_DOC.panels[0].queries[0], filter: { all: [] } as never }], options: { unit: '', stacked: false, content: '' } }
    const file = draft.fileOf({ ...base, doc: { ...base.doc, panels: [panel], layout: [base.doc.layout[0]] } })
    assert.equal(file.doc.panels[0].queries[0].filter, null)
    assert.deepEqual(file.doc.panels[0].options, {})
  })

  it('parses tags typed as text', () => {
    assert.deepEqual(draft.parseTags('prod, web\nweb ,  '), ['prod', 'web'])
    assert.deepEqual(draft.parseTags(''), [])
  })
})

describe('dirty detection', () => {
  it('a freshly loaded draft is clean', () => {
    assert.equal(draft.isDirty(base, draft.draftOf(stored)), false)
  })

  it('a no-op edit is not dirty', () => {
    const same = draft.updatePanel(base, { ...base.doc.panels[0] })
    assert.equal(draft.isDirty(base, same), false)
    assert.equal(draft.isDirty(base, { ...base, name: 'Checkout ' }), false)
    assert.equal(draft.isDirty(base, { ...base, tags: ['prod', 'web', 'web'] }), false)
  })

  it('moving a panel to where it already is is not dirty', () => {
    const same = draft.setLayout(base, base.doc.layout.map((item) => ({ ...item })).reverse())
    assert.equal(draft.isDirty(base, same), false)
  })

  it('an edit that is undone is clean again', () => {
    const edited = draft.setSettings(base, { name: 'Other' })
    assert.equal(draft.isDirty(base, edited), true)
    assert.equal(draft.isDirty(base, draft.setSettings(edited, { name: 'Checkout' })), false)
  })

  it('key order inside a query does not make a draft dirty', () => {
    const query = base.doc.panels[0].queries[0]
    const shuffled = Object.fromEntries(Object.entries(query).reverse()) as typeof query
    assert.equal(draft.isDirty(base, draft.updatePanel(base, { ...base.doc.panels[0], queries: [shuffled] })), false)
  })

  it('every kind of change is dirty', () => {
    const [first] = base.doc.panels
    assert.equal(draft.isDirty(base, draft.setSettings(base, { duration: 7200 })), true)
    assert.equal(draft.isDirty(base, draft.setSettings(base, { tags: ['prod'] })), true)
    assert.equal(draft.isDirty(base, draft.updatePanel(base, { ...first, title: 'Renamed' })), true)
    assert.equal(draft.isDirty(base, draft.deletePanel(base, 'notes')), true)
    assert.equal(draft.isDirty(base, draft.setVariables(base, [])), true)
    assert.equal(draft.isDirty(base, draft.setLayout(base, draft.moveItem(base.doc.layout, 'errors', 0, 0))), true)
    assert.equal(draft.isDirty(base, draft.duplicatePanel(base, 'errors').draft), true)
  })
})

describe('panel operations', () => {
  it('adds a panel with a fresh id and a default size under the others', () => {
    const panel = draft.makePanel(base.doc, 'pie')
    const out = draft.addPanel(base, panel)
    assert.equal(out.doc.panels.length, 12)
    const item = out.doc.layout.find((one) => one.panel === panel.id)
    assert.ok(item)
    assert.equal(item.x, 0)
    assert.equal(item.y, 25)
    assert.equal(item.w, 4)
  })

  it('never reuses an id', () => {
    const one = draft.makePanel(base.doc, 'time_series')
    const withOne = draft.addPanel(base, one)
    const two = draft.makePanel(withOne.doc, 'time_series')
    assert.notEqual(one.id, two.id)
    assert.match(two.id, /^[A-Za-z0-9_-]{1,64}$/)
  })

  it('duplicates a panel with its own id, a copy title and the same queries', () => {
    const { draft: out, id } = draft.duplicatePanel(base, 'errors')
    const copy = out.doc.panels.find((panel) => panel.id === id)
    assert.ok(copy)
    assert.notEqual(id, 'errors')
    assert.equal(copy.title, 'Errors (copy)')
    assert.deepEqual(copy.queries, base.doc.panels.find((panel) => panel.id === 'errors')?.queries)
    assert.equal(out.doc.layout.length, 12)
  })

  it('keeps a long title within the limit when duplicating', () => {
    const long = draft.updatePanel(base, { ...base.doc.panels[0], title: 'x'.repeat(120) })
    const { draft: out, id } = draft.duplicatePanel(long, base.doc.panels[0].id)
    assert.ok((out.doc.panels.find((panel) => panel.id === id)?.title.length ?? 999) <= 120)
  })

  it('deletes a panel and its layout item', () => {
    const out = draft.deletePanel(base, 'notes')
    assert.equal(out.doc.panels.length, 10)
    assert.equal(out.doc.layout.length, 10)
    assert.ok(!out.doc.layout.some((item) => item.panel === 'notes'))
  })

  it('replaces a panel in place', () => {
    const out = draft.updatePanel(base, { ...base.doc.panels[1], title: 'Failures' })
    assert.equal(out.doc.panels[1].title, 'Failures')
    assert.equal(out.doc.panels.length, 11)
  })

  it('cannot add past the panel limit', () => {
    let full = base
    while (full.doc.panels.length < 30) full = draft.addPanel(full, draft.makePanel(full.doc, 'number'))
    assert.equal(draft.canAddPanel(full), false)
    assert.equal(draft.canAddPanel(base), true)
    assert.match(draft.draftIssues(draft.addPanel(full, draft.makePanel(full.doc, 'number'))).join(' '), /30 panels/)
  })

  it('moves one layout item to a cell', () => {
    const out = draft.moveItem(base.doc.layout, 'errors', 0, 0)
    const item = out.find((one) => one.panel === 'errors')
    assert.equal(item?.x, 0)
    assert.equal(item?.y, 0)
  })
})

describe('what blocks a save', () => {
  it('a clean draft has no issue', () => {
    assert.deepEqual(draft.draftIssues(base), [])
  })

  it('needs a name of at most 120 characters', () => {
    assert.match(draft.draftIssues({ ...base, name: '   ' }).join(' '), /name/i)
    assert.match(draft.draftIssues({ ...base, name: 'x'.repeat(121) }).join(' '), /120/)
  })

  it('allows at most ten tags of 32 characters', () => {
    assert.match(draft.draftIssues({ ...base, tags: Array.from({ length: 11 }, (_, at) => `t${at}`) }).join(' '), /10 tags/)
    assert.match(draft.draftIssues({ ...base, tags: ['x'.repeat(33)] }).join(' '), /32/)
  })

  it('keeps the default range between a minute and 31 days', () => {
    assert.match(draft.draftIssues(draft.setSettings(base, { duration: 59 })).join(' '), /duration/i)
    assert.match(draft.draftIssues(draft.setSettings(base, { duration: 31 * 86_400 + 1 })).join(' '), /duration/i)
    assert.deepEqual(draft.draftIssues(draft.setSettings(base, { duration: 60 })), [])
    assert.deepEqual(draft.draftIssues(draft.setSettings(base, { duration: 31 * 86_400 })), [])
  })

  it('refuses a document over 256 KB', () => {
    let big = draft.draftOf({ name: 'Big', tags: [], doc: draft.emptyDoc() })
    for (let at = 0; at < 20; at += 1) big = draft.addPanel(big, { ...draft.makePanel(big.doc, 'text'), options: { content: 'x'.repeat(19_000) } })
    assert.match(draft.draftIssues(big).join(' '), /256 KB/)
    assert.equal(draft.documentBytes(big) > 256 * 1024, true)
  })

  it('reports a filter that uses a variable nobody declared', () => {
    const out = draft.setVariables(base, [])
    assert.match(draft.draftIssues(out).join(' '), /service/)
  })
})

describe('a panel from the metrics explorer', () => {
  it('builds a time series over the metric, grouped by the labels', () => {
    const panel = draft.panelFromMetric(base.doc, { metric: 'node_memory_bytes', agg: 'avg', groupBy: ['node', 'zone'], unit: 'By' })
    assert.equal(panel.kind, 'time_series')
    assert.equal(panel.title, 'node_memory_bytes')
    assert.deepEqual(panel.queries[0].aggregations, [{ metric: 'node_memory_bytes', time: 'avg', space: 'avg' }])
    assert.deepEqual(panel.queries[0].group_by, [{ attr: 'node' }, { attr: 'zone' }])
    assert.equal(panel.queries[0].signal, 'metrics')
    assert.equal(panel.options.unit, 'By')
  })

  it('maps the explorer aggregations onto time and space aggregation', () => {
    const of = (agg: string) => draft.metricAggregation('m', agg)
    assert.deepEqual(of('rate'), { metric: 'm', time: 'rate', space: 'sum' })
    assert.deepEqual(of('sum'), { metric: 'm', time: 'sum', space: 'sum' })
    assert.deepEqual(of('min'), { metric: 'm', time: 'min', space: 'min' })
    assert.deepEqual(of('max'), { metric: 'm', time: 'max', space: 'max' })
    assert.deepEqual(of('p95'), { metric: 'm', time: 'avg', space: 'avg' })
  })

  it('keeps only the first three labels', () => {
    const panel = draft.panelFromMetric(base.doc, { metric: 'm', agg: 'avg', groupBy: ['a', 'b', 'c', 'd'] })
    assert.equal(panel.queries[0].group_by?.length, 3)
  })

  it('adds it to an empty dashboard', () => {
    const empty = draft.draftOf({ name: 'New', tags: [], doc: draft.emptyDoc() })
    const out = draft.addPanel(empty, draft.panelFromMetric(empty.doc, { metric: 'm', agg: 'avg', groupBy: [] }))
    assert.equal(out.doc.panels.length, 1)
    assert.deepEqual(out.doc.layout, [{ panel: out.doc.panels[0].id, x: 0, y: 0, w: 6, h: 5 }])
  })
})
