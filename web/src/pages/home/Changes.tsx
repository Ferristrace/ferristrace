import { SafeLink } from '@/components/ft/panels/SafeLink'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { releasePath, useRelease, type Release } from '@/data/releases'
import { stamp } from '@/lib/format'
import { cn } from '@/lib/utils'
import { releaseEffect, type Tone } from './attention'
import { pill, when } from './hub'

export const CHANGES_SHOWN = 5

const PILL: Record<Tone, string> = { worse: 'bg-destructive-subtle text-destructive-text', better: 'bg-success-subtle text-success-text', same: 'bg-muted text-muted-foreground', none: 'bg-muted text-muted-foreground' }

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
  if (failed) return <span className="text-control text-muted-foreground">Could not read the effect.</span>
  if (pending || !detail) return <span className="text-control text-muted-foreground">Reading the effect…</span>
  const effect = releaseEffect(detail)
  const delta = pill(effect)
  const thin = effect.tone === 'none' && effect.before !== null && effect.after !== null
  return (
    <>
      <span className="whitespace-nowrap font-mono text-caption text-muted-foreground" title={thin ? 'Fewer than 20 requests, no verdict.' : undefined}>
        {rate(effect.before)} to {rate(effect.after)}
      </span>
      {delta ? (
        <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-caption font-medium tabular', PILL[delta.tone])} aria-label={`Error rate ${delta.text}${WORD[delta.tone] ? `, ${WORD[delta.tone]}` : ''}`}>
          {delta.text}
        </span>
      ) : null}
    </>
  )
}

function Row({ release, now }: { release: Release; now: number }) {
  const version = release.version.length > 16 ? `${release.version.slice(0, 12)}…` : release.version
  return (
    <li className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-3.5 py-2 last:border-b-0 hover:bg-row-hover">
      <div className="flex min-w-0 flex-[1_1_150px] flex-col py-1">
        <SafeLink to={releasePath(release.service, release.version)} title={`${release.service} ${release.version}`} aria-label={`${release.service} ${release.version}`} className="w-fit max-w-full truncate font-mono text-caption font-medium text-foreground no-underline hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          {release.service}
        </SafeLink>
        <span className="font-mono text-caption text-muted-foreground">
          {version} · <span title={stamp(release.firstSeenMs)}>{when(release.firstSeenMs, now)}</span>
          {release.newIssues > 0 ? <span className="text-warning-text"> · {release.newIssues} new {release.newIssues === 1 ? 'issue' : 'issues'}</span> : null}
        </span>
      </div>
      <Effect release={release} />
    </li>
  )
}

const note = 'm-0 px-3.5 py-3 text-control text-muted-foreground'

export function Changes({ releases, pending, failed, windowMs, now, className }: { releases: Release[]; pending: boolean; failed: boolean; windowMs: number; now: number; className?: string }) {
  const rows = recent(releases, windowMs, now)
  return (
    <section aria-labelledby="home-changes" className={cn('min-w-0', className)}>
      <Card className="flex h-full flex-col overflow-hidden rounded-sm">
        <CardHeader>
          <CardTitle id="home-changes" className="flex-1">What changed</CardTitle>
          <SafeLink to="/releases" className="text-caption font-medium text-accent-text no-underline hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center">Releases</SafeLink>
        </CardHeader>
        {failed ? (
          <p className={note}>Could not read the releases.</p>
        ) : pending ? (
          <p className={note}>Reading the releases…</p>
        ) : rows.length === 0 ? (
          <p className={note}>No release in the last {windowMs > 24 * 60 * 60 * 1000 ? `${Math.round(windowMs / (24 * 60 * 60 * 1000))} days` : '24 hours'}.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">{rows.map((release) => <Row key={`${release.service}@${release.version}`} release={release} now={now} />)}</ol>
        )}
      </Card>
    </section>
  )
}
