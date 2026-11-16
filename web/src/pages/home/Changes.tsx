import { SafeLink } from '@/components/ft/panels/SafeLink'
import { ServiceDot } from '@/components/ft/bits'
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
    <li className="relative flex flex-col gap-1 border-t border-border-subtle px-1 py-3 hover:bg-row-hover max-md:px-0">
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

export function Changes({ releases, pending, failed, windowMs, now }: { releases: Release[]; pending: boolean; failed: boolean; windowMs: number; now: number }) {
  const rows = recent(releases, windowMs, now)
  return (
    <section aria-labelledby="home-changes" className="flex min-w-0 flex-col">
      <h2 id="home-changes" className="pb-2 text-heading">What changed</h2>
      {failed ? (
        <p className="m-0 border-t border-border-subtle py-3 text-control text-muted-foreground">Could not read the releases.</p>
      ) : pending ? (
        <p className="m-0 border-t border-border-subtle py-3 text-control text-muted-foreground">Reading the releases…</p>
      ) : rows.length === 0 ? (
        <p className="m-0 border-t border-border-subtle py-3 text-control text-muted-foreground">No release in the last {windowMs > 24 * 60 * 60 * 1000 ? `${Math.round(windowMs / (24 * 60 * 60 * 1000))} days` : '24 hours'}.</p>
      ) : (
        <>
          <ol className="m-0 flex list-none flex-col p-0">{rows.map((release) => <Row key={`${release.service}@${release.version}`} release={release} />)}</ol>
          <SafeLink to="/releases" className="border-t border-border-subtle py-3 text-control text-accent-text max-md:min-h-11">All releases</SafeLink>
        </>
      )}
    </section>
  )
}
