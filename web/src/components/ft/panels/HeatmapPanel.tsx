import { useMemo, type KeyboardEvent, type PointerEvent } from 'react'
import { Filled, PanelEmpty } from './Empty'
import { axisTime, axisValue, clockOf, formatValue, heatCells, topCells, type TooltipRow } from './geometry'
import { isEmpty } from './result'
import { SeriesTooltip, useHoverPin } from './Tooltip'
import type { Of, PanelProps } from './types'

const WIDTH = 600
const HEIGHT = 200

type Spot = { xi: number; yi: number }

export function HeatmapPanel({ panel, result }: PanelProps<Of<'heat'>>) {
  const { options } = panel
  const { cells, peak } = useMemo(() => heatCells(result.x, result.y, result.cells), [result])
  const counts = useMemo(() => new Map(cells.map((cell) => [`${cell.xi}:${cell.yi}`, cell.count])), [cells])
  const { setHover, leave, pinned, unpin, shown } = useHoverPin<Spot>(result)
  if (isEmpty(result)) return <PanelEmpty />
  const columns = result.x.length
  const bands = result.y.length
  const spanNs = columns > 1 ? result.x[columns - 1] - result.x[0] : 0
  const stepNs = columns > 1 ? spanNs / (columns - 1) : 0
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return
    const xi = Math.min(columns - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * columns)))
    const yi = Math.min(bands - 1, Math.max(0, Math.floor((1 - (event.clientY - box.top) / box.height) * bands)))
    setHover((current) => (current && current.xi === xi && current.yi === yi ? current : { xi, yi }))
  }
  const spot = shown && shown.xi >= 0 && shown.xi < columns && shown.yi >= 0 && shown.yi < bands ? shown : null
  const band = spot ? result.y[spot.yi] : null
  const rows: TooltipRow[] = spot ? [{ key: 'count', colour: 'var(--series)', value: counts.get(`${spot.xi}:${spot.yi}`) ?? 0, at: 0, nearest: true }] : []
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const step: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
    const move = step[event.key]
    if (move) {
      event.preventDefault()
      const from = spot ?? { xi: 0, yi: 0 }
      setHover({ xi: Math.min(columns - 1, Math.max(0, from.xi + (spot ? move[0] : 0))), yi: Math.min(bands - 1, Math.max(0, from.yi + (spot ? move[1] : 0))) })
    } else if (event.key === 'Escape') leave()
  }
  const busiest = topCells(cells, 10)
  const lo = result.y[0].from
  const hi = result.y[bands - 1].to
  return (
    <Filled className="gap-1">
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[44px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-x-1.5 gap-y-1">
        <div className="flex flex-col justify-between text-right font-mono text-[10px] leading-3 text-faint-foreground" aria-hidden>
          <span>{axisValue(hi, options.unit)}</span>
          <span>{axisValue((hi + lo) / 2, options.unit)}</span>
          <span>{axisValue(lo, options.unit)}</span>
        </div>
        <div role="group" tabIndex={0} aria-label={`Heatmap of ${panel.title || 'a panel'}, ${columns} columns by ${bands} bands, peak ${peak}. Arrow keys move between cells.`} className="relative min-h-[96px] border-b border-l focus-visible:outline-2 focus-visible:outline-ring" onPointerMove={move} onPointerLeave={leave} onKeyDown={onKeyDown} onBlur={(event) => { if (event.target === event.currentTarget) leave() }}>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden className="absolute inset-0 block size-full">
            {cells.map((cell) => (
              <rect key={`${cell.xi}-${cell.yi}`} x={cell.x0 * WIDTH} y={cell.y0 * HEIGHT} width={(cell.x1 - cell.x0) * WIDTH + 0.4} height={(cell.y1 - cell.y0) * HEIGHT + 0.4} fill="var(--series)" fillOpacity={0.1 + 0.9 * Math.sqrt(cell.intensity)} />
            ))}
            {spot ? <rect x={(spot.xi / columns) * WIDTH} y={(1 - (spot.yi + 1) / bands) * HEIGHT} width={WIDTH / columns} height={HEIGHT / bands} fill="none" stroke="var(--foreground)" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          {spot && band ? (
            <SeriesTooltip
              header={`${clockOf(result.x[spot.xi])} · ${formatValue(band.from, '', options.decimals)} to ${formatValue(band.to, options.unit, options.decimals)}`}
              rows={rows}
              format={(row) => String(row.value)}
              pinned={pinned !== null}
              drillable={false}
              className={spot.xi / columns > 0.5 ? 'left-1 top-1' : 'right-1 top-1'}
            />
          ) : null}
          <table className="sr-only">
            <caption>Busiest cells</caption>
            <thead><tr><th>Time</th><th>From</th><th>To</th><th>Count</th></tr></thead>
            <tbody>
              {busiest.map((cell) => <tr key={`${cell.xi}-${cell.yi}`}><td>{clockOf(result.x[cell.xi])}</td><td>{result.y[cell.yi].from}</td><td>{result.y[cell.yi].to}</td><td>{cell.count}</td></tr>)}
            </tbody>
          </table>
          {pinned !== null ? <button type="button" onClick={unpin} className="absolute bottom-1 right-1 rounded-sm border bg-background px-1.5 text-caption text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">Unpin</button> : null}
        </div>
        <span />
        <div className="flex justify-between font-mono text-[10px] text-faint-foreground" aria-hidden>
          <span>{axisTime(result.x[0], spanNs)}</span>
          <span>{options.unit ?? ''}</span>
          <span>{axisTime(result.x[columns - 1] + stepNs, spanNs)}</span>
        </div>
      </div>
    </Filled>
  )
}
