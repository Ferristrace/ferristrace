import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils'
import { Filled, PanelEmpty } from './Empty'
import { arcPath, colourOf, formatValue, pieItems, pieSlices } from './geometry'
import { Legend } from './Legend'
import { useHoverPin } from './Tooltip'
import type { Of, PanelProps } from './types'

const SIZE = 100
const OUTER = 46
const INNER = 30

type Anchor = { x: number; y: number }

export function PiePanel({ panel, result, drill }: PanelProps<Of<'rows'>>) {
  const { options } = panel
  const slices = useMemo(() => pieSlices(pieItems(result.columns, result.rows)), [result])
  const { setHover, leave, shown } = useHoverPin<number>(result)
  const frame = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<Anchor>({ x: 0, y: 0 })
  if (slices.length === 0) return <PanelEmpty />
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const legend = options.legend ?? 'right'
  const caption = options.content?.trim() ?? ''
  const totalText = formatValue(total, options.unit, options.decimals)
  const share = (value: number) => `${((value / total) * 100).toFixed(1)}%`
  const open = (at: number) => {
    const slice = slices[at]
    if (slice && !slice.other && drill) drill(slice.labels, null)
  }
  const place = (event: ReactPointerEvent<SVGPathElement>) => {
    const box = frame.current?.getBoundingClientRect()
    if (box) setAnchor({ x: event.clientX - box.left, y: event.clientY - box.top })
  }
  const settle = (target: SVGPathElement) => {
    const box = frame.current?.getBoundingClientRect()
    const rect = target.getBoundingClientRect()
    if (box) setAnchor({ x: rect.left + rect.width / 2 - box.left, y: rect.top + rect.height / 2 - box.top })
  }
  const slice = shown === null ? null : slices[shown]
  const width = frame.current?.clientWidth ?? 0
  const flip = anchor.x > width * 0.6
  return (
    <Filled className={cn('gap-2', legend === 'right' && 'md:flex-row md:items-center')}>
      <div ref={frame} className="relative flex min-h-[96px] min-w-0 flex-1 items-center justify-center self-stretch [container-type:size]" onPointerLeave={leave}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label={`Pie chart of ${panel.title || 'a panel'}, ${slices.length} slices, total ${totalText}${caption ? ` ${caption}` : ''}`} className="max-h-full max-w-full" style={{ aspectRatio: '1', height: '100%' }}>
          {slices.map((item, at) => (
            <path
              key={item.label}
              d={arcPath(SIZE / 2, SIZE / 2, OUTER, INNER, item.start, item.end)}
              fillRule="evenodd"
              fill={colourOf(at)}
              fillOpacity={shown === null || shown === at ? 1 : 0.5}
              stroke="var(--card)"
              strokeWidth="0.8"
              tabIndex={0}
              role="button"
              aria-label={`${item.label}, ${formatValue(item.value, options.unit, options.decimals)}, ${share(item.value)}`}
              className={cn('outline-none focus-visible:stroke-foreground', drill && !item.other && 'cursor-pointer')}
              onPointerEnter={(event) => { setHover(at); place(event) }}
              onPointerMove={place}
              onPointerLeave={leave}
              onFocus={(event) => {
                if (!event.currentTarget.matches(':focus-visible')) return
                setHover(at)
                settle(event.currentTarget)
              }}
              onBlur={leave}
              onClick={() => open(at)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  open(at)
                }
              }}
            />
          ))}
        </svg>
        <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[0.4cqmin] text-center">
          <span className="max-w-[52cqmin] truncate font-mono font-semibold leading-none" style={{ fontSize: 'clamp(11px, 9cqmin, 30px)' }}>{totalText}</span>
          {caption ? <span className="max-w-[52cqmin] truncate text-muted-foreground" style={{ fontSize: 'clamp(9px, 5.5cqmin, 13px)' }}>{caption}</span> : null}
        </div>
        {slice ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 flex min-w-[140px] max-w-[260px] flex-col gap-0.5 rounded-md border bg-popover px-2 py-1.5 text-caption text-popover-foreground shadow-md"
            style={{ left: anchor.x, top: anchor.y, transform: `translate(${flip ? 'calc(-100% - 12px)' : '12px'}, 12px)` }}
          >
            <span className="flex items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-full" style={{ background: colourOf(shown ?? 0) }} aria-hidden />
              <span className="truncate font-mono font-semibold">{slice.label}</span>
            </span>
            <span className="flex items-baseline gap-2 font-mono">
              <span className="font-semibold">{formatValue(slice.value, options.unit, options.decimals)}</span>
              <span className="text-muted-foreground">{share(slice.value)} of {totalText}</span>
            </span>
            {drill && !slice.other ? <span className="border-t border-dashed pt-1 text-faint-foreground">Click to drilldown</span> : null}
          </div>
        ) : null}
      </div>
      <Legend items={slices.map((item, at) => ({ key: item.label, colour: colourOf(at), detail: share(item.value) }))} position={legend} active={slice?.label ?? null} />
    </Filled>
  )
}
