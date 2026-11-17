import { perSecond, type Stepped } from '@/data/services'
import { dur } from '@/lib/format'
import { MIN_REQUESTS, deltaOf, tracesQuery, withSearch, type Delta } from './attention'

export type Figure = { key: string; label: string; value: string | null; delta: Delta; to: string; note: string | null; caveat: string | null }

export type Read = 'ok' | 'failed' | 'pending'

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
