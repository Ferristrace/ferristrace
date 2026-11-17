import { useMutation, useQuery } from '@tanstack/react-query'
import { get, json, post } from '@/auth/client'
import { useOrganisations } from '@/auth/session'
import { nothingYet } from './orgs'

export type Plan = {
  slug: string
  name: string
  ingest_gb: number | null
  retention_days: number | null
  overage: boolean
}

export type Offer = { slug: string; name: string }

export type Status = 'active' | 'past_due' | 'canceled' | null

export type Billing = {
  plan: Plan
  payments: boolean
  upgrade: Offer | null
  portal: boolean
  owner: boolean
  status: Status
  period_end_ms: number | null
}

export type Checkout = { url: string }

const billingPath = (org: string) => `/api/orgs/${org}/billing`

const checkoutPath = (org: string) => `/api/orgs/${org}/billing/checkout`

const portalPath = (org: string) => `/api/orgs/${org}/billing/portal`

export const checkoutBody = (plan: string, url: string): { plan: string; success_url: string; cancel_url: string } => ({ plan, success_url: url, cancel_url: url })

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
    mutationFn: async (plan: string) => json<Checkout>(await post(checkoutPath(active?.org ?? ''), checkoutBody(plan, currentUrl()))),
  })
}

export function useOpenPortal() {
  const { active } = useOrganisations()
  return useMutation({
    mutationFn: async () => json<Checkout>(await post(portalPath(active?.org ?? ''), portalBody(currentUrl()))),
  })
}

export function planCopy(plan: Plan): string {
  const ingest = plan.ingest_gb === null ? 'No ingest limit' : `${plan.ingest_gb} GB ingest per month`
  const retention = plan.retention_days === null ? '' : `, ${plan.retention_days}-day retention`
  const beyond = plan.overage && plan.ingest_gb !== null ? ', pay-as-you-go beyond that' : ''
  return `${ingest}${retention}${beyond}.`
}

export const periodEndLabel = (ms: number): string => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function planSub(billing: Billing): string {
  const name = `${billing.plan.name} plan`
  if (billing.payments && billing.plan.overage && billing.period_end_ms !== null) return `${name} · renews ${periodEndLabel(billing.period_end_ms)}`
  return name
}
