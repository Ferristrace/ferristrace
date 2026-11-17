import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { because } from '@/auth/client'
import { planCopy, planSub, useBilling, useOpenPortal, useStartCheckout, type Billing as BillingInfo } from '@/data/billing'
import { H, Row } from './parts'

function Action({ billing, upgrading, managing, onUpgrade, onManage }: {
  billing: BillingInfo
  upgrading: boolean
  managing: boolean
  onUpgrade: (plan: string) => void
  onManage: () => void
}) {
  if (!billing.payments) return null
  if (!billing.owner) return <span className="text-control text-muted-foreground">Only an owner manages billing.</span>
  if (billing.upgrade) {
    const offer = billing.upgrade
    return <Button size="sm" loading={upgrading} onClick={() => onUpgrade(offer.slug)}>Upgrade to {offer.name}</Button>
  }
  if (billing.portal) return <Button size="sm" loading={managing} onClick={onManage}>Manage billing</Button>
  return null
}

export function BillingPage({ billing, nothing, upgrading, managing, onUpgrade, onManage }: {
  billing: BillingInfo | undefined
  nothing: string
  upgrading: boolean
  managing: boolean
  onUpgrade: (plan: string) => void
  onManage: () => void
}) {
  return (
    <>
      <H title="Billing" sub={billing ? planSub(billing) : undefined} />
      {billing ? (
        <Card className="overflow-hidden">
          <Row title="Included" sub={planCopy(billing.plan)}>
            <Action billing={billing} upgrading={upgrading} managing={managing} onUpgrade={onUpgrade} onManage={onManage} />
          </Row>
        </Card>
      ) : (
        <Card className="px-4 py-3 text-control text-muted-foreground">{nothing}</Card>
      )}
    </>
  )
}

export function Billing() {
  const { billing, nothing } = useBilling()
  const checkout = useStartCheckout()
  const portal = useOpenPortal()

  const onUpgrade = (plan: string) => checkout.mutate(plan, {
    onSuccess: (data) => { window.location.href = data.url },
    onError: (error) => toast.error(because(error, 'Could not start checkout')),
  })

  const onManage = () => portal.mutate(undefined, {
    onSuccess: (data) => { window.location.href = data.url },
    onError: (error) => toast.error(because(error, 'Could not open billing portal')),
  })

  return (
    <BillingPage
      billing={billing}
      nothing={nothing}
      upgrading={checkout.isPending}
      managing={portal.isPending}
      onUpgrade={onUpgrade}
      onManage={onManage}
    />
  )
}
