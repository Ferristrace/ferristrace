import type { Legend as Position } from '@/data/dashboards'
import { cn } from '@/lib/utils'

export type LegendItem = { key: string; colour: string; hidden?: boolean; detail?: string }

export function Legend({ items, position, onToggle, active }: { items: LegendItem[]; position: Position; onToggle?: (key: string) => void; active?: string | null }) {
  if (position === 'hidden' || items.length === 0) return null
  return (
    <ul
      aria-label={onToggle ? 'Legend, select a series to hide or show it' : 'Legend'}
      data-legend={position}
      className={cn('m-0 flex list-none gap-1 overflow-auto p-0', 'max-h-[72px] flex-wrap', position === 'right' && 'md:max-h-full md:w-[160px] md:shrink-0 md:flex-col md:flex-nowrap')}
    >
      {items.map((item, index) => {
        const body = (
          <>
            <span className="size-2 shrink-0 rounded-full" style={{ background: item.colour }} aria-hidden />
            <span className="truncate">{item.key}</span>
            {item.detail ? <span className="ml-auto pl-1 text-muted-foreground">{item.detail}</span> : null}
          </>
        )
        const cls = cn('inline-flex w-full max-w-[260px] items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-caption', item.hidden && 'opacity-45', active === item.key && 'bg-muted')
        return (
          <li key={`${index}-${item.key}`} className="min-w-0">
            {onToggle ? (
              <button type="button" aria-pressed={!item.hidden} onClick={() => onToggle(item.key)} className={cn(cls, 'cursor-pointer hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring')}>{body}</button>
            ) : (
              <span className={cls}>{body}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
