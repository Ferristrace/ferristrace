import { bytes, count, startOfMonth, startOfNextMonth, type Metered, type Pricing, type ProjectUsage, type Signal } from '@/data/usage'
import { HOUR, SIGNAL_KEYS, axisMoney, billOf, billableMicros, formatMoney, noVolumes, percentChange, projectedVolume, signed, valueMicros, type Volumes } from './money'

export const DAY = 86_400_000
export const ALL = 'all'
export const NONE = 'none'

export const LABEL: Record<Signal, string> = { spans: 'Spans', logs: 'Logs', metrics: 'Metrics' }

export const STACK: Signal[] = ['metrics', 'logs', 'spans']

export type Choice = string

export type PerDay = Record<Signal, number[]>

export type Tile = { key: string; label: string; value: string; sub?: string; tone?: 'warn' | 'err' | 'ok' }

export type Quota = { signal: Signal; label: string; used: string; included: string | null; share: number | null; note: string; tone?: 'warn' | 'err' }

export type Bar = { at: number; parts: Record<Signal, number>; total: number }

export type Slice = { signal: Signal; label: string; value: number }

export type View = {
  priced: boolean
  single: boolean
  currency: string | null
  from: number
  slots: number
  last: number
  shown: Signal[]
  tiles: Tile[]
  actual: (number | null)[]
  ahead: (number | null)[]
  slices: Slice[]
  total: number
  bars: Bar[]
  quotas: Quota[]
  format: (value: number) => string
  axis: (value: number) => string
}

export type Row = { key: string; name: string; volumes: Volumes; figure: number; days: number[]; change: number | null }

export const dayLabel = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

const monthName = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })

export const projectKey = (row: ProjectUsage): string => row.project ?? NONE

export const projectName = (row: ProjectUsage): string => row.name ?? (row.project === null ? 'No project' : 'Deleted project')

const projectsOf = (metered: Metered | undefined): ProjectUsage[] => metered?.projects ?? []

const rowOf = (metered: Metered | undefined, choice: Choice): ProjectUsage | undefined => projectsOf(metered).find((row) => projectKey(row) === choice)

export function choicesOf(metered: Metered | undefined): { value: string; label: string }[] {
  const named = projectsOf(metered).map((row) => ({ value: projectKey(row), label: projectName(row) }))
  return [{ value: ALL, label: 'All projects' }, ...named.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))]
}

export function totalsOf(metered: Metered | undefined, choice: Choice): Volumes {
  if (!metered) return noVolumes()
  if (choice === ALL) return { spans: metered.by_signal.spans_bytes, logs: metered.by_signal.logs_bytes, metrics: metered.by_signal.metrics_points }
  const row = rowOf(metered, choice)
  return row ? { spans: row.spans_bytes, logs: row.logs_bytes, metrics: row.metrics_points } : noVolumes()
}

export const slotsOf = (from: number, to: number): number => Math.max(1, Math.round((to - from) / DAY))

export const lastDayOf = (from: number, to: number, now: number): number => {
  const slots = slotsOf(from, to)
  return now >= to ? slots - 1 : now < from ? -1 : Math.min(slots - 1, Math.floor((now - from) / DAY))
}

const zeros = (slots: number): number[] => Array.from({ length: slots }, () => 0)

export function daysOf(metered: Metered | undefined, choice: Choice, from: number, slots: number): PerDay {
  const out: PerDay = { spans: zeros(slots), logs: zeros(slots), metrics: zeros(slots) }
  if (!metered) return out
  if (choice === ALL) {
    for (const hour of metered.hours) {
      const slot = Math.floor((hour.started_at_ms - from) / DAY)
      if (slot < 0 || slot >= slots) continue
      out.spans[slot] += hour.spans_bytes ?? 0
      out.logs[slot] += hour.logs_bytes ?? 0
      out.metrics[slot] += hour.metrics_points ?? 0
    }
    return out
  }
  for (const day of rowOf(metered, choice)?.days ?? []) {
    const slot = Math.floor((day.day_ms - from) / DAY)
    if (slot < 0 || slot >= slots) continue
    out.spans[slot] += day.spans_bytes
    out.logs[slot] += day.logs_bytes
    out.metrics[slot] += day.metrics_points
  }
  return out
}

type Measure = (signal: Signal, volume: number) => number

function measureFor(pricing: Pricing | null, net: boolean): Measure {
  if (!pricing) return (_, volume) => volume
  return net ? (signal, volume) => billableMicros(pricing, signal, volume) : (signal, volume) => valueMicros(pricing, signal, volume)
}

export function levelsOf(daily: number[], at: (volume: number) => number, last: number, slots: number, projected: number | null): number[] {
  const out: number[] = []
  let run = 0
  for (let i = 0; i <= last; i++) {
    run += daily[i] ?? 0
    out.push(at(run))
  }
  if (projected !== null && last >= 0 && last < slots - 1) {
    for (let i = last + 1; i < slots; i++) out.push(at(Math.round(run + ((projected - run) * (i - last)) / (slots - 1 - last))))
  }
  return out
}

const steps = (levels: number[], last: number): number[] => levels.slice(0, last + 1).map((level, i) => level - (levels[i - 1] ?? 0))

export const volumeText = (signal: Signal, value: number): string => (signal === 'metrics' ? count(value) : bytes(value))

export const figureText = (pricing: Pricing | null, signal: Signal | typeof ALL, value: number): string =>
  pricing ? formatMoney(value, pricing.currency) : signal === 'metrics' ? count(value) : bytes(value)

const shownFor = (pricing: Pricing | null): Signal[] => (pricing ? STACK : STACK.filter((signal) => signal !== 'metrics'))

export function windowOf(period: 'this' | 'last', now: number): [number, number] {
  const start = startOfMonth(now)
  return period === 'this' ? [start, startOfNextMonth(now)] : [startOfMonth(start - 1), start]
}

export function previousWindow(from: number, to: number, now: number): [number, number] {
  const start = startOfMonth(from - 1)
  const elapsed = now >= from && now < to ? Math.floor((now - from) / HOUR) * HOUR : to - from
  return [start, Math.min(from, start + Math.max(elapsed, HOUR))]
}

export function pillOf(from: number, to: number, now: number): string {
  const slots = slotsOf(from, to)
  return now >= from && now < to ? `${monthName(from)}, day ${Math.floor((now - from) / DAY) + 1} of ${slots}` : `${monthName(from)}, ${slots} days`
}

const sumOf = (volumes: Volumes, signals: Signal[], measure: Measure): number => signals.reduce((total, signal) => total + measure(signal, volumes[signal]), 0)

function quotasOf(used: Volumes, bill: ReturnType<typeof billOf> | null, from: number, to: number, now: number): Quota[] {
  const running = now >= from && now < to
  return SIGNAL_KEYS.map((signal) => {
    const part = bill?.by_signal[signal]
    const total = used[signal]
    const projected = part?.projected ?? projectedVolume(total, from, to, now)
    const included = part?.included ?? 0
    const share = included > 0 ? (total / included) * 100 : null
    const passes = part?.passes_at_ms ?? null
    const note =
      included > 0 && total >= included
        ? `over by ${volumeText(signal, total - included)}`
        : included > 0 && running && passes !== null
          ? `on pace to pass ${volumeText(signal, included)} on ${dayLabel(passes)}`
          : running
            ? `on pace for ${volumeText(signal, projected)}`
            : 'month closed'
    return {
      signal,
      label: LABEL[signal],
      used: volumeText(signal, total),
      included: included > 0 ? volumeText(signal, included) : null,
      share,
      note,
      tone: share !== null && share >= 100 ? 'err' : share !== null && share >= 80 ? 'warn' : undefined,
    }
  })
}

export function viewOf({ metered, before, choice, from, to, now }: { metered: Metered; before: Metered | undefined; choice: Choice; from: number; to: number; now: number }): View {
  const pricing = metered.pricing ?? null
  const single = choice !== ALL
  const running = now >= from && now < to
  const slots = slotsOf(from, to)
  const last = lastDayOf(from, to, now)
  const used = totalsOf(metered, choice)
  const prior = totalsOf(before, choice)
  const shown = shownFor(pricing)
  const measure = measureFor(pricing, false)
  const local = pricing ? billOf(pricing, used, from, to, now) : null
  const bill = pricing ? (single ? local : (metered.bill ?? local)) : null
  const currency = pricing?.currency ?? null
  const money = (micros: number) => formatMoney(micros, pricing?.currency ?? '')
  const since = running ? 'last month' : 'the month before'
  const against = (current: number, then: number | null): string | undefined => {
    const percent = percentChange(current, then)
    if (percent !== null) return `${signed(percent)} vs the same days of ${since}`
    return before ? `nothing to compare with in ${since}` : undefined
  }
  const renews = running ? `renews ${dayLabel(to)}` : 'month closed'

  const projectedOf = (signal: Signal): number => bill?.by_signal[signal].projected ?? projectedVolume(used[signal], from, to, now)
  const days = daysOf(metered, choice, from, slots)
  const levels: Partial<Record<Signal, number[]>> = {}
  for (const signal of shown) levels[signal] = levelsOf(days[signal], (volume) => measure(signal, volume), last, slots, running ? projectedOf(signal) : null)
  const total = (at: number) => shown.reduce((sum, signal) => sum + (levels[signal]?.[at] ?? 0), 0)
  const line = Array.from({ length: running && last >= 0 ? slots : last + 1 }, (_, at) => total(at))
  const actual = Array.from({ length: slots }, (_, at) => (at <= last ? (line[at] ?? null) : null))
  const ahead = Array.from({ length: slots }, (_, at) => (running && at >= last && last >= 0 ? (line[at] ?? null) : null))
  const slices = shown.map((signal) => ({ signal, label: LABEL[signal], value: last >= 0 ? (levels[signal]?.[last] ?? 0) : 0 }))
  const stepped = Object.fromEntries(shown.map((signal) => [signal, steps(levels[signal] ?? [], last)])) as Record<Signal, number[]>
  const bars = Array.from({ length: Math.max(0, last + 1) }, (_, at) => {
    const parts: Record<Signal, number> = { spans: stepped.spans?.[at] ?? 0, logs: stepped.logs?.[at] ?? 0, metrics: stepped.metrics?.[at] ?? 0 }
    return { at: from + at * DAY, parts, total: parts.spans + parts.logs + parts.metrics }
  })

  let tiles: Tile[]
  if (pricing && bill && !single) {
    const then = before ? SIGNAL_KEYS.reduce((sum, signal) => sum + billableMicros(pricing, signal, prior[signal]), 0) : null
    const rows = quotasOf(used, bill, from, to, now).filter((row) => row.share !== null)
    const top = rows.reduce<Quota | null>((best, row) => (best === null || (row.share ?? 0) > (best.share ?? 0) ? row : best), null)
    const covered = Math.max(0, bill.value_micros - bill.billable_micros)
    const part = top ? bill.by_signal[top.signal] : null
    tiles = [
      { key: 'spend', label: 'Spend to date', value: money(bill.billable_micros), sub: against(bill.billable_micros, then) },
      { key: 'projected', label: running ? 'Projected bill' : 'Bill for the month', value: money(running ? bill.projected_billable_micros : bill.billable_micros), sub: renews },
      top && part
        ? {
            key: 'included',
            label: `${top.label} included`,
            value: `${Math.round(top.share ?? 0)} %`,
            sub: `${top.used} of ${top.included}${(top.share ?? 0) >= 100 ? ' · over it' : running && part.passes_at_ms !== null ? ` · passes it ${dayLabel(part.passes_at_ms)}` : ''}`,
            tone: top.tone,
          }
        : { key: 'included', label: 'Included', value: 'None', sub: 'every signal is billed from the first unit' },
      {
        key: 'value',
        label: 'Usage value',
        value: money(bill.value_micros),
        sub: rows.length > 0 ? `${money(covered)} covered by what is included` : 'nothing is included in the plan',
      },
    ]
  } else if (pricing && bill) {
    const org = totalsOf(metered, ALL)
    const orgValue = SIGNAL_KEYS.reduce((sum, signal) => sum + valueMicros(pricing, signal, org[signal]), 0)
    const share = orgValue > 0 ? Math.round((bill.value_micros / orgValue) * 100) : null
    tiles = [
      { key: 'spend', label: 'Value to date', value: money(bill.value_micros), sub: against(bill.value_micros, before ? SIGNAL_KEYS.reduce((sum, signal) => sum + valueMicros(pricing, signal, prior[signal]), 0) : null) },
      { key: 'projected', label: running ? 'Projected value' : 'Value for the month', value: money(running ? bill.projected_value_micros : bill.value_micros), sub: renews },
      { key: 'share', label: 'Share of the organisation', value: share === null ? '—' : `${share} %`, sub: `of ${money(orgValue)} usage value` },
    ]
  } else {
    const bytesOf = (volumes: Volumes) => volumes.spans + volumes.logs
    const everyDay = zeros(slots).map((_, at) => days.spans[at] + days.logs[at])
    const top = everyDay.reduce((best, value, at) => (value > (everyDay[best] ?? 0) ? at : best), 0)
    tiles = [
      { key: 'spend', label: 'Ingested to date', value: bytes(bytesOf(used)), sub: against(bytesOf(used), before ? bytesOf(prior) : null) },
      { key: 'projected', label: running ? 'Projected at month end' : 'Month total', value: bytes(projectedVolume(bytesOf(used), from, to, now)), sub: renews },
      { key: 'metrics', label: 'Metric datapoints', value: count(used.metrics), sub: running ? `about ${count(projectedOf('metrics'))} at month end` : 'month closed' },
      { key: 'busiest', label: 'Busiest day', value: bytes(everyDay[top] ?? 0), sub: (everyDay[top] ?? 0) > 0 ? dayLabel(from + top * DAY) : 'nothing yet' },
    ]
  }

  return {
    priced: pricing !== null,
    single,
    currency,
    from,
    slots,
    last,
    shown,
    tiles,
    actual,
    ahead,
    slices,
    total: slices.reduce((sum, slice) => sum + slice.value, 0),
    bars,
    quotas: pricing && single ? [] : quotasOf(used, bill, from, to, now),
    format: pricing ? money : bytes,
    axis: pricing ? (value) => axisMoney(value, pricing.currency) : bytes,
  }
}

export function rowsOf({ metered, before, signal, from, to, now }: { metered: Metered; before: Metered | undefined; signal: Signal | typeof ALL; from: number; to: number; now: number }): Row[] {
  const pricing = metered.pricing ?? null
  const slots = slotsOf(from, to)
  const last = lastDayOf(from, to, now)
  const picked = signal === ALL ? shownFor(pricing) : [signal]
  const measure = measureFor(pricing, false)
  return projectsOf(metered).map((row) => {
    const key = projectKey(row)
    const volumes = totalsOf(metered, key)
    const days = daysOf(metered, key, from, slots)
    const per = picked.map((one) => levelsOf(days[one], (volume) => measure(one, volume), last, slots, null))
    const levels = Array.from({ length: Math.max(0, last + 1) }, (_, at) => per.reduce((sum, one) => sum + (one[at] ?? 0), 0))
    const figure = sumOf(volumes, picked, measure)
    return {
      key,
      name: projectName(row),
      volumes,
      figure,
      days: steps(levels, last),
      change: percentChange(figure, before ? sumOf(totalsOf(before, key), picked, measure) : null),
    }
  })
}
