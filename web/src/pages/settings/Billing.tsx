import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { because } from '@/auth/client'
import { PLAN_COPY, planSub, useBilling, useOpenPortal, useStartCheckout, type Billing as BillingInfo } from '@/data/billing'
import { H, Row } from './parts'

export function BillingPage({ billing, nothing, upgrading, managing, onUpgrade, onManage }: {
  billing: BillingInfo | undefined
  nothing: string
  upgrading: boolean
  managing: boolean
  onUpgrade: () => void
  onManage: () => void
}) {
  return (
    <>
      <H title="Billing" sub={billing ? planSub(billing) : undefined} />
      {billing ? (
        <Card className="overflow-hidden">
          <Row title="Included" sub={PLAN_COPY[billing.plan]}>
            {billing.plan === 'free' ? (
              <Button size="sm" loading={upgrading} onClick={onUpgrade}>Upgrade to Pro</Button>
            ) : (
              <Button size="sm" loading={managing} onClick={onManage}>Manage billing</Button>
            )}
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

  const onUpgrade = () => checkout.mutate(undefined, {
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
