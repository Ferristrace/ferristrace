export const DURATION_MIN = 60

export const DURATION_MAX = 31 * 86_400

const UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 }

export function parseDuration(text: string): number | null {
  const trimmed = text.trim().toLowerCase()
  if (!/^(\d+\s*[smhd]\s*)+$/.test(trimmed)) return null
  let total = 0
  for (const [, count, unit] of trimmed.matchAll(/(\d+)\s*([smhd])/g)) total += Number(count) * UNIT[unit]
  return total
}

export function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} d`
  if (seconds % 3600 === 0) return `${seconds / 3600} h`
  if (seconds % 60 === 0) return `${seconds / 60} m`
  return `${seconds} s`
}

export function durationIssue(seconds: number): string | null {
  if (!Number.isInteger(seconds)) return 'The default duration is a whole number of seconds.'
  if (seconds < DURATION_MIN) return 'The default duration is at least one minute.'
  if (seconds > DURATION_MAX) return 'The default duration is at most 31 days.'
  return null
}

export const DURATION_PRESETS: { label: string; seconds: number }[] = [
  { label: '15 minutes', seconds: 900 },
  { label: '1 hour', seconds: 3600 },
  { label: '6 hours', seconds: 21_600 },
  { label: '24 hours', seconds: 86_400 },
  { label: '7 days', seconds: 604_800 },
  { label: '30 days', seconds: 2_592_000 },
]
