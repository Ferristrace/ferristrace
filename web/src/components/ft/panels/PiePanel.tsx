import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Filled, PanelEmpty } from './Empty'
import { arcPath, colourOf, formatValue, pieItems, pieSlices, type TooltipRow } from './geometry'
import { Legend } from './Legend'
import { SeriesTooltip, useHoverPin } from './Tooltip'
import type { Of, PanelProps } from './types'

const SIZE = 100
const OUTER = 46
const INNER = 28

export function PiePanel({ panel, result, drill }: PanelProps<Of<'rows'>>) {
  const { options } = panel
  const slices = useMemo(() => pieSlices(pieItems(result.columns, result.rows)), [result])
  const { setHover, leave, pinned, unpin, shown } = useHoverPin<number>(result)
  if (slices.length === 0) return <PanelEmpty />
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const legend = options.legend ?? 'right'
  const rows: TooltipRow[] = slices.map((slice, at) => ({ key: slice.label, colour: colourOf(at), value: slice.value, at, nearest: at === shown }))
  const share = (value: number) => `${((value / total) * 100).toFixed(1)}%`
  const open = (at: number) => {
    const slice = slices[at]
    if (slice && !slice.other && drill) drill(slice.labels, null)
  }
  return (
    <Filled className={cn('gap-2', legend === 'right' && 'md:flex-row md:items-center')}>
      <div className="relative flex min-h-[96px] min-w-0 flex-1 items-center justify-center self-stretch" onPointerLeave={leave}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label={`Pie chart of ${panel.title || 'a panel'}, ${slices.length} slices`} className="max-h-full max-w-full" style={{ aspectRatio: '1', height: '100%' }}>
          {slices.map((slice, at) => (
            <path
              key={slice.label}
              d={arcPath(SIZE / 2, SIZE / 2, OUTER, INNER, slice.start, slice.end)}
              fillRule="evenodd"
              fill={colourOf(at)}
              fillOpacity={shown === null || shown === at ? 1 : 0.55}
              stroke="var(--card)"
              strokeWidth="0.8"
              tabIndex={0}
              role="button"
              aria-label={`${slice.label}, ${formatValue(slice.value, options.unit, options.decimals)}, ${share(slice.value)}`}
              className={cn('outline-none focus-visible:stroke-foreground', drill && !slice.other && 'cursor-pointer')}
              onPointerEnter={() => setHover(at)}
              onFocus={() => setHover(at)}
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
        {shown !== null ? (
          <SeriesTooltip
            header={`Total ${formatValue(total, options.unit, options.decimals)}`}
            rows={rows}
            format={(row) => `${formatValue(row.value ?? 0, options.unit, options.decimals)} · ${share(row.value ?? 0)}`}
            pinned={pinned !== null}
            drillable={drill !== undefined}
            onOpen={(row) => open(row.at)}
            className="left-1 top-1"
          />
        ) : null}
        {pinned !== null ? <button type="button" onClick={unpin} className="absolute bottom-1 right-1 rounded-sm border bg-background px-1.5 text-caption text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">Unpin</button> : null}
      </div>
      <Legend items={slices.map((slice, at) => ({ key: slice.label, colour: colourOf(at), detail: share(slice.value) }))} position={legend} active={shown === null ? null : slices[shown]?.label} />
    </Filled>
  )
}
