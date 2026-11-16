import { useQueries } from '@tanstack/react-query'
import { ApiError, get, json } from '@/auth/client'
import { useOrganisations } from '@/auth/session'
import type { OnCallNow } from './oncall'

export function useOnCallNowOf(schedules: readonly string[]): Record<string, OnCallNow | undefined> {
  const { active } = useOrganisations()
  const found = useQueries({
    queries: schedules.map((schedule) => ({
      queryKey: ['org', active?.org, 'schedules', schedule, 'now'],
      enabled: Boolean(active),
      staleTime: 15_000,
      refetchInterval: 60_000,
      retry: (count: number, error: unknown) => !(error instanceof ApiError) && count < 2,
      queryFn: async () => json<OnCallNow>(await get(`/api/orgs/${active?.org}/schedules/${schedule}/now`)),
    })),
  })
  return Object.fromEntries(schedules.map((schedule, at) => [schedule, found[at]?.data]))
}
