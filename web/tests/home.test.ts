import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createElement, html, load, stop } from './harness.ts'

type Rules = typeof import('../src/pages/home/attention')
type Status = typeof import('../src/pages/home/StatusLine')
type List = typeof import('../src/pages/home/AttentionList')
type Figures = typeof import('../src/pages/home/Figures')
type Changes = typeof import('../src/pages/home/Changes')
type Empty = typeof import('../src/pages/home/EmptyProject')
type Item = import('../src/pages/home/attention').Item
type Stepped = import('../src/data/services').Stepped

const rules = await load<Rules>('pages/home/attention.ts')
const status = await load<Status>('pages/home/StatusLine.tsx')
const list = await load<List>('pages/home/AttentionList.tsx')
const figures = await load<Figures>('pages/home/Figures.tsx')
const changes = await load<Changes>('pages/home/Changes.tsx')
const empty = await load<Empty>('pages/home/EmptyProject.tsx')

after(stop)

const NOW = Date.now()
const MIN = 60_000
const checked = { services: 12, rules: 3, pods: 24, incidents: 0 }

const item = (over: Partial<Item>): Item => ({
  id: 'x',
  kind: 'service',
  severity: 'warning',
  title: 'checkout',
  detail: '8.0 % of 400 requests failed',
  since: null,
  to: '/services/checkout',
  evidence: { label: 'Open traces', to: '/traces?q=service+%3D+%22checkout%22' },
  magnitude: 8,
  ...over,
})

const line = (state: import('../src/pages/home/attention').Status, missing: string[] = []) =>
  html(createElement(status.StatusLine, { status: state, checked, missing, updatedMs: NOW - 12_000, windowLabel: '1 hour', now: NOW }))

const rows = (items: Item[], state: import('../src/pages/home/attention').Status, missing: string[] = []) =>
  html(createElement(list.Attention, { items, status: state, missing }))

const series = (requests: number, errors: number, p95Ms: number | null): Stepped => ({ stepMs: 60_000, requests, errors, p95Ms, points: [] })

describe('@spec-l17-10 the home states', () => {
  it('calm says nothing needs attention and what was checked', () => {
    const out = line({ kind: 'calm' })
    assert.match(out, /Nothing needs attention/)
    assert.match(out, /Checked 12 services, 3 alert rules, 24 pods, 0 open incidents/)
    assert.match(out, /Updated 12 s ago/)
    assert.match(out, /last 1 hour/)
    assert.doesNotMatch(out, /NaN|undefined/)
    assert.match(rows([], { kind: 'calm' }), /No open incident/)
  })

  it('attention lists ranked rows with severity word, kind, evidence and real links', () => {
    const items = [
      item({ id: 'a', severity: 'warning' }),
      item({ id: 'b', kind: 'incident', severity: 'critical', title: 'Checkout is down', to: '/incidents/42', evidence: { label: 'Open alert', to: '/alerts?rule=9' }, since: NOW - 4 * MIN }),
    ]
    const state = rules.status(items, [], NOW, NOW)
    assert.match(line(state), /2 things need attention/)
    const out = rows(items, state)
    assert.ok(out.indexOf('Checkout is down') < out.indexOf('>checkout<'))
    assert.match(out, /Critical/)
    assert.match(out, /Warning/)
    assert.match(out, /Incident/)
    assert.match(out, /Open alert/)
    assert.match(out, /Open traces/)
    assert.match(out, /4 min ago/)
    assert.match(out, /<a [^>]*href="\/incidents\/42"/)
    assert.match(out, /<a [^>]*href="\/alerts\?rule=9"/)
    assert.doesNotMatch(out, /onclick/i)
    assert.match(line({ kind: 'attention', count: 1, worst: 'warning' }), /1 thing needs attention/)
  })

  it('attention with more than eight items shows "and N more"', () => {
    const items = Array.from({ length: 11 }, (_, at) => item({ id: `s${at}`, title: `svc-${at}`, magnitude: at }))
    const out = rows(items, { kind: 'attention', count: 11, worst: 'warning' })
    assert.equal(out.match(/<li /g)?.length, 8)
    assert.match(out, /and 3 more/)
    assert.match(out, /href="\/services"/)
  })

  it('keeps the detail out of the status region and names the hidden sources', () => {
    const out = html(createElement(status.StatusLine, { status: { kind: 'calm' }, checked: { ...checked, rules: null, incidents: null }, missing: [], notes: ['Not visible to you: alerts.'], updatedMs: null, windowLabel: '1 hour', now: NOW }))
    assert.match(out, /<div role="status"[^>]*><h2[^>]*>Nothing needs attention<\/h2><\/div>/)
    assert.match(out, /Checked 12 services, 24 pods/)
    assert.doesNotMatch(out, /alert rule|open incident/)
    assert.match(out, /Not visible to you: alerts\./)
    assert.match(out, /Not updated yet/)
  })

  it('a truncated list says so instead of calm', () => {
    assert.match(line({ kind: 'partial', names: ['issues'] }), /Only part of issues was checked/)
    assert.match(rows([], { kind: 'partial', names: ['issues'] }), /truncated/)
  })

  it('evidence links carry the item title and the overflow names its kind', () => {
    const out = rows([item({ title: 'checkout' }), item({ id: 'y', title: 'billing', evidence: { label: 'Open traces', to: '/traces' } })], { kind: 'attention', count: 2, worst: 'warning' })
    assert.match(out, /aria-label="Open traces: checkout"/)
    assert.match(out, /aria-label="Open traces: billing"/)
    const more = rows(Array.from({ length: 10 }, (_, at) => item({ id: `s${at}` })), { kind: 'attention', count: 10, worst: 'warning' })
    assert.match(more, /and 2 more, mostly services/)
  })

  it('unchecked names the sources that failed and is never calm', () => {
    const out = line({ kind: 'unchecked', names: ['alerts', 'pods'] })
    assert.match(out, /Could not check alerts and pods/)
    assert.doesNotMatch(out, /Nothing needs attention/)
    assert.doesNotMatch(out, /Checked 12/)
    assert.match(rows([], { kind: 'unchecked', names: ['alerts', 'pods'] }, ['alerts', 'pods']), /Could not check alerts and pods, so this list may be incomplete/)
    const withItem = line({ kind: 'attention', count: 1, worst: 'warning' }, ['alerts'])
    assert.match(withItem, /Could not check alerts/)
    assert.doesNotMatch(withItem, /Nothing needs attention/)
  })

  it('no data says how long no span was received', () => {
    const out = line({ kind: 'nodata', sinceMs: NOW - 14 * MIN })
    assert.match(out, /No span received for 14 min/)
    assert.doesNotMatch(out, /Nothing needs attention/)
    assert.match(line({ kind: 'nodata', sinceMs: null }), /No span received in the last 24 hours/)
  })

  it('an empty project keeps the onboarding', () => {
    Object.assign(globalThis, { window: { location: { origin: 'https://trace.example' } } })
    const out = html(createElement(empty.EmptyProject))
    Reflect.deleteProperty(globalThis, 'window')
    assert.match(out, /No signals yet/)
    assert.match(out, /OTEL_EXPORTER_OTLP_ENDPOINT=https:\/\/trace\.example/)
    assert.match(out, /Connect your first service/)
  })

  it('changes says when there is no release and does not hide a failed read', () => {
    const none = html(createElement(changes.Changes, { releases: [], pending: false, failed: false, windowMs: 86_400_000, now: NOW }))
    assert.match(none, /No release in the last 24 hours/)
    const failed = html(createElement(changes.Changes, { releases: [], pending: false, failed: true, windowMs: 86_400_000, now: NOW }))
    assert.match(failed, /Could not read the releases/)
    const old = [{ service: 'a', version: '1', environments: [], firstSeenMs: NOW - 3 * 86_400_000, lastSeenMs: NOW, requests: 1, errors: 0, newIssues: 0 }]
    assert.deepEqual(changes.recent(old, 86_400_000, NOW), [])
    const many = Array.from({ length: 9 }, (_, at) => ({ ...old[0], version: String(at), firstSeenMs: NOW - at * MIN }))
    assert.deepEqual(changes.recent(many, 86_400_000, NOW).map((one) => one.version), ['0', '1', '2', '3', '4'])
  })
})

describe('home figures', () => {
  const read = (now: Stepped | null, before: Stepped | null) => figures.figuresOf(now, before, 3_600_000, '1 hour', 'ok')
  const out = (list: import('../src/pages/home/Figures').Figure[]) => html(createElement(figures.Figures, { figures: list, short: '1 h' }))

  it('shows value, comparison, a word and no sparkline', () => {
    const text = out(read(series(7200, 144, 300), series(3600, 36, 200)))
    assert.match(text, /2\.0\/s/)
    assert.match(text, /\+100 %/)
    assert.match(text, /vs previous 1 h/)
    assert.match(text, /\+1\.0 pp/)
    assert.match(text, /worse/)
    assert.match(text, /300 ms/)
    assert.doesNotMatch(text, /<svg|<polyline/)
  })

  it('shows no delta when the previous period holds no data', () => {
    const list = read(series(7200, 144, 300), series(0, 0, null))
    assert.ok(list.every((one) => one.delta.tone === 'none'))
    const text = out(list)
    assert.doesNotMatch(text, /vs previous/)
    assert.match(text, /No previous period to compare/)
    assert.doesNotMatch(out(read(series(7200, 144, 300), null)), /vs previous/)
  })

  it('says what is unknown when the period itself holds nothing or failed', () => {
    assert.match(out(read(series(0, 0, null), series(10, 0, 1))), /No request in the last 1 hour/)
    assert.match(out(figures.figuresOf(null, null, 3_600_000, '1 hour', 'failed')), /Could not read the figures/)
    assert.match(out(figures.figuresOf(null, null, 3_600_000, '1 hour', 'pending')), /Reading the figures/)
    assert.doesNotMatch(out(read(null, null)), /NaN|undefined/)
  })

  it('says when the previous period could not be read, and gives no delta', () => {
    const list = figures.figuresOf(series(7200, 144, 300), null, 3_600_000, '1 hour', 'ok', {}, 'failed')
    assert.ok(list.every((one) => one.delta.tone === 'none' && one.delta.text === ''))
    assert.match(out(list), /Could not read the previous period/)
    assert.doesNotMatch(out(list), /vs previous/)
  })

  it('gives the error rate no verdict under 20 requests in either period', () => {
    const thin = figures.figuresOf(series(15, 3, 100), series(500, 5, 100), 3_600_000, '1 hour', 'ok')
    assert.equal(thin[1].delta.tone, 'none')
    assert.match(out(thin), /Fewer than 20 requests, no verdict/)
    assert.doesNotMatch(out(thin).slice(out(thin).indexOf('Error rate'), out(thin).indexOf('p95 latency')), /worse/)
    const fine = figures.figuresOf(series(500, 50, 100), series(500, 5, 100), 3_600_000, '1 hour', 'ok')
    assert.equal(fine[1].delta.tone, 'worse')
  })

  it('keeps the placement on the links', () => {
    const list = figures.figuresOf(series(10, 0, 1), series(10, 0, 1), 3_600_000, '1 hour', 'ok', { namespace: 'shop' })
    assert.equal(list[0].to, '/services?namespace=shop')
    assert.match(list[1].to, /^\/traces\?/)
    assert.match(list[1].to, /namespace=shop/)
  })
})
