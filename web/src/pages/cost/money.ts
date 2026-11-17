import type { Bill, Pricing, Signal } from '@/data/usage'

export const HOUR = 3_600_000

const U64_MAX = (1n << 64n) - 1n

const UNIT: Record<Signal, bigint> = { spans: 1_000_000_000n, logs: 1_000_000_000n, metrics: 1_000_000n }

export const SIGNAL_KEYS: Signal[] = ['spans', 'logs', 'metrics']

export type Volumes = Record<Signal, number>

export const noVolumes = (): Volumes => ({ spans: 0, logs: 0, metrics: 0 })

export const priceOf = (pricing: Pricing, signal: Signal): number =>
  signal === 'spans' ? pricing.spans_gb_micros : signal === 'logs' ? pricing.logs_gb_micros : pricing.metrics_million_micros

export const includedOf = (pricing: Pricing, signal: Signal): number =>
  signal === 'spans' ? pricing.included.spans_bytes : signal === 'logs' ? pricing.included.logs_bytes : pricing.included.metrics_points

const whole = (value: number): bigint => (Number.isFinite(value) && value > 0 ? BigInt(Math.round(value)) : 0n)

export function microsOf(volume: number, price: number, unit: bigint): number {
  const rounded = (whole(volume) * whole(price) * 2n + unit) / (unit * 2n)
  return Number(rounded > U64_MAX ? U64_MAX : rounded)
}

export const valueMicros = (pricing: Pricing, signal: Signal, used: number): number => microsOf(used, priceOf(pricing, signal), UNIT[signal])

export const billableMicros = (pricing: Pricing, signal: Signal, used: number): number =>
  valueMicros(pricing, signal, Math.max(0, used - includedOf(pricing, signal)))

export function projectedVolume(used: number, from: number, to: number, now: number): number {
  if (!(now >= from && now < to) || !(used > 0)) return used
  const elapsed = BigInt(Math.max(Math.round(now - from), HOUR))
  return Number((whole(used) * BigInt(Math.round(to - from)) * 2n + elapsed) / (elapsed * 2n))
}

export function passesAt(used: number, included: number, from: number, to: number, now: number): number | null {
  if (!(now >= from && now < to) || !(used > 0) || !(included > 0)) return null
  const elapsed = BigInt(Math.max(Math.round(now - from), HOUR))
  const at = from + Number((whole(included) * elapsed) / whole(used))
  return at >= from && at < to ? at : null
}

export function billOf(pricing: Pricing, used: Volumes, from: number, to: number, now: number): Bill {
  const bill: Bill = {
    value_micros: 0,
    billable_micros: 0,
    projected_value_micros: 0,
    projected_billable_micros: 0,
    by_signal: {
      spans: { used: 0, included: 0, projected: 0, value_micros: 0, billable_micros: 0, projected_billable_micros: 0, passes_at_ms: null },
      logs: { used: 0, included: 0, projected: 0, value_micros: 0, billable_micros: 0, projected_billable_micros: 0, passes_at_ms: null },
      metrics: { used: 0, included: 0, projected: 0, value_micros: 0, billable_micros: 0, projected_billable_micros: 0, passes_at_ms: null },
    },
  }
  for (const signal of SIGNAL_KEYS) {
    const included = includedOf(pricing, signal)
    const projected = projectedVolume(used[signal], from, to, now)
    const part = {
      used: used[signal],
      included,
      projected,
      value_micros: valueMicros(pricing, signal, used[signal]),
      billable_micros: billableMicros(pricing, signal, used[signal]),
      projected_billable_micros: billableMicros(pricing, signal, projected),
      passes_at_ms: passesAt(used[signal], included, from, to, now),
    }
    bill.by_signal[signal] = part
    bill.value_micros += part.value_micros
    bill.billable_micros += part.billable_micros
    bill.projected_value_micros += valueMicros(pricing, signal, projected)
    bill.projected_billable_micros += part.projected_billable_micros
  }
  return bill
}

export function percentChange(current: number, before: number | null | undefined): number | null {
  if (before === null || before === undefined || !(before > 0)) return null
  return Math.round(((current - before) / before) * 100)
}

export const signed = (percent: number): string => `${percent > 0 ? '+' : percent < 0 ? '-' : ''}${Math.abs(percent)} %`

const formats = new Map<string, Intl.NumberFormat | null>()

function formatOf(currency: string, plain: boolean, compact: boolean): Intl.NumberFormat | null {
  const key = `${currency}:${plain}:${compact}`
  if (!formats.has(key)) {
    try {
      formats.set(key, new Intl.NumberFormat('en-US', { style: 'currency', currency, ...(plain ? { maximumFractionDigits: 0, minimumFractionDigits: 0 } : {}), ...(compact ? { notation: 'compact' } : {}) }))
    } catch {
      formats.set(key, null)
    }
  }
  return formats.get(key) ?? null
}

export function formatMoney(micros: number, currency: string): string {
  const format = formatOf(currency, false, false)
  if (format === null) return `${(Math.max(0, micros) / 1e6).toFixed(2)} ${currency}`
  const digits = Math.min(6, format.resolvedOptions().maximumFractionDigits ?? 2)
  const step = 10n ** BigInt(6 - digits)
  const units = (whole(micros) * 2n + step) / (step * 2n)
  return format.format(Number(units) / 10 ** digits)
}

export function axisMoney(micros: number, currency: string): string {
  const units = Math.max(0, micros) / 1e6
  const format = units === 0 || units >= 10 ? formatOf(currency, true, units >= 10_000) : formatOf(currency, false, false)
  return format === null ? units.toFixed(units >= 10 ? 0 : 2) : format.format(units)
}
