import { Bell, CircleCheck, CircleMinus, CircleX, FileText, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Logo } from './Logo'
import { OVERALL_WORDS, STATUS_WORDS, UPTIME_DAYS, type ComponentStatus, type PublicIncident, type PublicStatus } from '@/data/status-page'
import { cn } from '@/lib/utils'

const DAY_MS = 86_400_000

const CHIP: Record<ComponentStatus, 'success' | 'warning' | 'destructive'> = { operational: 'success', degraded: 'warning', down: 'destructive' }

const BAR_COLOR: Record<ComponentStatus, string> = {
  operational: 'bg-[#27c9b0]',
  degraded: 'bg-[#f5a742]',
  down: 'bg-[#ff6b81]',
}

const STATUS_ICON: Record<ComponentStatus, { Icon: typeof CircleCheck; color: string }> = {
  operational: { Icon: CircleCheck, color: 'text-[#27c9b0]' },
  degraded: { Icon: TriangleAlert, color: 'text-[#f5a742]' },
  down: { Icon: CircleX, color: 'text-[#ff6b81]' },
}

const BANNER: Record<ComponentStatus, { box: string; badge: string; Icon: typeof CircleCheck }> = {
  operational: { box: 'border-success-border bg-success-subtle', badge: 'bg-success-subtle text-success-text', Icon: CircleCheck },
  degraded: { box: 'border-warning-border bg-warning-subtle', badge: 'bg-warning-subtle text-warning-text', Icon: TriangleAlert },
  down: { box: 'border-destructive-border bg-destructive-subtle', badge: 'bg-destructive-subtle text-destructive-text', Icon: CircleX },
}

const when = (ms: number) =>
  new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const updatedAgo = (ms?: number) => {
  if (!ms) return 'Updated just now'
  const diffMinutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000))
  if (diffMinutes < 1) return 'Updated just now'
  if (diffMinutes === 1) return 'Updated 1 minute ago'
  if (diffMinutes < 60) return `Updated ${diffMinutes} minutes ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours === 1) return 'Updated 1 hour ago'
  return `Updated ${diffHours} hours ago`
}

const dayWindow = (dayIndex: number, total: number, nowMs: number) => {
  const daysAgo = total - 1 - dayIndex
  const endMs = nowMs - daysAgo * DAY_MS
  const startMs = endMs - DAY_MS
  return { startMs, endMs }
}

const formatFullDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

const formatShortDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const computeUptime = (days: (ComponentStatus | null)[]) => {
  const known = days.filter((day): day is ComponentStatus => day !== null)
  if (known.length === 0) return '— uptime'
  const score = known.reduce((acc, status) => acc + (status === 'operational' ? 1 : status === 'degraded' ? 0.5 : 0), 0)
  const pct = (score / known.length) * 100
  const formatted = pct === 100 ? '100%' : `${pct.toFixed(2).replace(/\.?0+$/, '')}%`
  return `${formatted} uptime`
}

const incidentsOnDay = (incidents: PublicIncident[], startMs: number, endMs: number) =>
  incidents.filter((incident) => incident.opened_ms <= endMs && (incident.resolved_ms ?? Infinity) >= startMs)

const capital = (word: string) => word.slice(0, 1).toUpperCase() + word.slice(1)

export function StatusPageView({ view, compact, subscribe }: { view: PublicStatus; compact?: boolean; subscribe?: (email: string) => Promise<void> }) {
  const { page } = view
  const banner = BANNER[view.overall]
  const open = view.incidents.filter((incident) => incident.status !== 'resolved')
  const past = view.incidents.filter((incident) => incident.status === 'resolved')
  const degradedComponents = view.components.filter((component) => component.status !== 'operational')
  const bannerSub =
    open[0]?.updates[0]?.text ??
    (page.intro?.trim() ||
      (degradedComponents.length > 0
        ? `${degradedComponents.map((component) => component.name).join(', ')} ${degradedComponents.length === 1 ? 'is' : 'are'} experiencing issues. We are investigating.`
        : null))

  const nowMs = Date.now()
  const rangeStartLabel = formatShortDate(nowMs - (UPTIME_DAYS - 1) * DAY_MS)

  return (
    <div
      className={cn(
        !compact && page.theme.mode === 'dark' && 'dark',
        !compact && page.theme.mode === 'light' && 'light',
        page.theme.accent !== 'indigo' && `accent-${page.theme.accent}`,
        'min-h-full bg-background text-foreground',
      )}
    >
      <header className="mx-auto flex max-w-[720px] flex-wrap items-center gap-x-3 gap-y-3 px-4 pt-8 md:px-0">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-[16px] font-semibold text-accent-text" aria-hidden>{page.name.slice(0, 1).toUpperCase()}</span>
        <div className="flex min-w-0 flex-1 flex-col max-md:flex-[1_1_60%]">
          <span className="text-[18px] font-semibold leading-6">{page.name} status</span>
          <span className="text-caption text-muted-foreground">{updatedAgo(page.updated_ms)}</span>
        </div>
        {!compact && subscribe ? <Button asChild variant="outline" size="sm"><a href="#subscribe">Subscribe to updates</a></Button> : null}
      </header>
      <main className="mx-auto flex max-w-[720px] flex-col gap-5 px-4 pb-16 pt-6 md:px-0">
        <section aria-live="polite" className={cn('flex items-start gap-3 rounded-md border px-4 py-4', banner.box)}>
          <span className={cn('mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full', banner.badge)}><banner.Icon className="size-4" aria-hidden /></span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1 className="text-heading">{OVERALL_WORDS[view.overall]}</h1>
            {bannerSub ? <p className="m-0 text-control text-muted-foreground">{bannerSub}</p> : null}
          </div>
        </section>
        {open.map((incident, index) => <IncidentCard key={`${incident.opened_ms}-${index}`} incident={incident} />)}
        <section className=" rounded-md border bg-card" aria-label="Components">
          {view.components.length === 0 ? <div className="px-4 py-3 text-control text-muted-foreground">No components are shown yet.</div> : null}
          {view.components.map((component) => (
            <ComponentRow
              key={component.name}
              component={component}
              incidents={view.incidents}
              nowMs={nowMs}
              rangeStartLabel={rangeStartLabel}
            />
          ))}
        </section>
        {past.length ? (
          <section className="flex flex-col gap-3" aria-label="Past incidents">
            <h2 className="text-heading">Resolved in the last seven days</h2>
            {past.map((incident, index) => <IncidentCard key={`${incident.opened_ms}-${index}`} incident={incident} />)}
          </section>
        ) : (
          <p className="m-0 text-caption text-muted-foreground">Past incidents: none in the last 7 days.</p>
        )}
        {!compact && subscribe ? <SubscribeForm subscribe={subscribe} /> : null}
      </main>
      <footer className="border-t"><div className="mx-auto flex max-w-[720px] items-center gap-2 px-4 py-5 text-caption text-muted-foreground md:px-0"><span className="flex-1" /><Logo className="size-4" />Powered by FerrisTrace</div></footer>
    </div>
  )
}

function ComponentRow({
  component,
  incidents,
  nowMs,
  rangeStartLabel,
}: {
  component: PublicStatus['components'][number]
  incidents: PublicIncident[]
  nowMs: number
  rangeStartLabel: string
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const days: (ComponentStatus | null)[] =
    component.days?.length === UPTIME_DAYS
      ? component.days
      : Array.from({ length: UPTIME_DAYS }, (_, idx) => (idx === UPTIME_DAYS - 1 ? component.status : null))
  const statusIcon = STATUS_ICON[component.status]

  return (
    <div className="flex flex-col gap-2.5 border-b border-border-subtle px-5 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <statusIcon.Icon className={cn('size-4 shrink-0', statusIcon.color)} aria-hidden />
          <span className="truncate text-control font-semibold">{component.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-caption text-muted-foreground">{computeUptime(days)}</span>
          <Badge variant={CHIP[component.status]} mono className="w-[100px] shrink-0 justify-center">
            {STATUS_WORDS[component.status]}
          </Badge>
        </div>
      </div>

      <div
        className="relative grid grid-cols-[repeat(30,minmax(0,1fr))] gap-[3px]"
        role="img"
        aria-label={`${component.name} ${UPTIME_DAYS}-day uptime history`}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        {days.map((dayStatus, idx) => {
          const { startMs, endMs } = dayWindow(idx, days.length, nowMs)
          const dayIncidents = incidentsOnDay(incidents, startMs, endMs)
          const isHovered = hoveredIdx === idx
          const alignClass =
            idx < 6 ? 'left-0' : idx > days.length - 7 ? 'right-0' : 'left-1/2 -translate-x-1/2'

          return (
            <div
              key={idx}
              className="relative flex flex-col items-center"
              onMouseEnter={() => setHoveredIdx(idx)}
            >
              <span
                className={cn(
                  'h-7 w-full rounded-[2px] transition-opacity',
                  dayStatus ? BAR_COLOR[dayStatus] : 'bg-muted/45 dark:bg-zinc-800',
                  isHovered && 'opacity-80 ring-1 ring-ring/50',
                )}
              />
              {isHovered ? (
                <div
                  role="tooltip"
                  className={cn(
                    'pointer-events-none absolute top-full z-30 mt-2 w-60 rounded-lg border bg-popover px-3.5 py-2.5 text-popover-foreground shadow-lg',
                    alignClass,
                  )}
                >
                  <div className="text-caption font-medium text-muted-foreground">
                    {formatFullDate(endMs)}
                  </div>
                  {dayStatus === null && dayIncidents.length === 0 ? (
                    <div className="mt-1.5 flex items-center gap-2 text-control text-muted-foreground">
                      <CircleMinus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span>No data available</span>
                    </div>
                  ) : dayIncidents.length > 0 ? (
                    <div className="mt-1.5 flex flex-col gap-1.5">
                      {dayIncidents.map((inc, i) => (
                        <div key={i} className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 text-control font-medium">
                            <TriangleAlert className="size-3.5 shrink-0 text-[#f5a742]" aria-hidden />
                            <span className="truncate">{inc.title}</span>
                          </div>
                          {inc.updates[0] ? (
                            <p className="m-0 line-clamp-2 pl-5 text-caption text-muted-foreground">
                              {inc.updates[0].text}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : dayStatus && dayStatus !== 'operational' ? (
                    <div className="mt-1.5 flex items-center gap-2 text-control">
                      {dayStatus === 'down' ? (
                        <CircleX className="size-4 shrink-0 text-[#ff6b81]" aria-hidden />
                      ) : (
                        <TriangleAlert className="size-4 shrink-0 text-[#f5a742]" aria-hidden />
                      )}
                      <span>{STATUS_WORDS[dayStatus]}</span>
                    </div>
                  ) : (
                    <div className="mt-1.5 flex items-center gap-2 text-control text-muted-foreground">
                      <CircleCheck className="size-4 shrink-0 text-[#27c9b0]" aria-hidden />
                      <span>No incidents</span>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{rangeStartLabel} ({UPTIME_DAYS} days ago)</span>
        <span>Today</span>
      </div>
    </div>
  )
}

function IncidentCard({ incident }: { incident: PublicIncident }) {
  const resolved = incident.status === 'resolved'
  return (
    <article className={cn('overflow-hidden rounded-md border bg-card', !resolved && 'border-warning-border')}>
      <div className={cn('flex flex-col gap-1.5 border-b px-5 py-4', !resolved && 'border-warning-border bg-warning-subtle')}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={resolved ? 'success' : 'warning'}>{capital(incident.status)}</Badge>
          <span className="text-control text-muted-foreground">Since {when(incident.opened_ms)}{incident.resolved_ms !== null ? ` · resolved ${when(incident.resolved_ms)}` : ''}</span>
          {incident.postmortem_url ? <a className="ml-auto inline-flex items-center gap-1 text-control" href={incident.postmortem_url}><FileText className="size-3.5" aria-hidden />Postmortem</a> : null}
        </div>
        <h2 className="text-heading">{incident.title}</h2>
      </div>
      <ol className="m-0 flex list-none flex-col px-5 pb-4 pt-1">
        {incident.updates.map((update, index) => (
          <li key={`${update.at_ms}-${index}`} className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 md:grid-cols-[130px_minmax(0,1fr)] border-b border-border-subtle py-3 last:border-b-0">
            <div className="flex flex-col"><span className="text-control font-semibold">{update.kind === 'status' ? capital(update.text) : 'Update'}</span><time className="font-mono text-caption text-muted-foreground">{when(update.at_ms)}</time></div>
            <p className="m-0 whitespace-pre-wrap text-body">{update.kind === 'status' ? `The incident is ${update.text}.` : update.text}</p>
          </li>
        ))}
      </ol>
    </article>
  )
}

function SubscribeForm({ subscribe }: { subscribe: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  return (
    <section id="subscribe" className="flex flex-col gap-2 rounded-md border bg-card px-4 py-4" aria-label="Subscribe">
      <h2 className="flex items-center gap-1.5 text-sub"><Bell className="size-4" aria-hidden />Get incident updates by email</h2>
      {state === 'sent' ? (
        <p className="m-0 text-control text-muted-foreground">If this address can subscribe, a confirmation link is on its way. Open it within seven days.</p>
      ) : (
        <form className="flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault()
          setState('sending')
          subscribe(email.trim()).then(() => setState('sent'), () => setState('failed'))
        }}>
          <Input type="email" required aria-label="Email address" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} className="max-w-[320px]" />
          <Button type="submit" variant="primary" size="sm" disabled={state === 'sending' || !email.trim()}>Subscribe</Button>
          {state === 'failed' ? <span className="w-full text-control text-destructive-text">That address was not accepted.</span> : null}
        </form>
      )}
    </section>
  )
}
