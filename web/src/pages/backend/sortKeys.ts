import type { Operation } from '@/data/caches'
import type { Host } from '@/data/hosts'
import type { Run } from '@/data/jobs'
import type { Route } from '@/data/requests'
import type { Service, Edge, Operation as ServiceOperation } from '@/data/services'
import type { Fanout, Statement } from '@/data/statements'
import type { Release } from '@/data/releases'
import { errorRateOf } from '@/data/releases'
import type { Direction, Sortable, Sorting } from '@/lib/sorting'

export function sortingFrom<K extends string>(keys: readonly K[], fallback: K, firstOf: (key: K) => Direction, key: unknown, dir: unknown): Sorting<K> {
  const chosen = keys.find((one) => one === key) ?? fallback
  return { key: chosen, dir: dir === 'asc' || dir === 'desc' ? dir : firstOf(chosen) }
}

export function searchOf<K extends string>(sorting: Sorting<K>, fallback: K, firstOf: (key: K) => Direction): { s: string | undefined; sd: string | undefined } {
  return {
    s: sorting.key === fallback ? undefined : sorting.key,
    sd: sorting.dir === firstOf(sorting.key) ? undefined : sorting.dir,
  }
}

export const textFirst = (key: string): Direction => (key === 'name' ? 'asc' : 'desc')

export type ServiceKey = 'err' | 'rps' | 'p50' | 'p95' | 'p99' | 'seen' | 'name'

export const SERVICE_KEYS: readonly ServiceKey[] = ['err', 'rps', 'p50', 'p95', 'p99', 'seen', 'name']

export const serviceValue = (row: Service, key: ServiceKey): Sortable =>
  key === 'name' ? row.name : key === 'rps' ? row.perSecond : key === 'err' ? row.err : key === 'p50' ? row.p50Us : key === 'p95' ? row.p95Us : key === 'p99' ? row.p99Us : row.lastSeenMs

export type OperationKey = 'name' | 'rps' | 'err'

export const operationValue = (row: ServiceOperation, key: OperationKey): Sortable => (key === 'name' ? row.name : key === 'rps' ? row.perSecond : row.err)

export type EdgeKey = 'caller' | 'callee' | 'calls' | 'errors' | 'err'

export const edgeValue = (row: Edge, key: EdgeKey): Sortable => (key === 'caller' ? row.caller : key === 'callee' ? row.callee : key === 'calls' ? row.calls : key === 'errors' ? row.errors : row.err)

export const edgeFirst = (key: EdgeKey): Direction => (key === 'caller' || key === 'callee' ? 'asc' : 'desc')

export type ReleaseKey = 'release' | 'environments' | 'first' | 'last' | 'requests' | 'err' | 'issues'

export const releaseValue = (row: Release, key: ReleaseKey): Sortable =>
  key === 'release' ? `${row.service} ${row.version}` : key === 'environments' ? row.environments.join(', ') : key === 'first' ? row.firstSeenMs : key === 'last' ? row.lastSeenMs : key === 'requests' ? row.requests : key === 'err' ? errorRateOf(row.requests, row.errors) : row.newIssues

export const releaseFirst = (key: ReleaseKey): Direction => (key === 'release' || key === 'environments' ? 'asc' : 'desc')

export type RouteKey = 'broken' | 'refused' | 'traffic' | 'p95' | 'share' | 'name' | 'service' | 'method'

export const ROUTE_KEYS: readonly RouteKey[] = ['broken', 'refused', 'traffic', 'p95', 'share', 'name', 'service', 'method']

export const routeValue = (row: Route, key: RouteKey): Sortable =>
  key === 'name' ? row.route : key === 'service' ? row.service : key === 'method' ? row.method : key === 'traffic' ? row.perSecond : key === 'refused' ? row.refusedRate : key === 'broken' ? row.brokenRate : key === 'share' ? row.totalUs : row.p95Us

export const routeFirst = (key: RouteKey): Direction => (key === 'name' || key === 'service' || key === 'method' ? 'asc' : 'desc')

export type RunKey = 'rate' | 'processed' | 'failed' | 'share' | 'name' | 'queue' | 'system'

export const RUN_KEYS: readonly RunKey[] = ['rate', 'processed', 'failed', 'share', 'name', 'queue', 'system']

export const runValue = (row: Run, key: RunKey): Sortable =>
  key === 'name' ? row.group : key === 'queue' ? row.queue : key === 'system' ? row.system : key === 'processed' ? row.perSecond : key === 'failed' ? row.failed : key === 'share' ? row.share : row.failureRate

export const runFirst = (key: RunKey): Direction => (key === 'name' || key === 'queue' || key === 'system' ? 'asc' : 'desc')

export type CacheKey = 'rate' | 'calls' | 'hits' | 'misses' | 'name' | 'store'

export const CACHE_KEYS: readonly CacheKey[] = ['rate', 'calls', 'hits', 'misses', 'name', 'store']

export const cacheValue = (row: Operation, key: CacheKey): Sortable =>
  key === 'name' ? row.group : key === 'store' ? row.store : key === 'calls' ? row.perSecond : key === 'hits' ? row.hits : key === 'misses' ? row.misses : row.hitRate

export const cacheFirst = (key: CacheKey): Direction => (key === 'rate' || key === 'name' || key === 'store' ? 'asc' : 'desc')

export type StatementKey = 'time' | 'calls' | 'errors' | 'name' | 'database' | 'system'

export const STATEMENT_KEYS: readonly StatementKey[] = ['time', 'calls', 'errors', 'name', 'database', 'system']

export const statementValue = (row: Statement, key: StatementKey): Sortable =>
  key === 'name' ? row.group : key === 'database' ? row.database : key === 'system' ? row.system : key === 'calls' ? row.perSecond : key === 'errors' ? row.errorRate : row.totalUs

export const statementFirst = (key: StatementKey): Direction => (key === 'name' || key === 'database' || key === 'system' ? 'asc' : 'desc')

export type FanoutKey = 'statement' | 'worst' | 'traces' | 'calls'

export const fanoutValue = (row: Fanout, key: FanoutKey): Sortable => row[key]

export const fanoutFirst = (key: FanoutKey): Direction => (key === 'statement' ? 'asc' : 'desc')

export type HostKey = 'cpu' | 'memory' | 'disk' | 'load' | 'name'

export const HOST_KEYS: readonly HostKey[] = ['cpu', 'memory', 'disk', 'load', 'name']

export const hostValue = (row: Host, key: HostKey): Sortable => (key === 'name' ? row.name : row[key])
