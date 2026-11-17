import { useQueries, useQuery } from '@tanstack/react-query'
import { get, json } from '@/auth/client'
import { useOrganisations } from '@/auth/session'
import { useScope } from '@/lib/scope'
import { placed, type Placement } from '@/data/placement'
import { serving, stepped, type Stepped, type Steps } from '@/data/services'

const FRESH_MS = 15_000

export const MAX_SERIES = 25

function range(windowMs: number, project: string | undefined, environment: string, placement: Placement, shiftMs = 0): URLSearchParams {
  const to = Date.now() - shiftMs
  const params = new URLSearchParams({ from: String(to - windowMs), to: String(to) })
  if (project) params.set('project', project)
  if (environment.trim()) params.set('environment', environment.trim())
  return placed(params, placement)
}

export function useSeriesOfServices(names: readonly string[], environment: string, windowMs: number, placement: Placement, enabled: boolean): Map<string, Stepped> {
  const { active } = useOrganisations()
  const { project } = useScope()
  const capped = names.slice(0, MAX_SERIES)
  const found = useQueries({
    queries: capped.map((service) => ({
      queryKey: ['services', active?.org, project, 'series', service, environment.trim(), windowMs, placement, 0],
      enabled: enabled && Boolean(active),
      staleTime: FRESH_MS,
      queryFn: async () => {
        const params = range(windowMs, project, environment, placement)
        return stepped(await json<Steps>(await get(`/api/orgs/${active?.org}/services/${encodeURIComponent(service)}/series?${params.toString()}`)))
      },
    })),
  })
  const out = new Map<string, Stepped>()
  capped.forEach((service, at) => {
    const data = found[at]?.data
    if (data) out.set(service, data)
  })
  return out
}

export function useErrorRatesBefore(environment: string, windowMs: number, placement: Placement): Map<string, number | null> {
  const { active } = useOrganisations()
  const { project } = useScope()
  const { data } = useQuery({
    queryKey: ['services', active?.org, project, 'before', environment.trim(), windowMs, placement],
    enabled: Boolean(active),
    staleTime: FRESH_MS,
    queryFn: async () => {
      const params = range(windowMs, project, environment, placement, windowMs)
      const body = await json<{ services: Parameters<typeof serving>[0][] }>(await get(`/api/orgs/${active?.org}/services?${params.toString()}`))
      return body.services.map(serving)
    },
  })
  return new Map((data ?? []).map((service) => [service.name, service.err]))
}
