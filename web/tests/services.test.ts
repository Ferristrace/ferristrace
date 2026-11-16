import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { load, stop } from './harness.ts'

type Keys = typeof import('../src/pages/backend/sortKeys')
type View = typeof import('../src/pages/services/serviceView')
type Sorting = typeof import('../src/lib/sorting')

const keys = await load<Keys>('pages/backend/sortKeys.ts')
const view = await load<View>('pages/services/serviceView.ts')
const sorting = await load<Sorting>('lib/sorting.ts')

after(stop)

const service = (name: string, over: Record<string, unknown> = {}) =>
  ({ name, requests: 10, errors: 0, perSecond: 1, p50Us: 1, p95Us: 1, p99Us: 1, rps: '', err: 0, p50: '', p95: '', p99: '', seen: '', lastSeenMs: 0, ...over }) as never

describe('@spec-l19-10 sort keys', () => {
  it('reads the sort and its direction from the url, falling back to the page default', () => {
    const first = (key: string) => (key === 'name' ? 'asc' : 'desc') as 'asc' | 'desc'
    assert.deepEqual(keys.sortingFrom(['cpu', 'name'], 'cpu', first, undefined, undefined), { key: 'cpu', dir: 'desc' })
    assert.deepEqual(keys.sortingFrom(['cpu', 'name'], 'cpu', first, 'name', undefined), { key: 'name', dir: 'asc' })
    assert.deepEqual(keys.sortingFrom(['cpu', 'name'], 'cpu', first, 'name', 'desc'), { key: 'name', dir: 'desc' })
    assert.deepEqual(keys.sortingFrom(['cpu', 'name'], 'cpu', first, 'nope', 'sideways'), { key: 'cpu', dir: 'desc' })
  })

  it('writes the default sort as no search param at all', () => {
    const first = keys.textFirst
    assert.deepEqual(keys.searchOf({ key: 'cpu', dir: 'desc' }, 'cpu', first), { s: undefined, sd: undefined })
    assert.deepEqual(keys.searchOf({ key: 'cpu', dir: 'asc' }, 'cpu', first), { s: undefined, sd: 'asc' })
    assert.deepEqual(keys.searchOf({ key: 'name', dir: 'asc' }, 'cpu', first), { s: 'name', sd: undefined })
    assert.deepEqual(keys.searchOf({ key: 'name', dir: 'desc' }, 'cpu', first), { s: 'name', sd: 'desc' })
  })

  it('sorts the services by every header and keeps services without data last', () => {
    const rows = [service('b', { err: 2, perSecond: 5, p95Us: 30, lastSeenMs: 1 }), service('a', { err: null, perSecond: 9, p95Us: 10, lastSeenMs: 3 }), service('c', { err: 5, perSecond: 1, p95Us: 20, lastSeenMs: 2 })]
    const by = (key: Parameters<Keys['serviceValue']>[1], dir: 'asc' | 'desc') => sorting.sorted(rows, { key, dir }, keys.serviceValue).map((row: { name: string }) => row.name)
    assert.deepEqual(by('err', 'desc'), ['c', 'b', 'a'])
    assert.deepEqual(by('err', 'asc'), ['b', 'c', 'a'])
    assert.deepEqual(by('rps', 'desc'), ['a', 'b', 'c'])
    assert.deepEqual(by('p95', 'asc'), ['a', 'c', 'b'])
    assert.deepEqual(by('seen', 'desc'), ['a', 'c', 'b'])
    assert.deepEqual(by('name', 'asc'), ['a', 'b', 'c'])
  })

  it('sorts the backend tables by the value the column shows', () => {
    const hosts = [{ name: 'h2', cpu: 10, memory: null, disk: 5, load: 0.5 }, { name: 'h1', cpu: 90, memory: 40, disk: null, load: 2 }] as never[]
    assert.deepEqual(sorting.sorted(hosts, { key: 'cpu', dir: 'desc' }, keys.hostValue).map((row: { name: string }) => row.name), ['h1', 'h2'])
    assert.deepEqual(sorting.sorted(hosts, { key: 'memory', dir: 'desc' }, keys.hostValue).map((row: { name: string }) => row.name), ['h1', 'h2'])
    assert.deepEqual(sorting.sorted(hosts, { key: 'disk', dir: 'asc' }, keys.hostValue).map((row: { name: string }) => row.name), ['h2', 'h1'])
    const caches = [{ group: 'get', store: 'redis', hits: 5, misses: 5, hitRate: 50, perSecond: 1 }, { group: 'set', store: 'memcached', hits: 0, misses: 0, hitRate: null, perSecond: 3 }] as never[]
    assert.deepEqual(sorting.sorted(caches, { key: 'rate', dir: 'asc' }, keys.cacheValue).map((row: { group: string }) => row.group), ['get', 'set'])
    assert.equal(keys.cacheFirst('rate'), 'asc')
    assert.deepEqual(sorting.sorted(caches, { key: 'store', dir: 'asc' }, keys.cacheValue).map((row: { group: string }) => row.group), ['set', 'get'])
    const fanouts = [{ statement: 'b', traces: 1, worst: 30, calls: 30 }, { statement: 'a', traces: 4, worst: 20, calls: 80 }]
    assert.deepEqual(sorting.sorted(fanouts, { key: 'calls', dir: 'desc' }, keys.fanoutValue).map((row: { statement: string }) => row.statement), ['a', 'b'])
  })

  it('sorts the releases by release, last seen and error rate', () => {
    const release = (service: string, version: string, over: Record<string, unknown>) => ({ service, version, environments: [], firstSeenMs: 0, lastSeenMs: 0, requests: 0, errors: 0, newIssues: 0, ...over }) as never
    const rows = [release('api', '1.10.0', { requests: 100, errors: 5, lastSeenMs: 2 }), release('api', '1.2.0', { requests: 0, lastSeenMs: 3 }), release('web', '3.0.0', { requests: 10, errors: 5, lastSeenMs: 1 })]
    const by = (key: Parameters<Keys['releaseValue']>[1], dir: 'asc' | 'desc') => sorting.sorted(rows, { key, dir }, keys.releaseValue).map((row: { version: string }) => row.version)
    assert.deepEqual(by('release', 'asc'), ['1.2.0', '1.10.0', '3.0.0'])
    assert.deepEqual(by('last', 'desc'), ['1.2.0', '1.10.0', '3.0.0'])
    assert.deepEqual(by('err', 'desc'), ['3.0.0', '1.10.0', '1.2.0'])
  })
})

describe('@spec-l19-11 service pages', () => {
  it('reads the tab from the search param and shows Overview without it', () => {
    assert.equal(view.tabOf(undefined), 'overview')
    assert.equal(view.tabOf('nope'), 'overview')
    assert.equal(view.tabOf('logs'), 'logs')
    assert.equal(view.tabSearch('overview'), undefined)
    assert.equal(view.tabSearch('traces'), 'traces')
  })

  it('quotes the service in the query the traces and logs pages read', () => {
    assert.equal(view.serviceQuery('checkout-api'), 'service = "checkout-api"')
    assert.equal(view.serviceQuery('we"ird\\name'), 'service = "we\\"ird\\\\name"')
  })

  it('splits the edges of a service into callers and callees, busiest first', () => {
    const edge = (caller: string, callee: string, calls: number) => ({ caller, callee, calls, errors: 0, err: 0 })
    const found = view.neighbours([edge('web', 'api', 5), edge('cron', 'api', 9), edge('api', 'db', 3), edge('api', 'api', 1), edge('x', 'y', 99)], 'api')
    assert.deepEqual(found.callers.map((one: { caller: string }) => one.caller), ['cron', 'web'])
    assert.deepEqual(found.callees.map((one: { callee: string }) => one.callee), ['db'])
  })

  it('asks for the hours around a release and never past now', () => {
    const hour = 60 * 60 * 1000
    const old = view.releaseWindow(100 * hour, 200 * hour, 3 * hour)
    assert.deepEqual(old, { windowMs: 6 * hour, shiftMs: 97 * hour, fromMs: 97 * hour, toMs: 103 * hour })
    const fresh = view.releaseWindow(100 * hour, 101 * hour, 3 * hour)
    assert.deepEqual(fresh, { windowMs: 4 * hour, shiftMs: 0, fromMs: 97 * hour, toMs: 101 * hour })
    assert.equal(view.pointOf(105, 100, 5), 1)
  })
})

describe('@spec-l19-10 service tabs tables', () => {
  it('sorts traces by duration and logs by severity rank', () => {
    const traces = [{ root: 'GET /a', code: 200, startedAtMs: 1, durationMs: 5, spans: 2, errors: 0 }, { root: 'GET /b', code: null, startedAtMs: 2, durationMs: 50, spans: 9, errors: 1 }]
    assert.deepEqual(sorting.sorted(traces, { key: 'duration', dir: 'desc' }, view.traceValue).map((row: { root: string }) => row.root), ['GET /b', 'GET /a'])
    assert.deepEqual(sorting.sorted(traces, { key: 'code', dir: 'asc' }, view.traceValue).map((row: { root: string }) => row.root), ['GET /a', 'GET /b'])
    const logs = [{ time_ns: 1, severity: 'error', body: 'b' }, { time_ns: 2, severity: 'info', body: 'a' }, { time_ns: 3, severity: 'fatal', body: 'c' }]
    assert.deepEqual(sorting.sorted(logs, { key: 'severity', dir: 'desc' }, view.logValue).map((row: { body: string }) => row.body), ['c', 'b', 'a'])
    assert.deepEqual(sorting.sorted(logs, { key: 'body', dir: 'asc' }, view.logValue).map((row: { body: string }) => row.body), ['a', 'b', 'c'])
  })
})
