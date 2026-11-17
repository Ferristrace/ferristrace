import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createElement, html, load, stop } from './harness.ts'

type Rules = typeof import('../src/pages/home/attention')
type Status = typeof import('../src/pages/home/StatusLine')
type List = typeof import('../src/pages/home/AttentionList')
type Figures = typeof import('../src/pages/home/figures')
type Hub = typeof import('../src/pages/home/hub')
type TilesView = typeof import('../src/pages/home/Tiles')
type Changes = typeof import('../src/pages/home/Changes')
type Empty = typeof import('../src/pages/home/EmptyProject')
type Item = import('../src/pages/home/attention').Item
type Stepped = import('../src/data/services').Stepped

const rules = await load<Rules>('pages/home/attention.ts')
const status = await load<Status>('pages/home/StatusLine.tsx')
const list = await load<List>('pages/home/AttentionList.tsx')
const figures = await load<Figures>('pages/home/figures.ts')
const hub = await load<Hub>('pages/home/hub.ts')
const tiles = await load<TilesView>('pages/home/Tiles.tsx')
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
  html(createElement(status.StatusLine, { status: state, checked, missing, now: NOW }))

const rows = (items: Item[], state: import('../src/pages/home/attention').Status, missing: string[] = [], notes: string[] = []) =>
  html(createElement(list.Attention, { items, status: state, missing, notes, checked, now: NOW }))

const series = (requests: number, errors: number, p95Ms: number | null): Stepped => ({ stepMs: 60_000, requests, errors, p95Ms, points: [] })

describe('@spec-l17-10 the home states', () => {
  it('calm says nothing needs attention and what was checked', () => {
    const out = line({ kind: 'calm' })
    assert.match(out, /Nothing needs attention/)
    assert.match(out, /Checked 12 services, 3 alert rules, 24 pods, 0 open incidents/)
    assert.doesNotMatch(out, /NaN|undefined/)
    assert.match(rows([], { kind: 'calm' }), /Nothing needs attention/)
  })

  it('attention lists ranked rows with severity word, time, action button and real links', () => {
    const items = [
      item({ id: 'a', severity: 'warning' }),
      item({ id: 'b', kind: 'incident', severity: 'critical', title: 'Checkout is down', to: '/incidents/42', evidence: { label: 'Open alert', to: '/alerts?rule=9' }, since: NOW - 4 * MIN }),
    ]
    const state = rules.status(items, [], NOW, NOW)
    assert.match(line(state), /2 things need attention/)
    const out = rows(items, state)
    assert.match(out, /<span role="status"[^>]*>2 things need attention<\/span>/)
    assert.ok(out.indexOf('Checkout is down') < out.indexOf('>checkout<'))
    assert.match(out, /Critical/)
    assert.match(out, /Warning/)
    assert.match(out, /Open incident/)
    assert.match(out, /Open alert/)
    assert.match(out, /Open traces/)
    assert.match(out, /open 4 min/)
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
    const out = html(createElement(status.StatusLine, { status: { kind: 'calm' }, checked: { ...checked, rules: null, incidents: null }, missing: [], now: NOW }))
    assert.match(out, /<div role="status"[^>]*><h3[^>]*>Nothing needs attention<\/h3><\/div>/)
    assert.match(out, /Checked 12 services, 24 pods/)
    assert.doesNotMatch(out, /alert rule|open incident/)
    assert.match(rows([], { kind: 'calm' }, [], ['Not visible to you: alerts.']), /Not visible to you: alerts\./)
  })

  it('a truncated list says so instead of calm', () => {
    assert.match(line({ kind: 'partial', names: ['issues'] }), /Only part of issues was checked/)
    assert.match(rows([], { kind: 'partial', names: ['issues'] }), /was truncated/)
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
    assert.match(rows([], { kind: 'unchecked', names: ['alerts', 'pods'] }, ['alerts', 'pods']), /Could not check alerts and pods/)
    assert.match(rows([item({})], { kind: 'attention', count: 1, worst: 'warning' }, ['alerts']), /Could not check alerts, so this list may be incomplete/)
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

describe('@spec-l22-1 home figures', () => {
  const issues = { value: 17, note: null, fresh: 5, cut: false }
  const build = (now: Stepped | null, before: Stepped | null, failed = 1175) =>
    hub.tilesOf(figures.figuresOf(now, before, 3_600_000, '1 hour', 'ok'), { value: failed, note: null }, issues, 3_600_000, new Date(2026, 10, 17, 8, 0).getTime(), '1 h')
  const out = (list: import('../src/pages/home/hub').Tile[]) => html(createElement(tiles.Tiles, { tiles: list }))

  it('shows four tiles with value and comparison, and no sparkline', () => {
    const text = out(build(series(7200, 144, 300), series(3600, 36, 200)))
    assert.match(text, /Failed spans/)
    assert.match(text, /1,175/)
    assert.match(text, /\+1\.0 pp vs previous 1 h/)
    assert.match(text, /2\.0\/s/)
    assert.match(text, /\+100 % vs previous 1 h/)
    assert.match(text, /300 ms/)
    assert.match(text, /\+50 % vs previous 1 h/)
    assert.match(text, /Open issues/)
    assert.match(text, />17</)
    assert.match(text, /\+5 since 07:00/)
    assert.doesNotMatch(text, /<svg|<polyline/)
  })

  it('fills failed spans red and p95 amber only when they got worse', () => {
    const worse = build(series(7200, 144, 300), series(3600, 36, 200))
    assert.deepEqual(worse.map((tile) => tile.fill), ['error', null, 'warning', null])
    assert.match(out(worse), /data-fill="error"/)
    const better = build(series(7200, 36, 200), series(3600, 36, 300))
    assert.deepEqual(better.map((tile) => tile.fill), [null, null, null, null])
    const flat = build(series(7200, 144, 300), series(7200, 144, 300))
    assert.deepEqual(flat.map((tile) => tile.fill), [null, null, null, null])
    const none = build(series(7200, 0, 300), series(3600, 36, 200), 0)
    assert.equal(none[0].fill, null)
    const small = build(series(7200, 144, 310), series(7200, 144, 300))
    assert.equal(small[2].fill, null)
  })

  it('shows no delta when the previous period holds no data', () => {
    const list = build(series(7200, 144, 300), series(0, 0, null))
    assert.ok(list.every((one) => one.fill === null))
    const text = out(list)
    assert.doesNotMatch(text, /vs previous/)
    assert.match(text, /No previous period to compare/)
    assert.doesNotMatch(out(build(series(7200, 144, 300), null)), /vs previous/)
  })

  it('says what is unknown when the period itself holds nothing or failed', () => {
    assert.match(out(build(series(0, 0, null), series(10, 0, 1))), /No request in the last 1 hour/)
    const failed = hub.tilesOf(figures.figuresOf(null, null, 3_600_000, '1 hour', 'failed'), { value: null, note: 'Could not read the services.' }, { value: null, note: 'Could not read the issues.', fresh: 0, cut: false }, 3_600_000, NOW, '1 h')
    const text = out(failed)
    assert.match(text, /Could not read the figures/)
    assert.match(text, /Could not read the services/)
    assert.match(text, /Could not read the issues/)
    assert.match(out(hub.tilesOf(figures.figuresOf(null, null, 3_600_000, '1 hour', 'pending'), { value: null, note: null }, issues, 3_600_000, NOW, '1 h')), /Reading the figures/)
    assert.doesNotMatch(out(build(null, null)), /NaN|undefined/)
  })

  it('says when the previous period could not be read, and gives no delta', () => {
    const list = figures.figuresOf(series(7200, 144, 300), null, 3_600_000, '1 hour', 'ok', {}, 'failed')
    assert.ok(list.every((one) => one.delta.tone === 'none' && one.delta.text === ''))
    const text = out(hub.tilesOf(list, { value: 3, note: null }, issues, 3_600_000, NOW, '1 h'))
    assert.match(text, /Could not read the previous period/)
    assert.doesNotMatch(text, /vs previous/)
  })

  it('gives the error rate no verdict and no fill under 20 requests in either period', () => {
    const thin = build(series(15, 3, 100), series(500, 5, 100), 3)
    assert.equal(thin[0].fill, null)
    assert.match(thin[0].sub, /Fewer than 20 requests, no verdict/)
    const fine = build(series(500, 50, 100), series(500, 5, 100), 50)
    assert.equal(fine[0].fill, 'error')
  })

  it('counts a truncated issue list as a floor', () => {
    const list = hub.tilesOf([], { value: 0, note: null }, { value: 200, note: null, fresh: 3, cut: true }, 3_600_000, NOW, '1 h')
    assert.equal(list[3].value, '200+')
  })

  it('keeps the placement on the links', () => {
    const list = figures.figuresOf(series(10, 0, 1), series(10, 0, 1), 3_600_000, '1 hour', 'ok', { namespace: 'shop' })
    assert.equal(list[0].to, '/services?namespace=shop')
    assert.match(list[1].to, /^\/traces\?/)
    assert.match(list[1].to, /namespace=shop/)
    const placed = hub.tilesOf(list, { value: 0, note: null }, issues, 3_600_000, NOW, '1 h', { namespace: 'shop' })
    assert.match(placed[0].to, /namespace=shop/)
    assert.equal(placed[1].to, '/services?namespace=shop')
  })
})
