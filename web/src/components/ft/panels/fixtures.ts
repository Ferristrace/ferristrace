import type { Cell, DashboardDoc, PanelDoc, PanelKind, PanelResult, QueryDoc } from '@/data/dashboards'

const SERVICES = ['checkout', 'payments', 'catalog', 'search']

const POINTS = 48

const wave = (service: number, at: number): number => 40 + service * 18 + 22 * Math.sin((at + service * 5) / 5) + 6 * Math.cos(at * 1.7 + service)

export function emptyResult(kind: PanelKind): PanelResult {
  switch (kind) {
    case 'time_series':
    case 'area':
    case 'bar':
      return { kind: 'series', series: [] }
    case 'number':
      return { kind: 'scalar', value: null }
    case 'pie':
    case 'table':
    case 'list':
      return { kind: 'rows', columns: [], rows: [], truncated: false }
    case 'histogram':
      return { kind: 'buckets', buckets: [] }
    case 'heatmap':
      return { kind: 'heat', x: [], y: [], cells: [] }
    case 'scatter':
      return { kind: 'pairs', points: [] }
    case 'text':
      return { kind: 'rows', columns: [], rows: [], truncated: false }
  }
}

export function fixtureResult(kind: PanelKind, fromNs: number, toNs: number, empty = false): PanelResult {
  if (empty) return emptyResult(kind)
  const step = Math.max(1, Math.floor((toNs - fromNs) / POINTS))
  switch (kind) {
    case 'time_series':
    case 'area':
    case 'bar':
      return {
        kind: 'series',
        series: SERVICES.slice(0, kind === 'bar' ? 3 : 4).map((service, index) => ({
          labels: { service },
          points: Array.from({ length: kind === 'bar' ? 24 : POINTS }, (_, at) => [fromNs + at * (kind === 'bar' ? step * 2 : step), Math.round(wave(index, at) * 10) / 10] as [number, number | null]),
        })),
      }
    case 'number':
      return { kind: 'scalar', value: 1284.6 }
    case 'pie':
      return { kind: 'rows', columns: ['service', 'spans'], rows: SERVICES.map((service, index) => [service, 900 - index * 210]), truncated: false }
    case 'table':
      return {
        kind: 'rows',
        columns: ['service', 'errors', 'p95 (ms)'],
        rows: SERVICES.map((service, index): Cell[] => [service, 120 - index * 31, 180 + index * 77.5]),
        truncated: false,
      }
    case 'list':
      return {
        kind: 'rows',
        columns: ['timestamp', 'severity', 'service', 'body', 'trace_id'],
        rows: Array.from({ length: 6 }, (_, at): Cell[] => [
          toNs - at * step * 3,
          at % 3 === 0 ? 'error' : 'warn',
          SERVICES[at % SERVICES.length],
          at % 3 === 0 ? 'upstream request failed: connection reset' : 'retrying after a slow response',
          `4bf92f3577b34da6a3ce929d0e0e47${String(10 + at)}`,
        ]),
        truncated: false,
      }
    case 'histogram':
      return {
        kind: 'buckets',
        buckets: Array.from({ length: 16 }, (_, at) => ({ from: at * 25, to: (at + 1) * 25, count: Math.round(400 * Math.exp(-((at - 4) ** 2) / 10) + 12 * (at % 3)) })),
      }
    case 'heatmap':
      return {
        kind: 'heat',
        x: Array.from({ length: 24 }, (_, at) => fromNs + at * Math.floor((toNs - fromNs) / 24)),
        y: Array.from({ length: 8 }, (_, at) => ({ from: at * 50, to: (at + 1) * 50 })),
        cells: Array.from({ length: 24 }, (_, xi) => Array.from({ length: 8 }, (_, yi): [number, number, number] => [xi, yi, Math.max(0, Math.round(90 * Math.exp(-((yi - 2 - (xi % 6) / 3) ** 2) / 2) - 4))])).flat(),
      }
    case 'scatter':
      return {
        kind: 'pairs',
        points: Array.from({ length: 30 }, (_, at) => ({
          group: { service: SERVICES[at % 3] },
          x: 20 + at * 11 + (at % 5) * 7,
          y: 80 + ((at * 37) % 220) + (at % 3) * 40,
        })),
      }
    case 'text':
      return emptyResult('text')
  }
}

const query = (name: string, signal: QueryDoc['signal'], overrides: Partial<QueryDoc> = {}): QueryDoc => ({
  name,
  signal,
  aggregations: [{ function: 'count' }],
  filter: null,
  group_by: [],
  order: null,
  limit: null,
  step: 'auto',
  ...overrides,
})

const byService = { group_by: [{ field: 'service' as const }] }

const withFilter = { filter: { all: [{ field: 'service' as const, op: 'eq' as const, value: { var: 'service' } }, { field: 'status' as const, op: 'eq' as const, value: 'error' }] } }

const panel = (id: string, kind: PanelKind, title: string, description: string, queries: QueryDoc[], options: PanelDoc['options'] = {}): PanelDoc => ({ id, kind, title, description, queries, options })

export const FIXTURE_DOC: DashboardDoc = {
  schema_version: 1,
  duration: 3600,
  variables: [
    { name: 'service', label: 'Service', source: { kind: 'attribute', signal: 'traces', key: 'service' }, multi: true, all: true },
    { name: 'env', label: 'Environment', source: { kind: 'static', values: ['production', 'staging'] }, multi: false, all: false },
  ],
  panels: [
    panel('requests', 'time_series', 'Requests per service', 'Spans per minute, one line per service.', [query('requests', 'traces', byService)], { unit: 'req', legend: 'bottom' }),
    panel('errors', 'number', 'Errors', 'Error spans in the range.', [query('errors', 'traces', { step: 'total', ...withFilter })], { unit: '', decimals: 0 }),
    panel('latency', 'area', 'Latency p95', 'Stacked p95 duration by service.', [query('latency', 'traces', { ...byService, aggregations: [{ function: 'p95', field: { field: 'duration' } }] })], { unit: 'ms', stacked: true, legend: 'right' }),
    panel('logs-bar', 'bar', 'Error logs', 'Error logs per interval.', [query('logs', 'logs', { filter: { field: 'severity', op: 'eq', value: 'error' }, ...byService })], { stacked: true }),
    panel('share', 'pie', 'Spans by service', 'Share of spans.', [query('share', 'traces', { ...byService, step: 'total' })], { legend: 'right' }),
    panel('scatter', 'scatter', 'Spans vs latency', 'One dot per route.', [query('scatter', 'traces', { ...byService, step: 'total', aggregations: [{ function: 'count' }, { function: 'p95', field: { field: 'duration' } }] })], { unit: 'ms' }),
    panel('dist', 'histogram', 'Duration distribution', 'Spans per duration bucket.', [query('dist', 'traces', { step: 'total', aggregations: [{ function: 'avg', field: { field: 'duration' } }] })], { unit: 'ms' }),
    panel('heat', 'heatmap', 'Duration over time', 'Spans per duration bucket and minute.', [query('heat', 'traces', { aggregations: [{ function: 'avg', field: { field: 'duration' } }] })], { unit: 'ms' }),
    panel('top', 'table', 'Slowest services', 'Errors and p95 by service.', [query('top', 'traces', { ...byService, step: 'total', aggregations: [{ function: 'count' }, { function: 'p95', field: { field: 'duration' } }] })]),
    panel('recent', 'list', 'Recent errors', 'Newest error logs.', [query('recent', 'logs', { step: 'total', filter: { field: 'severity', op: 'eq', value: 'error' } })]),
    panel('notes', 'text', 'Runbook', '', [], { content: '## Checkout\n\nPage **on-call** when errors stay above 50 for ten minutes.\n\n- Check the [releases](/releases)\n- Open the `checkout` traces' }),
  ],
  layout: [
    { panel: 'requests', x: 0, y: 0, w: 8, h: 5 },
    { panel: 'errors', x: 8, y: 0, w: 4, h: 5 },
    { panel: 'latency', x: 0, y: 5, w: 6, h: 5 },
    { panel: 'logs-bar', x: 6, y: 5, w: 6, h: 5 },
    { panel: 'share', x: 0, y: 10, w: 4, h: 5 },
    { panel: 'scatter', x: 4, y: 10, w: 4, h: 5 },
    { panel: 'dist', x: 8, y: 10, w: 4, h: 5 },
    { panel: 'heat', x: 0, y: 15, w: 6, h: 5 },
    { panel: 'top', x: 6, y: 15, w: 6, h: 5 },
    { panel: 'recent', x: 0, y: 20, w: 8, h: 5 },
    { panel: 'notes', x: 8, y: 20, w: 4, h: 5 },
  ],
}
