export type Span = { from_ms: number; to_ms: number }

export type Placed<T extends Span> = T & { left: number; width: number }

export const DAY_MS = 86_400_000

export const startOfDay = (ms: number) => {
  const day = new Date(ms)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

export const days = (fromMs: number, count: number) => Array.from({ length: count }, (_, at) => {
  const day = new Date(fromMs)
  day.setDate(day.getDate() + at)
  return day.getTime()
})

export function place<T extends Span>(spans: T[], fromMs: number, toMs: number): Placed<T>[] {
  const whole = Math.max(1, toMs - fromMs)
  return spans
    .filter((span) => span.to_ms > fromMs && span.from_ms < toMs)
    .map((span) => {
      const start = Math.max(span.from_ms, fromMs)
      const end = Math.min(span.to_ms, toMs)
      return { ...span, left: (start - fromMs) / whole, width: (end - start) / whole }
    })
}

export function gaps(spans: Span[], fromMs: number, toMs: number): Span[] {
  const sorted = [...spans].filter((span) => span.to_ms > fromMs && span.from_ms < toMs).sort((a, b) => a.from_ms - b.from_ms)
  const found: Span[] = []
  let at = fromMs
  for (const span of sorted) {
    if (span.from_ms > at) found.push({ from_ms: at, to_ms: Math.min(span.from_ms, toMs) })
    at = Math.max(at, span.to_ms)
  }
  if (at < toMs) found.push({ from_ms: at, to_ms: toMs })
  return found
}
