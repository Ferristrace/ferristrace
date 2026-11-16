import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, json, post, put } from '@/auth/client'
import { useScope } from '@/lib/scope'
import { fixtureResult } from '@/components/ft/panels/fixtures'

export type QuerySignal = 'traces' | 'logs' | 'metrics'

export type PanelKind = 'time_series' | 'area' | 'bar' | 'pie' | 'scatter' | 'histogram' | 'heatmap' | 'number' | 'table' | 'list' | 'text'

export const PANEL_KINDS: PanelKind[] = ['time_series', 'area', 'bar', 'pie', 'scatter', 'histogram', 'heatmap', 'number', 'table', 'list', 'text']

export type BuiltIn = 'service' | 'name' | 'status' | 'kind' | 'duration' | 'http_status_code' | 'trace_id' | 'span_id' | 'severity' | 'body'

export type Column = { field: BuiltIn } | { attr: string }

export type EventFunction = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max' | 'p50' | 'p90' | 'p95' | 'p99' | 'rate'

export type Aggregation =
  | { function: EventFunction; field?: Column | null }
  | { metric: string; time: 'avg' | 'sum' | 'min' | 'max' | 'rate' | 'increase'; space: 'sum' | 'avg' | 'min' | 'max' | 'count' }

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'not_contains' | 'in' | 'not_in' | 'exists' | 'not_exists'

export type FilterScalar = string | number | boolean | { var: string }

export type Condition = { field?: BuiltIn; attr?: string; op: FilterOp; value?: FilterScalar | FilterScalar[] }

export type FilterDoc = { all: FilterDoc[] } | { any: FilterDoc[] } | { not: FilterDoc } | Condition

export type Step = 'auto' | 'total' | { fixed: number }

export type OrderDoc = { by: 'group' | { aggregation: number }; direction: 'asc' | 'desc' }

export type QueryDoc = {
  name: string
  signal: QuerySignal
  aggregations: Aggregation[]
  filter?: FilterDoc | null
  group_by?: Column[]
  order?: OrderDoc | null
  limit?: number | null
  step: Step
}

export type Legend = 'bottom' | 'right' | 'hidden'

export type OptionsDoc = { unit?: string | null; decimals?: number | null; legend?: Legend; stacked?: boolean; content?: string | null }

export type PanelDoc = { id: string; title: string; description: string; kind: PanelKind; queries: QueryDoc[]; options: OptionsDoc }

export type VariableSource = { kind: 'attribute'; signal: QuerySignal; key: string } | { kind: 'static'; values: string[] }

export type VariableDoc = { name: string; label: string; source: VariableSource; multi: boolean; all: boolean }

export type LayoutItem = { panel: string; x: number; y: number; w: number; h: number }

export type DashboardDoc = { schema_version: 1; variables: VariableDoc[]; panels: PanelDoc[]; layout: LayoutItem[]; duration: number }

export type Dashboard = {
  id: string
  project: string
  name: string
  tags: string[]
  doc: DashboardDoc
  updated_by: string | null
  created_at_ms: number
  updated_at_ms: number
}

export type DashboardSummary = { id: string; name: string; tags: string[]; updated_by: string | null; updated_at_ms: number }

export type DashboardFile = { name: string; tags: string[]; doc: DashboardDoc }

export type Cell = string | number | boolean | null

export type Labels = Record<string, string>

export type SeriesData = { labels: Labels; points: [number, number | null][] }

export type Bucket = { from: number; to: number; count: number }

export type HeatRange = { from: number; to: number }

export type Pair = { group: Labels; x: number; y: number }

export type PanelResult =
  | { kind: 'series'; series: SeriesData[] }
  | { kind: 'scalar'; value: number | null }
  | { kind: 'rows'; columns: string[]; rows: Cell[][]; truncated: boolean }
  | { kind: 'buckets'; buckets: Bucket[] }
  | { kind: 'heat'; x: number[]; y: HeatRange[]; cells: [number, number, number][] }
  | { kind: 'pairs'; points: Pair[] }

export const FIXTURE_ID = 'fixture'

const FRESH_MS = 30_000

const base = '/api/v1/dashboards'

export function useDashboards() {
  const { project } = useScope()
  const found = useQuery({
    queryKey: ['dashboards', project],
    enabled: Boolean(project),
    staleTime: FRESH_MS,
    queryFn: async () => (await json<{ dashboards: DashboardSummary[] }>(await get(`${base}?project=${encodeURIComponent(project ?? '')}`))).dashboards,
  })
  return { dashboards: found.data ?? [], project, pending: found.isPending && Boolean(project), failed: found.error }
}

export function useDashboard(id: string | undefined) {
  const found = useQuery({
    queryKey: ['dashboard', id],
    enabled: Boolean(id),
    staleTime: FRESH_MS,
    queryFn: async () => json<Dashboard>(await get(`${base}/${encodeURIComponent(id ?? '')}`)),
  })
  return { dashboard: found.data ?? null, pending: found.isPending && Boolean(id), fetching: found.isFetching, failed: found.error }
}

function useChanged() {
  const client = useQueryClient()
  return (id?: string) => {
    void client.invalidateQueries({ queryKey: ['dashboards'] })
    if (id) void client.invalidateQueries({ queryKey: ['dashboard', id] })
  }
}

export function useCreateDashboard() {
  const { project } = useScope()
  const changed = useChanged()
  return useMutation({
    mutationFn: async (file: DashboardFile) => json<Dashboard>(await post(base, { project, ...file })),
    onSuccess: () => changed(),
  })
}

export function useReplaceDashboard() {
  const client = useQueryClient()
  const changed = useChanged()
  return useMutation({
    mutationFn: async ({ id, ...file }: DashboardFile & { id: string }) => json<Dashboard>(await put(`${base}/${encodeURIComponent(id)}`, file)),
    onSuccess: (saved) => {
      client.setQueryData(['dashboard', saved.id], saved)
      void client.invalidateQueries({ queryKey: ['dashboards'] })
      changed()
    },
  })
}

export function useDeleteDashboard() {
  const changed = useChanged()
  return useMutation({
    mutationFn: async (id: string) => {
      await del(`${base}/${encodeURIComponent(id)}`)
      return id
    },
    onSuccess: (id) => changed(id),
  })
}

export function useCloneDashboard() {
  const changed = useChanged()
  return useMutation({
    mutationFn: async (id: string) => json<Dashboard>(await post(`${base}/${encodeURIComponent(id)}/clone`)),
    onSuccess: () => changed(),
  })
}

export function useExportDashboard() {
  return useMutation({
    mutationFn: async (id: string) => json<DashboardFile>(await get(`${base}/${encodeURIComponent(id)}/export`)),
  })
}

export function useImportDashboard() {
  const { project } = useScope()
  const changed = useChanged()
  return useMutation({
    mutationFn: async (file: DashboardFile) => json<Dashboard>(await post(`${base}/import?project=${encodeURIComponent(project ?? '')}`, file)),
    onSuccess: () => changed(),
  })
}

export type PanelRequest = {
  kind: PanelKind
  query: QueryDoc
  fromNs: number
  toNs: number
  variables: Record<string, string[]>
}

export type Source = 'server' | 'fixture' | 'fixture-empty'

export function panelQueryOptions(project: string | undefined, request: PanelRequest | null, source: Source = 'server') {
  return {
    queryKey: ['panel-query', source, project, request?.kind, request?.query, request?.fromNs, request?.toNs, request?.variables] as const,
    enabled: request !== null && (source !== 'server' || Boolean(project)),
    staleTime: FRESH_MS,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<PanelResult> => {
      if (request === null) throw new Error('no request')
      if (source !== 'server') return fixtureResult(request.kind, request.fromNs, request.toNs, source === 'fixture-empty')
      return json<PanelResult>(
        await post(`${base}/query`, {
          project,
          kind: request.kind,
          query: request.query,
          from_ns: request.fromNs,
          to_ns: request.toNs,
          variables: request.variables,
        }),
      )
    },
  }
}

export function usePanelQuery(request: PanelRequest | null, source: Source = 'server') {
  const { project } = useScope()
  const found = useQuery(panelQueryOptions(project, request, source))
  return { result: found.data ?? null, pending: found.isPending && found.fetchStatus !== 'idle', failed: found.error, refetch: found.refetch }
}
