import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import type { TooltipRow } from './geometry'

const SHOWN_ROWS = 12

const TYPED = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'])

export const ignoresShortcut = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || TYPED.has(target.tagName) || target.closest('a,button,input,select,textarea') !== null)

export function useHoverPin<T>(resetKey?: unknown) {
  const [hover, setHover] = useState<T | null>(null)
  const [pinned, setPinned] = useState<T | null>(null)
  const held = useRef({ hover, pinned })
  held.current = { hover, pinned }

  useEffect(() => {
    setPinned(null)
    setHover(null)
  }, [resetKey])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (held.current.hover === null && held.current.pinned === null) return
      if (event.ctrlKey || event.metaKey || event.altKey || ignoresShortcut(event.target)) return
      if (event.key === 'Escape') setPinned(null)
      if (event.key.toLowerCase() !== 'p') return
      event.preventDefault()
      setPinned(held.current.pinned !== null ? null : held.current.hover)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const leave = useCallback(() => setHover(null), [])
  const unpin = useCallback(() => setPinned(null), [])
  return { hover, setHover, leave, pinned, unpin, shown: pinned ?? hover }
}

export function SeriesTooltip({ header, rows, format, pinned, drillable, onOpen, style, className }: {
  header: string
  rows: TooltipRow[]
  format: (row: TooltipRow) => string
  pinned: boolean
  drillable: boolean
  onOpen?: (row: TooltipRow) => void
  style?: CSSProperties
  className?: string
}) {
  const shown = rows.slice(0, SHOWN_ROWS)
  const hidden = rows.length - shown.length
  return (
    <div
      role="tooltip"
      className={cn('absolute top-0 z-10 flex min-w-[160px] max-w-[320px] flex-col gap-0.5 rounded-md border bg-popover px-2 py-1.5 text-caption text-popover-foreground shadow-md', pinned ? 'pointer-events-auto' : 'pointer-events-none', className)}
      style={style}
    >
      <span className="font-mono text-muted-foreground">{header}</span>
      {shown.map((row, index) => {
        const body = (
          <>
            <span className="size-2 shrink-0 rounded-full" style={{ background: row.colour }} aria-hidden />
            <span className={cn('truncate font-mono', row.nearest && 'font-semibold')}>{row.key}</span>
            <span className="ml-auto pl-2 font-mono font-semibold">{format(row)}</span>
          </>
        )
        const cls = cn('flex items-center gap-1.5 rounded-sm px-1 py-px', row.nearest && 'bg-muted')
        return pinned && drillable && onOpen ? (
          <button key={`${index}-${row.key}`} type="button" onClick={() => onOpen(row)} className={cn(cls, 'cursor-pointer text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring')} aria-label={`Open ${row.key} in the explorer`}>
            {body}
          </button>
        ) : (
          <span key={`${index}-${row.key}`} className={cls} aria-current={row.nearest || undefined}>{body}</span>
        )
      })}
      {hidden > 0 ? <span className="px-1 text-faint-foreground">and {hidden} more</span> : null}
      <span className="mt-0.5 border-t border-dashed pt-1 text-faint-foreground">
        {drillable ? 'Click to drilldown · ' : ''}
        {pinned ? 'Pinned, press P to unpin' : 'Press P to pin'}
      </span>
    </div>
  )
}
