import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Legend as Position } from '@/data/dashboards'
import { cn } from '@/lib/utils'

export type LegendItem = { key: string; colour: string; hidden?: boolean; detail?: string }

export const LEGEND_CAP = 12

export const moreText = (hidden: number): string => `and ${hidden} more`

export const capped = <T,>(items: T[], cap = LEGEND_CAP): { shown: T[]; hidden: T[] } => ({ shown: items.slice(0, cap), hidden: items.slice(cap) })

export function Legend({ items, position, onToggle, active }: { items: LegendItem[]; position: Position; onToggle?: (key: string) => void; active?: string | null }) {
  const list = useRef<HTMLUListElement>(null)
  const [fit, setFit] = useState<number | null>(null)
  const stacked = position === 'right'
  const signature = items.map((item) => item.key).join('\u0000')

  useLayoutEffect(() => {
    setFit(null)
  }, [signature])

  useEffect(() => {
    const node = list.current
    if (!node || typeof ResizeObserver === 'undefined') return
    let width = node.clientWidth
    const watch = new ResizeObserver(() => {
      if (node.clientWidth === width) return
      width = node.clientWidth
      setFit(null)
    })
    watch.observe(node)
    return () => watch.disconnect()
  }, [])

  useLayoutEffect(() => {
    const node = list.current
    if (!node || stacked || fit !== null) return
    const rows = [...node.querySelectorAll<HTMLElement>('li[data-item]')]
    if (rows.length === 0) return
    const first = rows[0].offsetTop
    const lineHeight = rows[0].offsetHeight
    const inside = rows.filter((row) => row.offsetTop < first + lineHeight * 2 - 1).length
    setFit(inside < rows.length ? Math.max(1, inside - 1) : rows.length)
  })

  if (position === 'hidden' || items.length === 0) return null
  const cap = stacked ? items.length : Math.min(LEGEND_CAP, fit ?? LEGEND_CAP)
  const { shown, hidden } = capped(items, cap)
  return (
    <ul
      ref={list}
      aria-label={onToggle ? 'Legend, select a series to hide or show it' : 'Legend'}
      data-legend={position}
      className={cn('m-0 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 text-caption', stacked && 'max-h-full overflow-auto md:w-[160px] md:shrink-0 md:flex-col md:flex-nowrap')}
    >
      {shown.map((item, index) => {
        const body = (
          <>
            <span className="size-2 shrink-0 rounded-full" style={{ background: item.colour }} aria-hidden />
            <span className={cn('truncate', active === item.key && 'font-semibold text-foreground')}>{item.key}</span>
            {item.detail ? <span className="ml-auto pl-1 font-mono tabular-nums">{item.detail}</span> : null}
          </>
        )
        const cls = cn('inline-flex max-w-[260px] items-center gap-1.5 text-muted-foreground', item.hidden && 'line-through opacity-60')
        return (
          <li key={`${index}-${item.key}`} data-item className="min-w-0">
            {onToggle ? (
              <button type="button" aria-pressed={!item.hidden} onClick={() => onToggle(item.key)} className={cn(cls, 'cursor-pointer rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring')}>{body}</button>
            ) : (
              <span className={cls}>{body}</span>
            )}
          </li>
        )
      })}
      {hidden.length > 0 ? (
        <li className="min-w-0 text-faint-foreground">
          <span title={items.map((item) => item.key).join(', ')} aria-label={`${moreText(hidden.length)}: ${hidden.map((item) => item.key).join(', ')}`}>{moreText(hidden.length)}</span>
        </li>
      ) : null}
    </ul>
  )
}
