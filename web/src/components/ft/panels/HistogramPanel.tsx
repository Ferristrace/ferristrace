import { useMemo } from 'react'
import { Filled, PanelEmpty } from './Empty'
import { axisValue, formatValue, isScaledUnit, histogramBars, maxOf, minOf, type TooltipRow } from './geometry'
import { isEmpty } from './result'
import { SeriesTooltip, useHoverPin } from './Tooltip'
import type { Of, PanelProps } from './types'

export function HistogramPanel({ panel, result }: PanelProps<Of<'buckets'>>) {
  const { options } = panel
  const { bars, peak } = useMemo(() => histogramBars(result.buckets), [result])
  const { setHover, leave, pinned, unpin, shown } = useHoverPin<number>(result)
  if (isEmpty(result)) return <PanelEmpty />
  const bar = shown === null ? null : bars[shown]
  const range = (from: number, to: number) => `${formatValue(from, '', options.decimals)} to ${formatValue(to, options.unit, options.decimals)}`
  const rows: TooltipRow[] = bar ? [{ key: 'count', colour: 'var(--series)', value: bar.count, at: 0, nearest: true }] : []
  const lo = minOf(result.buckets.map((one) => one.from))
  const hi = maxOf(result.buckets.map((one) => one.to))
  return (
    <Filled className="gap-1">
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[44px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-x-1.5 gap-y-1">
        <div className="flex flex-col justify-between text-right font-mono text-[10px] leading-3 text-faint-foreground" aria-hidden>
          <span>{axisValue(peak)}</span>
          <span>{axisValue(peak / 2)}</span>
          <span>0</span>
        </div>
        <div role="group" aria-label={`Histogram of ${panel.title || 'a panel'}, ${bars.length} buckets, peak ${peak}`} className="relative min-h-[96px] border-b" onPointerLeave={leave}>
          {bars.map((one, at) => (
            <button
              key={at}
              type="button"
              aria-label={`${range(one.from, one.to)}: ${one.count}`}
              className="absolute bottom-0 flex cursor-default items-end border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-ring"
              style={{ left: `${one.x0 * 100}%`, width: `${(one.x1 - one.x0) * 100}%`, height: '100%' }}
              onPointerEnter={() => setHover(at)}
              onFocus={() => setHover(at)}
              onBlur={leave}
            >
              <span className="block w-full rounded-t-[3px] bg-series" style={{ height: `${Math.max(one.count > 0 ? 2 : 0, one.height * 100)}%`, opacity: shown === null || shown === at ? 1 : 0.6, marginInline: '1px' }} />
            </button>
          ))}
          {bar ? (
            <SeriesTooltip header={range(bar.from, bar.to)} rows={rows} format={(row) => String(row.value)} pinned={pinned !== null} drillable={false} className={bar.x0 > 0.5 ? 'left-1 top-1' : 'right-1 top-1'} />
          ) : null}
          {pinned !== null ? <button type="button" onClick={unpin} className="absolute bottom-1 right-1 rounded-sm border bg-background px-1.5 text-caption text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">Unpin</button> : null}
        </div>
        <span />
        <div className="flex justify-between font-mono text-[10px] text-faint-foreground" aria-hidden>
          <span>{axisValue(lo, options.unit)}</span>
          <span>{isScaledUnit(options.unit) ? '' : (options.unit ?? '')}</span>
          <span>{axisValue(hi, options.unit)}</span>
        </div>
      </div>
    </Filled>
  )
}
