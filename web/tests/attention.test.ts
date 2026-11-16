import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { load, stop } from './harness.ts'

type Attention = typeof import('../src/pages/home/attention')
type Query = typeof import('../src/lib/queryLang')
type Incident = import('../src/data/incidents').Incident
type Issue = import('../src/data/issues').Issue
type Release = import('../src/data/releases').Release
type Item = import('../src/pages/home/attention').Item

const a = await load<Attention>('pages/home/attention.ts')
const query = await load<Query>('lib/queryLang.ts')

after(stop)

const NOW = 1_700_000_000_000
const MIN = 60_000

const item = (over: Partial<Item>): Item => ({
  id: 'x',
  kind: 'service',
  severity: 'warning',
  title: 't',
  detail: 'd',
  since: null,
  to: '/services',
  evidence: null,
  magnitude: 0,
  ...over,
})

const issue = (over: Partial<Issue>): Issue => ({
  fingerprint: 'abcdef123456',
  project: 'p',
  exception_type: 'TimeoutError',
  message: 'upstream timed out',
  service: 'checkout',
  events: 12,
  first_seen_at_ms: NOW - 10 * MIN,
  last_seen_at_ms: NOW - MIN,
  status: 'unresolved',
  owner: null,
  decided_at_ms: 0,
  regressed: false,
  ...over,
})

const release = (over: Partial<Release>): Release => ({
  service: 'checkout',
  version: '1.4.2',
  environments: ['production'],
  firstSeenMs: NOW - 25 * MIN,
  lastSeenMs: NOW,
  requests: 100,
  errors: 1,
  newIssues: 0,
  ...over,
})

const ok = (name: string) => ({ name, state: 'ok' as const })

describe('home attention', () => {
  it('@spec-l17-1 ranks by severity, then kind, then magnitude, keeping input order on ties', () => {
    const items = [
      item({ id: 'w-silent', kind: 'silent', severity: 'warning', magnitude: 99 }),
      item({ id: 'w-service-1', kind: 'service', severity: 'warning', magnitude: 3 }),
      item({ id: 'c-pods', kind: 'pods', severity: 'critical', magnitude: 1 }),
      item({ id: 'w-service-2', kind: 'service', severity: 'warning', magnitude: 9 }),
      item({ id: 'i-incident', kind: 'incident', severity: 'info', magnitude: 5 }),
      item({ id: 'c-incident', kind: 'incident', severity: 'critical', magnitude: 1 }),
      item({ id: 'w-service-3', kind: 'service', severity: 'warning', magnitude: 3 }),
      item({ id: 'w-alert', kind: 'alert', severity: 'warning', magnitude: 0 }),
    ]
    assert.deepEqual(a.rank(items).map((one) => one.id), [
      'c-incident',
      'c-pods',
      'w-alert',
      'w-service-2',
      'w-service-1',
      'w-service-3',
      'w-silent',
      'i-incident',
    ])
    assert.equal(items[0].id, 'w-silent')
  })

  it('@spec-l17-2 is calm only when every source answered and nothing was found', () => {
    const sources = ['incidents', 'alerts', 'services', 'issues', 'pods'].map(ok)
    assert.deepEqual(a.status([], sources, NOW - MIN, NOW), { kind: 'calm' })
    assert.deepEqual(a.status([item({})], sources, NOW - MIN, NOW), { kind: 'attention', count: 1, worst: 'warning' })
    assert.equal(a.status([item({}), item({ severity: 'critical' })], sources, NOW - MIN, NOW).kind, 'attention')
    assert.notEqual(a.status([], [...sources, { name: 'releases', state: 'pending' }], NOW - MIN, NOW).kind, 'calm')
  })

  it('@spec-l17-3 a failed source gives unchecked and never calm, and names the source', () => {
    const sources = [ok('incidents'), { name: 'alerts', state: 'failed' as const }, ok('services'), { name: 'pods', state: 'failed' as const }]
    assert.deepEqual(a.status([], sources, NOW - MIN, NOW), { kind: 'unchecked', names: ['alerts', 'pods'] })
    assert.deepEqual(a.unchecked(sources), ['alerts', 'pods'])
    assert.equal(a.status([], sources, null, NOW).kind, 'unchecked')
  })

  it('@spec-l17-4 lists eight items then counts the rest and links to the dominant kind', () => {
    const many = [
      ...Array.from({ length: 8 }, (_, at) => item({ id: `s${at}`, kind: 'service', severity: 'critical', magnitude: at })),
      item({ id: 'i1', kind: 'issue' }),
      item({ id: 'i2', kind: 'issue' }),
      item({ id: 'p1', kind: 'pods' }),
    ]
    const out = a.listed(many)
    assert.equal(out.shown.length, 8)
    assert.equal(out.more, 3)
    assert.equal(out.to, '/issues')
    const few = a.listed(many.slice(0, 8))
    assert.equal(few.more, 0)
    assert.equal(few.to, '')
  })

  it('@spec-l17-5 a service under 20 requests is not an item', () => {
    const rows = [
      { name: 'few', requests: 19, errors: 19, err: 100 },
      { name: 'enough', requests: 20, errors: 2, err: 10 },
      { name: 'fine', requests: 500, errors: 1, err: 0.2 },
      { name: 'warn', requests: 100, errors: 2, err: 2 },
      { name: 'none', requests: 0, errors: 0, err: null },
    ]
    const out = a.serviceItems(rows, '1 hour')
    assert.deepEqual(out.map((one) => one.title), ['enough', 'warn'])
    assert.equal(out[0].severity, 'critical')
    assert.equal(out[1].severity, 'warning')
    assert.ok(out.every((one) => query.parse(decodeURIComponent(a.linkOf(one.evidence?.to ?? '').search?.q ?? '')).ok))
  })

  it('@spec-l17-6 an issue that appeared after a release names that release', () => {
    const named = a.issueItems([issue({})], [release({})], 60 * MIN, NOW)
    assert.equal(named.length, 1)
    assert.match(named[0].detail, /15 min after release 1\.4\.2/)
    assert.equal(named[0].evidence?.to, '/releases/checkout/1.4.2')
    const late = a.issueItems([issue({})], [release({ firstSeenMs: NOW - 90 * MIN })], 60 * MIN, NOW)
    assert.doesNotMatch(late[0].detail, /release/)
    assert.equal(late[0].evidence, null)
    const other = a.issueItems([issue({})], [release({ service: 'billing' })], 60 * MIN, NOW)
    assert.doesNotMatch(other[0].detail, /release/)
    const old = a.issueItems([issue({ first_seen_at_ms: NOW - 3 * 60 * MIN })], [], 60 * MIN, NOW)
    assert.equal(old.length, 0)
    const resolved = a.issueItems([issue({ status: 'resolved' })], [], 60 * MIN, NOW)
    assert.equal(resolved.length, 0)
  })

  it('@spec-l17-7 deltaOf: rising error rate is worse, falling better, no previous data none, under 5 percent same', () => {
    assert.equal(a.deltaOf(3, 2, 'error').tone, 'worse')
    assert.equal(a.deltaOf(3, 2, 'error').text, '+1.0 pp')
    assert.equal(a.deltaOf(1, 2, 'error').tone, 'better')
    assert.equal(a.deltaOf(1, 2, 'error').text, '−1.0 pp')
    assert.equal(a.deltaOf(3, null, 'error').tone, 'none')
    assert.equal(a.deltaOf(null, 3, 'error').tone, 'none')
    assert.equal(a.deltaOf(0, 0, 'error').tone, 'same')
    assert.equal(a.deltaOf(10.4, 10, 'latency').tone, 'same')
    assert.equal(a.deltaOf(11, 10, 'latency').tone, 'worse')
    assert.equal(a.deltaOf(11, 10, 'latency').text, '+10 %')
    assert.equal(a.deltaOf(9, 10, 'latency').tone, 'better')
    assert.equal(a.deltaOf(112, 100, 'traffic').text, '+12 %')
    assert.equal(a.deltaOf(112, 100, 'traffic').tone, 'same')
    assert.equal(a.deltaOf(5, 0, 'traffic').tone, 'none')
  })

  it('@spec-l17-8 a release effect with fewer than 20 requests before or after has no tone', () => {
    const traffic = (requests: number, rate: number | null) => ({ requests, errors: 0, errorRate: rate })
    const thinBefore = a.releaseEffect({ before: traffic(19, 0.01), after: traffic(500, 0.2), issues: [] })
    assert.equal(thinBefore.tone, 'none')
    assert.equal(thinBefore.before, 1)
    assert.equal(thinBefore.after, 20)
    const thinAfter = a.releaseEffect({ before: traffic(500, 0.01), after: traffic(5, 0.5), issues: [] })
    assert.equal(thinAfter.tone, 'none')
    const worse = a.releaseEffect({ before: traffic(500, 0.01), after: traffic(500, 0.05), issues: [{}, {}] })
    assert.equal(worse.tone, 'worse')
    assert.equal(worse.introduced, 2)
    assert.ok(Math.abs((worse.delta ?? 0) - 4) < 1e-9)
    const better = a.releaseEffect({ before: traffic(500, 0.05), after: traffic(500, 0.01), issues: [] })
    assert.equal(better.tone, 'better')
    assert.equal(a.releaseEffect({ before: traffic(500, null), after: traffic(500, 0.01), issues: [] }).tone, 'none')
  })

  it('@spec-l17-9 a silent service is older than 10 minutes and seen in 24 hours', () => {
    const services = [
      { name: 'live', lastSeenMs: NOW - 2 * MIN },
      { name: 'edge', lastSeenMs: NOW - 10 * MIN },
      { name: 'silent', lastSeenMs: NOW - 11 * MIN },
      { name: 'gone', lastSeenMs: NOW - 25 * 60 * MIN },
    ]
    assert.deepEqual(a.silentItems(services, NOW).map((one) => one.title), ['silent'])
    const everyone = [{ name: 'a', lastSeenMs: NOW - 14 * MIN }, { name: 'b', lastSeenMs: NOW - 20 * MIN }]
    assert.deepEqual(a.silentItems(everyone, NOW), [])
    assert.equal(a.lastSpan(everyone), NOW - 14 * MIN)
    assert.deepEqual(a.status([], [ok('services')], a.lastSpan(everyone), NOW), { kind: 'nodata', sinceMs: NOW - 14 * MIN })
    assert.equal(a.lastSpan([]), null)
  })

  it('silence is judged at the time the data was fetched, not later', () => {
    const frozen = [{ name: 'a', lastSeenMs: NOW - MIN }, { name: 'b', lastSeenMs: NOW - 30 * MIN }]
    assert.deepEqual(a.silentItems(frozen, NOW).map((one) => one.title), ['b'])
    assert.equal(a.status([], [ok('services')], a.lastSpan(frozen), NOW).kind, 'calm')
    assert.equal(a.status([], [ok('services')], a.lastSpan(frozen), NOW + 12 * MIN).kind, 'nodata')
  })

  it('updated time is the oldest source and is unknown until every live source has data', () => {
    assert.equal(a.oldest([{ at: NOW - 5000, failed: null }, { at: NOW - 40_000, failed: null }]), NOW - 40_000)
    assert.equal(a.oldest([{ at: NOW, failed: null }, { at: 0, failed: null }]), null)
    assert.equal(a.oldest([{ at: NOW, failed: null }, { at: 0, failed: new Error('x') }]), NOW)
    assert.equal(a.oldest([]), null)
  })

  it('a 403 or an unconfigured metric store does not block calm, other errors do', async () => {
    const { ApiError } = await load<typeof import('../src/auth/client')>('auth/client.ts')
    assert.equal(a.stateOf(false, new ApiError(403, '')), 'hidden')
    assert.equal(a.stateOf(false, new ApiError(503, ''), [503]), 'unavailable')
    assert.equal(a.stateOf(false, new ApiError(503, '')), 'failed')
    assert.equal(a.stateOf(false, new ApiError(500, ''), [503]), 'failed')
    assert.equal(a.stateOf(false, new ApiError(401, '')), 'failed')
    assert.equal(a.stateOf(false, new Error('network')), 'failed')
    assert.equal(a.stateOf(false, null), 'pending')
    assert.equal(a.stateOf(true, null), 'ok')
    const sources = [ok('incidents'), { name: 'alerts', state: 'hidden' as const }, { name: 'pods', state: 'unavailable' as const }]
    assert.deepEqual(a.status([], sources, NOW - MIN, NOW), { kind: 'calm' })
    assert.deepEqual(a.unchecked(sources), [])
    assert.deepEqual(a.notes(sources), ['Not visible to you: alerts.', 'Not available on this server: pods.'])
  })

  it('a truncated issue list is never calm', () => {
    const sources = [ok('incidents'), { name: 'issues', state: 'partial' as const }]
    assert.deepEqual(a.status([], sources, NOW - MIN, NOW), { kind: 'partial', names: ['issues'] })
    assert.deepEqual(a.notes(sources), ['List truncated: issues.'])
    assert.equal(a.status([item({})], sources, NOW - MIN, NOW).kind, 'attention')
  })

  it('latency with no previous value gives no delta and no Infinity', () => {
    assert.equal(a.deltaOf(5, 0, 'latency').tone, 'none')
    assert.equal(a.deltaOf(5, 0, 'latency').text, '')
    assert.equal(a.deltaOf(0.4, 0, 'error').tone, 'worse')
    assert.doesNotMatch(a.deltaOf(0.4, 0, 'error').text, /Infinity|NaN/)
  })

  it('a node that is not ready with no unhealthy pod gets its own item', () => {
    const node = (name: string, ready: boolean | null, pods: number) => ({ name, ready, cpu: null, memory: null, memory_available: null, pods })
    const view = {
      clusters: [],
      namespaces: [],
      nodes: [node('empty', false, 0), node('busy', false, 4), node('fine', true, 2), node('unknown', null, 1)],
      workloads: [],
      pods: [],
      seen_ms: NOW,
    }
    const out = a.podItems(view)
    assert.deepEqual(out.map((one) => [one.title, one.severity]), [['Node empty is not ready', 'warning'], ['Node busy is not ready', 'critical']])
    assert.equal(out[0].to, '/infra/kubernetes/nodes/empty')
    const covered = { ...view, nodes: [node('busy', false, 4)], pods: [{ name: 'p', namespace: 'x', cluster: null, workload: null, node: 'busy', phase: 'Running', ready: false, restarts: 1, restarts_total: 1, cpu: null, memory: null, services: [], unhealthy: true, reason: 'restarting' }] as import('../src/data/infra').ClusterPod[] }
    assert.deepEqual(a.podItems(covered).map((one) => one.id), ['pods:x'])
  })

  it('escapes quotes and backslashes in the service name of the traces query', () => {
    const name = 'we"ird\\svc'
    const out = a.serviceItems([{ name, requests: 100, errors: 50, err: 50 }], '1 hour')
    const q = a.linkOf(out[0].evidence?.to ?? '').search?.q ?? ''
    const parsed = query.parse(q)
    assert.ok(parsed.ok)
    assert.equal(parsed.ok && parsed.items.length, 2)
    assert.ok(q.includes('we\\"ird\\\\svc'))
  })

  it('the overflow names the dominant kind', () => {
    const many = [...Array.from({ length: 8 }, (_, at) => item({ id: `s${at}`, severity: 'critical' })), item({ id: 'a', kind: 'alert' }), item({ id: 'b', kind: 'alert' })]
    assert.equal(a.listed(many).kind, 'alert')
    assert.equal(a.listed(many.slice(0, 8)).kind, null)
  })

  it('maps incidents, alerts and pods to items with evidence', () => {
    const incident = (severity: Incident['severity'], status: Incident['status'] = 'investigating'): Incident => ({
      id: severity,
      title: `inc ${severity}`,
      severity,
      status,
      owner: null,
      public: false,
      project: null,
      opened_ms: NOW - 5 * MIN,
      resolved_ms: null,
      alert: null,
      services: ['checkout'],
      paged_schedule: null,
    })
    const incidents = a.incidentItems([incident('sev1'), incident('sev2'), incident('sev3'), incident('sev4'), incident('sev1', 'resolved')])
    assert.deepEqual(incidents.map((one) => one.severity), ['critical', 'critical', 'warning', 'info'])
    assert.ok(incidents.every((one) => one.to.startsWith('/incidents/')))

    const rule = (status: 'firing' | 'no_data' | 'ok' | 'pending', severity: 'critical' | 'warning' | 'info') =>
      ({
        id: `${status}-${severity}`,
        name: `rule ${status}`,
        enabled: true,
        severity,
        signal: { kind: 'traces', service: 'checkout', operation: null, environment: null, measure: 'error_rate' },
        condition: { op: '>', threshold: 5 },
        window_s: 300,
        pending_s: 0,
        state: { status, value: 8, since_ms: NOW - 3 * MIN, evaluated_ms: NOW, series: [] },
        silenced_until_ms: null,
      }) as unknown as import('../src/data/alerts').Rule
    const alerts = a.alertItems([rule('firing', 'critical'), rule('no_data', 'critical'), rule('ok', 'critical'), rule('pending', 'warning')], NOW)
    assert.deepEqual(alerts.map((one) => one.severity), ['critical', 'warning'])
    assert.equal(alerts[0].to, '/alerts?rule=firing-critical')
    assert.equal(alerts[0].evidence?.to, '/services/checkout')

    const pod = (name: string, namespace: string, node: string, unhealthy = true) =>
      ({ name, namespace, cluster: null, workload: null, node, phase: 'Running', ready: false, restarts: 3, restarts_total: 3, cpu: null, memory: null, services: [], unhealthy, reason: 'restarting' }) as import('../src/data/infra').ClusterPod
    const view = {
      clusters: [],
      namespaces: [],
      nodes: [{ name: 'n1', ready: true, cpu: null, memory: null, memory_available: null, pods: 2 }, { name: 'n2', ready: false, cpu: null, memory: null, memory_available: null, pods: 1 }],
      workloads: [],
      pods: [pod('a', 'shop', 'n1'), pod('b', 'shop', 'n1'), pod('c', 'jobs', 'n2'), pod('d', 'jobs', 'n1', false)],
      seen_ms: NOW,
    }
    const pods = a.podItems(view)
    assert.equal(pods.length, 2)
    assert.equal(pods.find((one) => one.id === 'pods:shop')?.severity, 'warning')
    assert.equal(pods.find((one) => one.id === 'pods:jobs')?.severity, 'critical')
    assert.equal(pods.find((one) => one.id === 'pods:shop')?.magnitude, 2)
  })
})
