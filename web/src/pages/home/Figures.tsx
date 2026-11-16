import { SafeLink } from '@/components/ft/panels/SafeLink'
import { perSecond, type Stepped } from '@/data/services'
import { dur } from '@/lib/format'
import { cn } from '@/lib/utils'
import { MIN_REQUESTS, deltaOf, linkOf, tracesQuery, withSearch, type Delta, type Tone } from './attention'

export type Figure = { key: string; label: string; value: string | null; delta: Delta; to: string; note: string | null; caveat: string | null }

export type Read = 'ok' | 'failed' | 'pending'

const TONE: Record<Tone, string> = { worse: 'font-semibold text-warning-text', better: 'font-semibold text-success-text', same: 'text-muted-foreground', none: 'text-muted-foreground' }

const quiet = (series: Stepped | null) => series === null || series.requests === 0

export function figuresOf(now: Stepped | null, before: Stepped | null, windowMs: number, windowLabel: string, state: Read, place: Record<string, string> = {}, beforeState: Read = 'ok'): Figure[] {
  const seconds = windowMs / 1000
  const known = state === 'ok' && !quiet(now)
  const prior = state === 'ok' && beforeState === 'ok' && !quiet(before)
  const rate = known && now ? now.requests / seconds : null
  const was = prior && before ? before.requests / seconds : null
  const errors = known && now ? (now.errors / now.requests) * 100 : null
  const errorsWas = prior && before ? (before.errors / before.requests) * 100 : null
  const p95 = known ? (now?.p95Ms ?? null) : null
  const p95Was = prior ? (before?.p95Ms ?? null) : null
  const thin = prior && ((now?.requests ?? 0) < MIN_REQUESTS || (before?.requests ?? 0) < MIN_REQUESTS)
  const note =
    state === 'failed'
      ? 'Could not read the figures.'
      : state === 'pending'
        ? 'Reading the figures…'
        : quiet(now)
          ? `No request in the last ${windowLabel}.`
          : beforeState === 'failed'
            ? 'Could not read the previous period.'
            : beforeState === 'pending'
              ? 'Reading the previous period…'
              : null
  const errorDelta = deltaOf(errors, errorsWas, 'error')
  return [
    { key: 'rate', label: 'Requests per second', value: rate === null ? null : perSecond(rate), delta: deltaOf(rate, was, 'traffic'), to: withSearch('/services', place), note, caveat: null },
    {
      key: 'errors',
      label: 'Error rate',
      value: errors === null ? null : `${errors.toFixed(1)} %`,
      delta: thin ? { text: errorDelta.text, tone: 'none', word: '' } : errorDelta,
      to: withSearch(tracesQuery('status = "error"'), place),
      note,
      caveat: thin ? `Fewer than ${MIN_REQUESTS} requests, no verdict.` : null,
    },
    { key: 'p95', label: 'p95 latency', value: p95 === null ? null : dur(p95), delta: deltaOf(p95, p95Was, 'latency'), to: withSearch('/services', place), note: note ?? (p95 === null ? 'No latency measured.' : null), caveat: null },
  ]
}

export function Figures({ figures, short }: { figures: Figure[]; short: string }) {
  return (
    <section aria-label="Figures" className="grid min-w-0 grid-cols-1 gap-x-6 sm:grid-cols-3">
      {figures.map((figure) => {
        const to = linkOf(figure.to)
        return (
          <SafeLink key={figure.key} to={to.path} search={to.search} className="relative flex flex-col gap-0.5 border-t border-border-subtle px-1 py-3 text-foreground no-underline hover:bg-row-hover max-md:min-h-11 max-md:px-0 focus-visible:outline-2 focus-visible:outline-ring">
            <span className="text-caption text-muted-foreground">{figure.label}</span>
            <span className="font-mono text-[22px] font-semibold leading-[30px]">{figure.value ?? '—'}</span>
            {figure.delta.text === '' ? (
              <span className="text-caption text-muted-foreground">{figure.note ?? (figure.value === null ? 'No data.' : 'No previous period to compare.')}</span>
            ) : (
              <span className="text-caption text-muted-foreground">
                <span className={cn('font-mono', TONE[figure.delta.tone])}>{figure.delta.text}</span> vs previous {short}
                {figure.delta.word ? <span className={TONE[figure.delta.tone]}>, {figure.delta.word}</span> : null}
                {figure.caveat ? ` ${figure.caveat}` : null}
              </span>
            )}
          </SafeLink>
        )
      })}
    </section>
  )
}
