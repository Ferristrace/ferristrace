export type KubeTab = 'nodes' | 'workloads' | 'pods'

export const KUBE_TABS: KubeTab[] = ['nodes', 'workloads', 'pods']

export const tabOf = (value: string | undefined): KubeTab | null => (KUBE_TABS.find((tab) => tab === value) ?? null)

type NodeLike = { name: string; ready: boolean | null; cpu: number | null; memory: number | null; memory_available: number | null; pods: number }
type WorkloadLike = { cluster: string | null; kind: string; name: string; namespace: string; desired: number | null; ready: number | null; pods: number }

export type NodeKey = 'name' | 'status' | 'pods' | 'cpu' | 'memory'
export type WorkloadKey = 'name' | 'kind' | 'namespace' | 'ready' | 'pods'

const has = (needle: string, parts: (string | null | undefined)[]) => parts.some((part) => part?.toLowerCase().includes(needle))

export function filterNodes<T extends NodeLike>(nodes: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  return needle ? nodes.filter((node) => has(needle, [node.name])) : [...nodes]
}

export function filterWorkloads<T extends WorkloadLike>(workloads: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  return needle ? workloads.filter((workload) => has(needle, [workload.name, workload.namespace, workload.kind])) : [...workloads]
}

export function memoryShare(node: NodeLike): number | null {
  if (node.memory === null || node.memory_available === null) return null
  const total = node.memory + node.memory_available
  return total > 0 ? node.memory / total : null
}

const STATUS_RANK = { down: 0, unknown: 1, ready: 2 }

export function nodeValue(node: NodeLike, key: NodeKey): string | number | null {
  if (key === 'name') return node.name
  if (key === 'status') return node.ready === false ? STATUS_RANK.down : node.ready === null ? STATUS_RANK.unknown : STATUS_RANK.ready
  if (key === 'pods') return node.pods
  if (key === 'cpu') return node.cpu
  return memoryShare(node)
}

export function workloadValue(workload: WorkloadLike, key: WorkloadKey): string | number | null {
  if (key === 'name') return workload.name
  if (key === 'kind') return workload.kind
  if (key === 'namespace') return workload.namespace
  if (key === 'pods') return workload.pods
  if (workload.desired === null || workload.ready === null) return null
  return workload.desired === 0 ? 1 : workload.ready / workload.desired
}
