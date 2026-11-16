import { toast } from 'sonner'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, PageHeader } from '@/components/ft/bits'
import { because } from '@/auth/client'
import { useMarkAllRead, useMarkRead, useNotifications, type Notification, type NotificationKind } from '@/data/notifications'
import { Link } from '@/lib/router'
import { stamp } from '@/lib/format'
import { cn } from '@/lib/utils'

const KIND_LABEL: Record<NotificationKind, string> = {
  issue: 'Exception',
  service_silent: 'Service silent',
  status_page: 'Status page',
  api_key_expiring: 'Api key',
  usage: 'Usage',
  membership: 'Members',
}

function Row({ item }: { item: Notification }) {
  const mark = useMarkRead()
  const unread = item.read_ms === null
  const body = (
    <div className={cn('flex flex-1 flex-col gap-0.5', unread && 'font-semibold')}>
      <span className="flex items-center gap-2 text-control">
        <span className="rounded-sm border px-1.5 font-mono text-[10.5px] font-normal text-muted-foreground">{KIND_LABEL[item.kind]}</span>
        {item.title}
      </span>
      <span className="text-caption font-normal text-muted-foreground">{item.body}</span>
    </div>
  )
  return (
    <div className="flex items-start gap-3 border-b border-border-subtle px-4 py-3 last:border-b-0">
      <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', unread ? 'bg-accent-text' : 'bg-line-strong')} />
      {item.link ? <Link to={item.link} className="flex-1 text-foreground no-underline hover:underline">{body}</Link> : <span className="flex-1">{body}</span>}
      <span className="shrink-0 pt-0.5 font-mono text-caption text-muted-foreground">{stamp(item.created_ms)}</span>
      {unread ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={mark.isPending}
          onClick={() => mark.mutate(item.id, { onError: (error) => toast.error(because(error, 'Could not mark it read')) })}
        >
          Mark read
        </Button>
      ) : null}
    </div>
  )
}

export function Notifications() {
  const { notifications, pending, failed } = useNotifications()
  const markAll = useMarkAllRead()
  const unread = (notifications ?? []).filter((item) => item.read_ms === null).length

  return (
    <>
      <PageHeader title="Notifications" meta={notifications ? <span className="rounded-full bg-muted px-2 text-caption font-medium leading-5 text-muted-foreground">{unread} unread</span> : undefined}>
        {unread > 0 ? (
          <Button
            size="sm"
            disabled={markAll.isPending}
            onClick={() =>
              markAll.mutate(undefined, {
                onSuccess: (result) => toast.success(`${result.marked} marked read`),
                onError: (error) => toast.error(because(error, 'Could not mark everything read')),
              })
            }
          >
            Mark all as read
          </Button>
        ) : null}
      </PageHeader>
      {failed ? <Card className="w-full max-w-[760px] self-center px-4 py-3 text-control text-muted-foreground">{because(failed, 'Notifications could not be read.')}</Card> : null}
      {!failed && pending ? <Card className="w-full max-w-[760px] self-center px-4 py-3 text-control text-muted-foreground">Reading…</Card> : null}
      {!failed && notifications && notifications.length === 0 ? (
        <EmptyState icon={<Bell />} title="Nothing here yet">
          You will see exception alerts for your teams, service-silence warnings, status page activity, api key expiry, usage thresholds and member changes here once they happen.
        </EmptyState>
      ) : null}
      {notifications && notifications.length > 0 ? (
        <Card className="w-full max-w-[760px] self-center overflow-hidden">
          {notifications.map((item) => <Row key={item.id} item={item} />)}
        </Card>
      ) : null}
    </>
  )
}
