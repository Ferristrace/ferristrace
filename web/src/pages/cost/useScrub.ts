import { useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react'

export function useScrub(count: number, kind: 'point' | 'band') {
  const [at, setAt] = useState<number | null>(null)
  const index = (fraction: number) => {
    const clamped = Math.min(1, Math.max(0, fraction))
    return kind === 'point' ? Math.round(clamped * Math.max(0, count - 1)) : Math.min(count - 1, Math.floor(clamped * count))
  }
  const handlers = {
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const box = event.currentTarget.getBoundingClientRect()
      if (count > 0 && box.width > 0) setAt(index((event.clientX - box.left) / box.width))
    },
    onPointerLeave: () => setAt(null),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (event.target === event.currentTarget) setAt(null)
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (count === 0) return
      const last = count - 1
      if (event.key === 'Escape') return setAt(null)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === 'ArrowRight' ? Math.min(last, (at ?? -1) + 1) : event.key === 'ArrowLeft' ? Math.max(0, at === null ? last : at - 1) : null
      if (next === null) return
      event.preventDefault()
      setAt(next)
    },
  }
  return { at: at !== null && at < count ? at : null, handlers }
}
