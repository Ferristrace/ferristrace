import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createElement, html, load, stop } from './harness.ts'

type Hub = typeof import('../src/pages/home/hub')
type Table = typeof import('../src/pages/home/ServicesTable')
type Item = import('../src/pages/home/attention').Item
type Release = import('../src/data/releases').Release
type Issue = import('../src/data/issues').Issue

const hub = await load<Hub>('pages/home/hub.ts')
const table = await load<Table>('pages/home/ServicesTable.tsx')

after(stop)

const NOW = new Date(2026, 10, 17, 8, 0).getTime()
const MIN = 60_000
const DAY = 24 * 60 * MIN

const item = (over: Partial<Item>): Item => ({
  id: 'x',
  kind: 'service',
  severity: 'warning',
  title: 'checkout',
  detail: '8.0 % of 400 requests failed',
  since: null,
  to: '/services/checkout',
  evidence: { label: 'Open traces', to: '/traces?q=errors' },
  magnitude: 8,
  ...over,
})

const service = (name: string, requests: number, errors: number) => ({ name, requests, errors, err: requests ? (errors / requests) * 100 : null, perSecond: requests / 3600, p99: '1.39 s' })

const release = (name: string, version: string, firstSeenMs: number): Release => ({ service: name, version, environments: [], firstSeenMs, lastSeenMs: NOW, requests: 1, errors: 0, newIssues: 0 })

const issue = (fingerprint: string, status: Issue['status'], firstSeen: number): Issue => ({
  fingerprint,
  project: 'p',
  exception_type: 'TimeoutError',
  message: '',
  service: 'payments',
  events: 1,
  first_seen_at_ms: firstSeen,
  last_seen_at_ms: NOW,
  status,
  owner: null,
  decided_at_ms: 0,
  regressed: false,
})

describe('@spec-l22-1 home hub', () => {
  it('writes local clock times and older times in days', () => {
    assert.equal(hub.clock(new Date(2026, 10, 17, 7, 42).getTime()), '07:42')
    assert.equal(hub.when(NOW - 34 * MIN, NOW), '07:26')
    assert.equal(hub.when(NOW - 3 * DAY - MIN, NOW), '3 d ago')
    assert.equal(hub.when(new Date(2026, 10, 16, 23, 0).getTime(), NOW), '9 h ago')
  })

  it('colours the error rate from the shared threshold', () => {
    assert.equal(hub.heat(8.9), 'bad')
    assert.equal(hub.heat(2.3), 'mid')
    assert.equal(hub.heat(1.85), 'none')
    assert.equal(hub.heat(null), 'none')
  })

  it('lists the five worst error rates first and skips services without traffic', () => {
    const rows = hub.worst([service('a', 100, 1), service('b', 100, 9), service('c', 0, 0), service('d', 100, 2), service('e', 100, 0), service('f', 100, 5), service('g', 100, 3)])
    assert.deepEqual(rows.map((row) => row.name), ['b', 'f', 'g', 'd', 'a'])
  })

  it('names the latest release of a service, or nothing', () => {
    const releases = [release('checkout', 'v2.5.0', NOW - 3 * DAY), release('checkout', 'v2.6.0', NOW - 34 * MIN), release('other', 'v9', NOW)]
    assert.equal(hub.lastRelease('checkout', releases, NOW), 'v2.6.0, 07:26')
    assert.equal(hub.lastRelease('payments', releases, NOW), null)
  })

  it('counts open issues and the ones that appeared in the window', () => {
    const counted = hub.openIssues([issue('a', 'unresolved', NOW - 10 * MIN), issue('b', 'unresolved', NOW - 3 * DAY), issue('c', 'resolved', NOW - MIN), issue('d', 'ignored', NOW - MIN)], 60 * MIN, NOW)
    assert.deepEqual(counted, { open: 2, fresh: 1 })
  })

  it('writes the release delta as signed points with a tone', () => {
    assert.deepEqual(hub.pill({ before: 0.8, after: 7.6, delta: 6.8, tone: 'worse', introduced: 0 }), { text: '+6.8 pp', tone: 'worse' })
    assert.deepEqual(hub.pill({ before: 0.9, after: 0.4, delta: -0.5, tone: 'better', introduced: 0 }), { text: '-0.5 pp', tone: 'better' })
    assert.deepEqual(hub.pill({ before: 0.5, after: 0.5, delta: 0, tone: 'same', introduced: 0 }), { text: '0.0 pp', tone: 'same' })
    assert.deepEqual(hub.pill({ before: 1, after: 5, delta: 4, tone: 'none', introduced: 0 }), { text: '+4.0 pp', tone: 'same' })
    assert.equal(hub.pill({ before: null, after: 1, delta: null, tone: 'none', introduced: 0 }), null)
  })

  it('gives each item an action from its own link, and keeps other evidence aside', () => {
    assert.deepEqual(hub.actionOf(item({})), { label: 'Open traces', to: '/traces?q=errors' })
    assert.equal(hub.extraOf(item({})), null)
    const incident = item({ kind: 'incident', to: '/incidents/4', evidence: { label: 'Open alert', to: '/alerts?rule=9' } })
    assert.deepEqual(hub.actionOf(incident), { label: 'Open incident', to: '/incidents/4' })
    assert.deepEqual(hub.extraOf(incident), { label: 'Open alert', to: '/alerts?rule=9' })
    assert.equal(hub.actionOf(item({ kind: 'alert', to: '/alerts?rule=1' })).label, 'Open alert')
    assert.equal(hub.actionOf(item({ kind: 'issue', to: '/issues/f' })).label, 'Open issue')
    assert.equal(hub.actionOf(item({ kind: 'pods', to: '/infra/kubernetes' })).label, 'Open pods')
    assert.deepEqual(hub.actionOf(item({ kind: 'silent', to: '/services/n' })), { label: 'Open service', to: '/services/n' })
  })

  it('writes the time of an item the way its kind reads', () => {
    assert.equal(hub.timeOf(item({ since: null }), NOW), null)
    assert.equal(hub.timeOf(item({ kind: 'incident', since: NOW - 38 * MIN }), NOW), 'open 38 min')
    assert.equal(hub.timeOf(item({ kind: 'alert', since: new Date(2026, 10, 17, 7, 51).getTime() }), NOW), 'since 07:51')
    assert.equal(hub.timeOf(item({ kind: 'alert', since: NOW - 2 * DAY }), NOW), '2 d ago')
    assert.equal(hub.timeOf(item({ kind: 'issue', since: new Date(2026, 10, 17, 7, 44).getTime() }), NOW), '07:44')
    assert.equal(hub.timeOf(item({ kind: 'silent', since: NOW - 14 * MIN }), NOW), '14 min')
  })

  it('renders the services table with coloured error rates, links and last release', () => {
    const out = html(createElement(table.ServicesTable, {
      services: [service('storefront', 1000, 9), service('checkout', 1000, 89), service('worker', 1000, 23)],
      total: 12,
      releases: [release('checkout', 'v2.6.0', NOW - 34 * MIN)],
      pending: false,
      failed: false,
      place: { namespace: 'shop' },
      now: NOW,
    }))
    assert.match(out, /All 12 services/)
    assert.match(out, /href="\/services\?namespace=shop"/)
    assert.match(out, /href="\/services\/checkout\?namespace=shop"/)
    assert.ok(out.indexOf('checkout') < out.indexOf('worker') && out.indexOf('worker') < out.indexOf('storefront'))
    assert.match(out, /text-destructive-text[^>]*>8\.90 %/)
    assert.match(out, /text-warning-text[^>]*>2\.30 %/)
    assert.match(out, /v2\.6\.0, 07:26/)
    assert.match(out, /Requests per second/)
    assert.match(html(createElement(table.ServicesTable, { services: [], total: 0, releases: [], pending: false, failed: true, place: {}, now: NOW })), /Could not read the services/)
  })
})
