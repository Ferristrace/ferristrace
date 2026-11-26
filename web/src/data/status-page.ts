import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, del, get, json, patch, post } from '@/auth/client'
import { useOrganisations } from '@/auth/session'
import { nothingYet } from './orgs'

export type Accent = 'indigo' | 'teal' | 'orange' | 'rose' | 'slate'
export type Mode = 'light' | 'dark' | 'auto'
export type Theme = { accent: Accent; mode: Mode }
export type ComponentStatus = 'operational' | 'degraded' | 'down'

export type ComponentLink =
  | { kind: 'service'; service: string; project: string | null }
  | { kind: 'alert'; alert: string }
  | { kind: 'manual' }

export type StatusComponent = {
  id: string
  name: string
  link: ComponentLink
  manual_status: ComponentStatus | null
  position: number
  public: boolean
}

export type StatusPage = {
  id: string
  org_slug?: string
  name: string
  slug: string
  public: boolean
  hide_from_search: boolean
  theme: Theme
  intro: string | null
  subscribers: number
  created_ms: number
  updated_ms: number
}

export type StatusSheet = StatusPage & { components: StatusComponent[] }

export type PageDraft = { name: string; slug: string; public?: boolean; hide_from_search?: boolean; theme?: Theme; intro?: string | null }

export type PageChange = Partial<{ name: string; slug: string; public: boolean; hide_from_search: boolean; theme: Theme; intro: string | null }>

export type ComponentDraft = { name: string; link: ComponentLink; manual_status?: ComponentStatus | null; public?: boolean }

export type ComponentChange = Partial<{ name: string; link: ComponentLink; manual_status: ComponentStatus | null; public: boolean }>

export type PublicUpdate = { at_ms: number; kind: 'status' | 'comment'; text: string }

export type PublicIncident = {
  title: string
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved'
  severity: 'sev1' | 'sev2' | 'sev3' | 'sev4'
  opened_ms: number
  resolved_ms: number | null
  updates: PublicUpdate[]
  postmortem_url: string | null
}

export type ShownStatus = ComponentStatus | 'maintenance'

export type MaintenancePhase = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

export type PublicMaintenance = {
  id: string
  title: string
  details: string | null
  starts_ms: number
  ends_ms: number
  ended_ms: number | null
  phase: MaintenancePhase
  components: string[]
}

export type Maintenance = {
  id: string
  title: string
  details: string | null
  starts_ms: number
  ends_ms: number
  phase: MaintenancePhase
  closed_ms: number | null
  components: string[]
  created_ms: number
  updated_ms: number
}

export type MaintenanceTarget = { id: string; name: string; page_id: string; page_name: string }

export type MaintenanceList = { maintenances: Maintenance[]; components: MaintenanceTarget[] }

export type MaintenanceDraft = { title: string; details?: string | null; starts_ms: number; ends_ms: number; components: string[] }

export type MaintenanceChange = Partial<MaintenanceDraft>

export type PublicStatus = {
  page: {
    org_slug?: string
    slug?: string
    name: string
    theme: Theme
    intro: string | null
    hide_from_search: boolean
    updated_ms?: number
  }
  overall: ShownStatus
  components: { name: string; status: ShownStatus; days?: (ShownStatus | null)[] }[]
  incidents: PublicIncident[]
  maintenances?: PublicMaintenance[]
}

export type PublicPostmortem = { title: string; body: string; published_ms: number }

export const UPTIME_DAYS = 30
export const ACCENTS: Accent[] = ['indigo', 'teal', 'orange', 'rose', 'slate']
export const MODES: Mode[] = ['light', 'dark', 'auto']
export const COMPONENT_STATUSES: ComponentStatus[] = ['operational', 'degraded', 'down']
export const SLUG_PATTERN = /^[a-z0-9-]{3,48}$/
const RESERVED_SLUGS = ['confirm', 'unsubscribe', 'subscribe']

export const statusPagePath = (page: { org_slug?: string; slug: string }): string =>
  page.org_slug ? `/status/${page.org_slug}/${page.slug}` : `/status/${page.slug}`

export const resolveStatusDark = (mode: Mode | undefined, systemDark: boolean): boolean =>
  mode === 'dark' || (mode !== 'light' && systemDark)

export const slugProblem = (slug: string): string | null =>
  !SLUG_PATTERN.test(slug)
    ? 'Use 3 to 48 lowercase letters, digits or hyphens.'
    : RESERVED_SLUGS.includes(slug)
      ? 'This address is reserved.'
      : null

const FRESH_MS = 10_000
const PUBLIC_REFRESH_MS = 60_000

const key = (org: string | undefined) => ['org', org, 'status-pages']

const retryable = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2

export function useStatusPages() {
  const found = useOrganisations()
  const { active } = found
  const { data, isPending, error } = useQuery({
    queryKey: [...key(active?.org), 'list'],
    enabled: Boolean(active),
    staleTime: FRESH_MS,
    retry: retryable,
    queryFn: async () => (await json<{ status_pages: StatusPage[] }>(await get(`/api/orgs/${active?.org}/status-pages`))).status_pages,
  })
  return { pages: data, pending: isPending, failed: error, nothing: nothingYet(found, isPending, error, 'status pages') }
}

export function useStatusPage(id: string | null) {
  const { active } = useOrganisations()
  const { data, isPending, error } = useQuery({
    queryKey: [...key(active?.org), 'one', id],
    enabled: Boolean(active) && Boolean(id),
    staleTime: FRESH_MS,
    retry: retryable,
    queryFn: async () => json<StatusSheet>(await get(`/api/orgs/${active?.org}/status-pages/${id}`)),
  })
  return { sheet: data, pending: isPending, failed: error }
}

export function useStatusPreview(id: string | null) {
  const { active } = useOrganisations()
  const { data, error } = useQuery({
    queryKey: [...key(active?.org), 'preview', id],
    enabled: Boolean(active) && Boolean(id),
    staleTime: FRESH_MS,
    refetchInterval: PUBLIC_REFRESH_MS,
    retry: retryable,
    queryFn: async () => json<PublicStatus>(await get(`/api/orgs/${active?.org}/status-pages/${id}/preview`)),
  })
  return { preview: data, failed: error }
}

function useRefreshing<T, R>(send: (org: string, asked: T) => Promise<R>) {
  const { active } = useOrganisations()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (asked: T) => send(active?.org ?? '', asked),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key(active?.org) })
    },
  })
}

const at = (org: string, page: string) => `/api/orgs/${org}/status-pages/${page}`

export const useCreateStatusPage = () =>
  useRefreshing<PageDraft, StatusSheet>(async (org, asked) => json(await post(`/api/orgs/${org}/status-pages`, asked)))

export const useChangeStatusPage = () =>
  useRefreshing<{ page: string; change: PageChange }, StatusSheet>(async (org, asked) => json(await patch(at(org, asked.page), asked.change)))

export const useDeleteStatusPage = () =>
  useRefreshing<string, void>(async (org, page) => {
    await del(at(org, page))
  })

export const useAddComponent = () =>
  useRefreshing<{ page: string; component: ComponentDraft }, StatusComponent>(async (org, asked) =>
    json(await post(`${at(org, asked.page)}/components`, asked.component)),
  )

export const useChangeComponent = () =>
  useRefreshing<{ page: string; id: string; change: ComponentChange }, StatusComponent>(async (org, asked) =>
    json(await patch(`${at(org, asked.page)}/components/${asked.id}`, asked.change)),
  )

export const useRemoveComponent = () =>
  useRefreshing<{ page: string; id: string }, void>(async (org, asked) => {
    await del(`${at(org, asked.page)}/components/${asked.id}`)
  })

export const useOrderComponents = () =>
  useRefreshing<{ page: string; ids: string[] }, { components: StatusComponent[] }>(async (org, asked) =>
    json(await post(`${at(org, asked.page)}/components/order`, { ids: asked.ids })),
  )

async function publicly<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'omit' })
  if (!response.ok) throw new ApiError(response.status, (await response.text()).trim())
  return (await response.json()) as T
}

const apiStatusPath = (slug: string | undefined, org?: string) =>
  org ? `/api/status/${org}/${slug}` : `/api/status/${slug}`

export function usePublicStatus(slug: string | undefined, org?: string) {
  const { data, isPending, error } = useQuery({
    queryKey: ['public-status', org ?? null, slug],
    enabled: Boolean(slug),
    staleTime: FRESH_MS,
    refetchInterval: PUBLIC_REFRESH_MS,
    retry: retryable,
    queryFn: async () => publicly<PublicStatus>(apiStatusPath(slug, org)),
  })
  return { status: data, pending: isPending, failed: error }
}

export function usePublicPostmortem(slug: string | undefined, incident: string | undefined, org?: string) {
  const { data, isPending, error } = useQuery({
    queryKey: ['public-postmortem', org ?? null, slug, incident],
    enabled: Boolean(slug) && Boolean(incident),
    retry: retryable,
    queryFn: async () => publicly<PublicPostmortem>(`${apiStatusPath(slug, org)}/postmortems/${incident}`),
  })
  return { postmortem: data, pending: isPending, failed: error }
}

export function useSubscribe(slug: string | undefined, org?: string) {
  return useMutation({
    mutationFn: async (email: string) => {
      const response = await fetch(`${apiStatusPath(slug, org)}/subscribe`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!response.ok) throw new ApiError(response.status, (await response.text()).trim())
    },
  })
}

export const STATUS_WORDS: Record<ShownStatus, string> = {
  operational: 'Operational',
  maintenance: 'Under maintenance',
  degraded: 'Degraded',
  down: 'Down',
}

export const OVERALL_WORDS: Record<ShownStatus, string> = {
  operational: 'All systems operational',
  maintenance: 'Maintenance in progress',
  degraded: 'Some systems are degraded',
  down: 'Some systems are down',
}

export const PHASE_WORDS: Record<MaintenancePhase, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const DAY_SCORE: Record<ShownStatus, number> = { operational: 1, maintenance: 1, degraded: 0.5, down: 0 }

export const uptimeLabel = (days: (ShownStatus | null)[]): string => {
  const known = days.filter((day): day is ShownStatus => day !== null)
  if (known.length === 0) return '— uptime'
  const pct = (known.reduce((acc, status) => acc + DAY_SCORE[status], 0) / known.length) * 100
  return `${pct === 100 ? '100%' : `${pct.toFixed(2).replace(/\.?0+$/, '')}%`} uptime`
}

export type PublicAgenda = { running: PublicMaintenance[]; upcoming: PublicMaintenance[]; recent: PublicMaintenance[] }

export const publicAgenda = (maintenances: PublicMaintenance[] | undefined): PublicAgenda => {
  const all = maintenances ?? []
  return {
    running: all.filter((one) => one.phase === 'in_progress').sort((a, b) => a.ends_ms - b.ends_ms),
    upcoming: all.filter((one) => one.phase === 'scheduled').sort((a, b) => a.starts_ms - b.starts_ms),
    recent: all.filter((one) => one.phase === 'completed').sort((a, b) => (b.ended_ms ?? b.ends_ms) - (a.ended_ms ?? a.ends_ms)),
  }
}

export type Agenda = { running: Maintenance[]; upcoming: Maintenance[]; past: Maintenance[] }

export const agendaOf = (maintenances: Maintenance[] | undefined): Agenda => {
  const all = maintenances ?? []
  return {
    running: all.filter((one) => one.phase === 'in_progress').sort((a, b) => a.ends_ms - b.ends_ms),
    upcoming: all.filter((one) => one.phase === 'scheduled').sort((a, b) => a.starts_ms - b.starts_ms),
    past: all.filter((one) => one.phase === 'completed' || one.phase === 'cancelled').sort((a, b) => b.ends_ms - a.ends_ms),
  }
}

const two = (n: number) => String(n).padStart(2, '0')

export const toLocalInput = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`
}

export const fromLocalInput = (value: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

export const MAX_MAINTENANCE_MS = 7 * 86_400_000

export const windowProblem = (starts: number | null, ends: number | null, nowMs: number): string | null =>
  starts === null || ends === null
    ? 'Choose a start and an end.'
    : ends <= starts
      ? 'The end must be after the start.'
      : ends - starts > MAX_MAINTENANCE_MS
        ? 'A maintenance lasts at most 7 days.'
        : ends <= nowMs
          ? 'The end must be in the future.'
          : null

export const groupByPage = (components: MaintenanceTarget[]): { page_id: string; page_name: string; components: MaintenanceTarget[] }[] => {
  const groups: { page_id: string; page_name: string; components: MaintenanceTarget[] }[] = []
  for (const component of components) {
    const group = groups.find((one) => one.page_id === component.page_id)
    if (group) group.components.push(component)
    else groups.push({ page_id: component.page_id, page_name: component.page_name, components: [component] })
  }
  return groups
}

const maintenanceKey = (org: string | undefined) => ['org', org, 'status-maintenances']

export function useMaintenances() {
  const { active } = useOrganisations()
  const { data, isPending, error } = useQuery({
    queryKey: maintenanceKey(active?.org),
    enabled: Boolean(active),
    staleTime: FRESH_MS,
    retry: retryable,
    queryFn: async () => json<MaintenanceList>(await get(`/api/orgs/${active?.org}/status-maintenances`)),
  })
  return { list: data, pending: isPending, failed: error }
}

function useMaintaining<T>(send: (org: string, asked: T) => Promise<Maintenance>) {
  const { active } = useOrganisations()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (asked: T) => send(active?.org ?? '', asked),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: maintenanceKey(active?.org) })
      void client.invalidateQueries({ queryKey: key(active?.org) })
    },
  })
}

const maintenanceAt = (org: string, id?: string) => `/api/orgs/${org}/status-maintenances${id ? `/${id}` : ''}`

export const useScheduleMaintenance = () =>
  useMaintaining<MaintenanceDraft>(async (org, asked) => json(await post(maintenanceAt(org), asked)))

export const useChangeMaintenance = () =>
  useMaintaining<{ id: string; change: MaintenanceChange }>(async (org, asked) => json(await patch(maintenanceAt(org, asked.id), asked.change)))

export const useEndMaintenance = () =>
  useMaintaining<string>(async (org, id) => json(await post(`${maintenanceAt(org, id)}/end`, {})))

export const useCancelMaintenance = () =>
  useMaintaining<string>(async (org, id) => json(await post(`${maintenanceAt(org, id)}/cancel`, {})))
