import { SafeLink } from '@/components/ft/panels/SafeLink'
import { ServiceDot } from '@/components/ft/bits'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { releasePath, useRelease, type Release } from '@/data/releases'
import { since } from '@/data/services'
import { cn } from '@/lib/utils'
import { releaseEffect, type Tone } from './attention'

export const CHANGES_SHOWN = 5

const TONE: Record<Tone, string> = { worse: 'font-semibold text-warning-text', better: 'font-semibold text-success-text', same: 'text-muted-foreground', none: 'text-muted-foreground' }

const WORD: Record<Tone, string> = { worse: 'worse', better: 'better', same: 'unchanged', none: '' }

const rate = (value: number | null) => (value === null ? 'no data' : `${value.toFixed(1)} %`)

export function recent(releases: Release[], windowMs: number, now: number): Release[] {
  return releases
    .filter((release) => release.firstSeenMs >= now - windowMs)
    .sort((a, b) => b.firstSeenMs - a.firstSeenMs)
    .slice(0, CHANGES_SHOWN)
}

function Effect({ release }: { release: Release }) {
  const { release: detail, pending, failed } = useRelease(release.service, release.version)
  if (failed) return <p className="m-0 text-control text-muted-foreground">Could not read the effect of this release.</p>
  if (pending || !detail) return <p className="m-0 text-control text-muted-foreground">Reading the effect…</p>
  const effect = releaseEffect(detail)
  const thin = effect.tone === 'none' && effect.before !== null && effect.after !== null
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-control font-normal">
      <span className="text-muted-foreground">
        Error rate <span className="font-mono text-foreground">{rate(effect.before)}</span> to <span className={cn('font-mono', TONE[effect.tone])}>{rate(effect.after)}</span>
        {WORD[effect.tone] ? <span className={TONE[effect.tone]}>, {WORD[effect.tone]}</span> : null}
      </span>
      {thin ? <span className="text-caption text-muted-foreground">Fewer than 20 requests, no verdict.</span> : null}
      <span className={cn(effect.introduced > 0 ? 'font-semibold text-warning-text' : 'text-muted-foreground')}>
        {effect.introduced === 0 ? 'No new issue' : `${effect.introduced} new ${effect.introduced === 1 ? 'issue' : 'issues'}`}
      </span>
    </p>
  )
}

function Row({ release }: { release: Release }) {
  return (
    <li className="relative flex flex-col gap-1 border-b border-border-subtle px-3.5 py-3 last:border-b-0 hover:bg-row-hover">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <ServiceDot name={release.service} className="self-center" />
        <SafeLink to={releasePath(release.service, release.version)} title={`${release.service} ${release.version}`} aria-label={`${release.service} ${release.version}`} className="font-mono text-body font-semibold text-foreground no-underline after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          {release.service} {release.version.length > 16 ? `${release.version.slice(0, 12)}…` : release.version}
        </SafeLink>
        <span className="ml-auto text-caption text-muted-foreground">{since(release.firstSeenMs)}</span>
      </div>
      <Effect release={release} />
    </li>
  )
}

const note = 'm-0 px-3.5 py-3 text-control text-muted-foreground'

export function Changes({ releases, pending, failed, windowMs, now }: { releases: Release[]; pending: boolean; failed: boolean; windowMs: number; now: number }) {
  const rows = recent(releases, windowMs, now)
  const listed = !failed && !pending && rows.length > 0
  return (
    <section aria-labelledby="home-changes" className="min-w-0">
      <Card className="flex flex-col overflow-hidden">
        <CardHeader>
          <CardTitle id="home-changes" className="flex-1">What changed</CardTitle>
          {listed ? <SafeLink to="/releases" className="text-control text-accent-text max-md:inline-flex max-md:min-h-11 max-md:items-center">All releases</SafeLink> : null}
        </CardHeader>
        {failed ? (
          <p className={note}>Could not read the releases.</p>
        ) : pending ? (
          <p className={note}>Reading the releases…</p>
        ) : rows.length === 0 ? (
          <p className={note}>No release in the last {windowMs > 24 * 60 * 60 * 1000 ? `${Math.round(windowMs / (24 * 60 * 60 * 1000))} days` : '24 hours'}.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">{rows.map((release) => <Row key={`${release.service}@${release.version}`} release={release} />)}</ol>
        )}
      </Card>
    </section>
  )
}
