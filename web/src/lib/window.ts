import { useNavigate as useRouterNavigate } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'
import { useSearchParam } from './router'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

export const WINDOWS = [
  { key: '15m', label: '15 minutes', short: '15 m', ms: 15 * MINUTE },
  { key: '1h', label: '1 hour', short: '1 h', ms: HOUR },
  { key: '6h', label: '6 hours', short: '6 h', ms: 6 * HOUR },
  { key: '24h', label: '24 hours', short: '24 h', ms: 24 * HOUR },
  { key: '7d', label: '7 days', short: '7 d', ms: 7 * 24 * HOUR },
] as const

export type Window = (typeof WINDOWS)[number]

export const DEFAULT_WINDOW: Window = WINDOWS[1]

export const windowOf = (key: unknown): Window => WINDOWS.find((w) => w.key === key) ?? DEFAULT_WINDOW

function unzoomed(f: unknown): string | undefined {
  if (typeof f !== 'string') return undefined
  const p = new URLSearchParams(f)
  p.delete('from')
  p.delete('to')
  p.delete('range')
  return p.toString() || undefined
}

export function openingWindow(lastSeenMs: number | null, now: number): Window['key'] | null {
  if (lastSeenMs === null) return null
  return WINDOWS.find((w) => w.ms > DEFAULT_WINDOW.ms && now - lastSeenMs <= w.ms)?.key ?? null
}

let opening: Window | null = null
let settled = false
const listeners = new Set<() => void>()

function settle(next: Window | null) {
  settled = true
  if (next === opening) return
  opening = next
  for (const listener of listeners) listener()
}

export function openOn(key: Window['key'] | null) {
  if (!settled) settle(key ? windowOf(key) : null)
}

function useOpening(): Window | null {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify)
      return () => listeners.delete(notify)
    },
    () => opening,
    () => null,
  )
}

export function useWindow(): Window & { choose: (key: Window['key']) => void } {
  const asked = useSearchParam('window')
  const opened = useOpening()
  const current = asked === undefined ? (opened ?? DEFAULT_WINDOW) : windowOf(asked)
  const navigate = useRouterNavigate()
  const choose = (key: Window['key']) => {
    settle(null)
    void navigate({
      to: '.' as never,
      search: ((was: Record<string, unknown>) => ({ ...was, f: unzoomed(was.f), from: undefined, to: undefined, window: key === DEFAULT_WINDOW.key ? undefined : key })) as never,
      replace: true,
    })
  }
  return { ...current, choose }
}
