import { Bell, CircleCheck, CircleX, FileText, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Logo } from './Logo'
import { OVERALL_WORDS, STATUS_WORDS, type ComponentStatus, type PublicIncident, type PublicStatus } from '@/data/status-page'
import { cn } from '@/lib/utils'

const CHIP: Record<ComponentStatus, 'success' | 'warning' | 'destructive'> = { operational: 'success', degraded: 'warning', down: 'destructive' }

const BANNER: Record<ComponentStatus, { box: string; badge: string; Icon: typeof CircleCheck }> = {
  operational: { box: 'border-success-border bg-success-subtle', badge: 'bg-success-subtle text-success-text', Icon: CircleCheck },
  degraded: { box: 'border-warning-border bg-warning-subtle', badge: 'bg-warning-subtle text-warning-text', Icon: TriangleAlert },
  down: { box: 'border-destructive-border bg-destructive-subtle', badge: 'bg-destructive-subtle text-destructive-text', Icon: CircleX },
}

const when = (ms: number) =>
  new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const capital = (word: string) => word.slice(0, 1).toUpperCase() + word.slice(1)

export function StatusPageView({ view, compact, subscribe }: { view: PublicStatus; compact?: boolean; subscribe?: (email: string) => Promise<void> }) {
  const { page } = view
  const banner = BANNER[view.overall]
  const open = view.incidents.filter((incident) => incident.status !== 'resolved')
  const past = view.incidents.filter((incident) => incident.status === 'resolved')
  return (
    <div className={cn(page.theme.accent !== 'indigo' && `accent-${page.theme.accent}`, 'min-h-full bg-background text-foreground')}>
      <header className="mx-auto flex max-w-[720px] flex-wrap items-center gap-x-3 gap-y-3 px-4 pt-8 md:px-0">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-[16px] font-semibold text-accent-text" aria-hidden>{page.name.slice(0, 1).toUpperCase()}</span>
        <div className="flex min-w-0 flex-1 flex-col max-md:flex-[1_1_60%]">
          <span className="text-[18px] font-semibold leading-6">{page.name} <span className="font-normal text-muted-foreground">status</span></span>
          <span className="text-caption text-muted-foreground">Refreshes every minute</span>
        </div>
        {!compact && subscribe ? <Button asChild size="sm"><a href="#subscribe"><Bell />Subscribe to updates</a></Button> : null}
      </header>
      <main className="mx-auto flex max-w-[720px] flex-col gap-5 px-4 pb-16 pt-6 md:px-0">
        {page.intro ? <p className="m-0 whitespace-pre-wrap text-control text-muted-foreground">{page.intro}</p> : null}
        <section aria-live="polite" className={cn('flex items-center gap-3 rounded-md border px-4 py-4', banner.box)}>
          <span className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-full', banner.badge)}><banner.Icon className="size-4" aria-hidden /></span>
          <h1 className="text-heading">{OVERALL_WORDS[view.overall]}</h1>
        </section>
        {open.map((incident, index) => <IncidentCard key={`${incident.opened_ms}-${index}`} incident={incident} />)}
        <section className="overflow-hidden rounded-md border bg-card" aria-label="Components">
          {view.components.length === 0 ? <div className="px-4 py-3 text-control text-muted-foreground">No components are shown yet.</div> : null}
          {view.components.map((component) => (
            <div key={component.name} className="flex h-14 items-center gap-3 border-b border-border-subtle px-4 last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-control font-semibold">{component.name}</span>
              <Badge variant={CHIP[component.status]} mono className="w-[104px] shrink-0 justify-center">{STATUS_WORDS[component.status]}</Badge>
            </div>
          ))}
        </section>
        {past.length ? (
          <section className="flex flex-col gap-3" aria-label="Past incidents">
            <h2 className="text-heading">Resolved in the last seven days</h2>
            {past.map((incident, index) => <IncidentCard key={`${incident.opened_ms}-${index}`} incident={incident} />)}
          </section>
        ) : null}
        {!compact && subscribe ? <SubscribeForm subscribe={subscribe} /> : null}
      </main>
      <footer className="border-t"><div className="mx-auto flex max-w-[720px] items-center gap-2 px-4 py-5 text-caption text-muted-foreground md:px-0"><span className="flex-1" /><Logo className="size-4" />Powered by FerrisTrace</div></footer>
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
