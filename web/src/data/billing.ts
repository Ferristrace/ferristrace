import { useMutation, useQuery } from '@tanstack/react-query'
import { get, json, post } from '@/auth/client'
import { useOrganisations } from '@/auth/session'
import { nothingYet } from './orgs'

export type Plan = 'free' | 'pro'

export type Status = 'active' | 'past_due' | 'canceled' | null

export type Billing = { plan: Plan; status: Status; period_end_ms: number | null }

export type Checkout = { url: string }

const billingPath = (org: string) => `/api/orgs/${org}/billing`

const checkoutPath = (org: string) => `/api/orgs/${org}/billing/checkout`

const portalPath = (org: string) => `/api/orgs/${org}/billing/portal`

export const checkoutBody = (url: string): { success_url: string; cancel_url: string } => ({ success_url: url, cancel_url: url })

export const portalBody = (url: string): { return_url: string } => ({ return_url: url })

export const currentUrl = (): string => window.location.origin + window.location.pathname

const key = (org: string | undefined) => ['org', org, 'billing']

export function useBilling() {
  const found = useOrganisations()
  const { active } = found
  const { data, isPending, error } = useQuery({
    queryKey: key(active?.org),
    enabled: Boolean(active),
    staleTime: 60_000,
    queryFn: async () => json<Billing>(await get(billingPath(active?.org ?? ''))),
  })
  return { billing: data, nothing: nothingYet(found, isPending, error, 'billing') }
}

export function useStartCheckout() {
  const { active } = useOrganisations()
  return useMutation({
    mutationFn: async () => json<Checkout>(await post(checkoutPath(active?.org ?? ''), checkoutBody(currentUrl()))),
  })
}

export function useOpenPortal() {
  const { active } = useOrganisations()
  return useMutation({
    mutationFn: async () => json<Checkout>(await post(portalPath(active?.org ?? ''), portalBody(currentUrl()))),
  })
}

export const PLAN_COPY: Record<Plan, string> = {
  free: '30 GB ingest per month, 7-day retention.',
  pro: '100 GB ingest per month, 30-day retention, pay-as-you-go beyond that.',
}

export const periodEndLabel = (ms: number): string => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function planSub(billing: Billing): string {
  if (billing.plan === 'pro' && billing.period_end_ms !== null) return `Pro plan · renews ${periodEndLabel(billing.period_end_ms)}`
  return billing.plan === 'pro' ? 'Pro plan' : 'Free plan'
}
