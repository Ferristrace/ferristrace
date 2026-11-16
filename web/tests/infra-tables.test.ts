import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sorted } from '../src/lib/sorting.ts'
import { filterNodes, filterWorkloads, memoryShare, nodeValue, tabOf, workloadValue, type NodeKey, type WorkloadKey } from '../src/pages/kubeTables.ts'
import { dutiesOf, dutyText } from '../src/pages/settings/duties.ts'

const node = (name: string, ready: boolean | null, pods: number, memory: number | null = null, available: number | null = null) => ({ name, ready, pods, cpu: null, memory, memory_available: available })
const nodes = [node('node-b', true, 9, 6, 4), node('node-a', false, 3), node('node-c', true, 12, 1, 9)]

const workload = (name: string, namespace: string, desired: number | null, ready: number | null) => ({ cluster: null, kind: 'Deployment', name, namespace, desired, ready, pods: ready ?? 0 })
const workloads = [workload('api', 'prod', 3, 3), workload('web', 'prod', 4, 1), workload('jobs', 'ops', null, null), workload('idle', 'ops', 0, 0)]

test('@spec-l19-10 the kubernetes tab param keeps only the known tabs', () => {
  assert.equal(tabOf('nodes'), 'nodes')
  assert.equal(tabOf('pods'), 'pods')
  assert.equal(tabOf(undefined), null)
  assert.equal(tabOf('overview'), null)
})

test('@spec-l19-10 the nodes tab filters by name and sorts by status, pods and memory share', () => {
  assert.deepEqual(filterNodes(nodes, ' NODE-a ').map((n) => n.name), ['node-a'])
  assert.equal(filterNodes(nodes, '').length, 3)
  const by = (key: NodeKey, dir: 'asc' | 'desc') => sorted(nodes, { key, dir }, nodeValue).map((n) => n.name)
  assert.deepEqual(by('status', 'asc'), ['node-a', 'node-b', 'node-c'])
  assert.deepEqual(by('pods', 'desc'), ['node-c', 'node-b', 'node-a'])
  assert.deepEqual(by('memory', 'desc'), ['node-b', 'node-c', 'node-a'])
  assert.equal(memoryShare(node('x', true, 0, 0, 0)), null)
  assert.equal(memoryShare(nodes[0]), 0.6)
})

test('@spec-l19-10 the workloads tab filters by name, namespace or kind and sorts by readiness', () => {
  assert.deepEqual(filterWorkloads(workloads, 'ops').map((w) => w.name), ['jobs', 'idle'])
  assert.deepEqual(filterWorkloads(workloads, 'deploy').length, 4)
  const by = (key: WorkloadKey, dir: 'asc' | 'desc') => sorted(workloads, { key, dir }, workloadValue).map((w) => w.name)
  assert.deepEqual(by('ready', 'asc'), ['web', 'api', 'idle', 'jobs'])
  assert.deepEqual(by('namespace', 'asc'), ['jobs', 'idle', 'api', 'web'])
})

test('@spec-l19-11 a team on call now lists who holds each of its schedules, and nobody is left out', () => {
  const schedules = [{ id: 's1', team: 't1', name: 'Primary' }, { id: 's2', team: 't1', name: 'Backup' }, { id: 's3', team: 't2', name: 'Primary' }]
  const now = {
    s1: { account: { id: 'a1', email: 'ada@example.com', name: 'Ada' } },
    s2: { account: null },
    s3: { account: { id: 'a2', email: 'bob@example.com', name: null } },
  }
  assert.deepEqual(dutiesOf('t1', schedules, now), [{ schedule: 'Primary', who: 'Ada' }])
  assert.deepEqual(dutiesOf('t2', schedules, now), [{ schedule: 'Primary', who: 'bob@example.com' }])
  assert.deepEqual(dutiesOf('t3', schedules, now), [])
  assert.deepEqual(dutiesOf('t1', schedules, {}), [])
  assert.equal(dutyText(dutiesOf('t1', schedules, now)), 'Ada Primary')
})
