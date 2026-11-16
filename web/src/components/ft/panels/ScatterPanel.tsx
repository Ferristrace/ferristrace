import { useMemo, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'
import { Filled, PanelEmpty } from './Empty'
import { MAX_DOTS, axisValue, capPoints, formatValue, scatterDots, scatterFrame, type TooltipRow } from './geometry'
import { Legend } from './Legend'
import { aggLabel, labelOf } from './result'
import { SeriesTooltip, useHoverPin } from './Tooltip'
import type { Of, PanelProps } from './types'

const TABLE_ROWS = 50

export function ScatterPanel({ panel, result, drill }: PanelProps<Of<'pairs'>>) {
  const { options } = panel
  const total = result.points.length
  const kept = useMemo(() => capPoints(result.points, MAX_DOTS), [result])
  const frame = useMemo(() => scatterFrame(kept), [kept])
  const dots = useMemo(() => scatterDots(kept, frame, labelOf), [kept, frame])
  const { setHover, leave, pinned, unpin, shown } = useHoverPin<number>(result)
  if (total === 0) return <PanelEmpty />
  const aggregations = panel.queries[0]?.aggregations ?? []
  const xName = aggLabel(aggregations[0])
  const yName = aggLabel(aggregations[1])
  const groups = [...new Map(dots.map((dot) => [dot.group, dot.colour])).entries()]
  const hovered = shown === null ? null : (dots[shown] ?? null)
  const rows: TooltipRow[] = hovered
    ? [
        { key: xName, colour: hovered.colour, value: hovered.raw.x, at: 0, nearest: false },
        { key: yName, colour: hovered.colour, value: hovered.raw.y, at: 1, nearest: false },
      ]
    : []
  const legend = options.legend ?? 'bottom'
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setHover((current) => Math.min(dots.length - 1, Math.max(0, (current ?? (event.key === 'ArrowRight' ? -1 : dots.length)) + (event.key === 'ArrowRight' ? 1 : -1))))
    } else if (event.key === 'Enter' && hovered) {
      event.preventDefault()
      drill?.(hovered.labels, null)
    } else if (event.key === 'Escape') {
      leave()
    }
  }
  return (
    <Filled className={cn('gap-2', legend === 'right' && 'md:flex-row')}>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[44px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-x-1.5 gap-y-1">
        <div className="flex flex-col justify-between text-right font-mono text-[10px] leading-3 text-faint-foreground" aria-hidden>
          <span>{axisValue(frame.yHi)}</span>
          <span>{axisValue((frame.yHi + frame.yLo) / 2)}</span>
          <span>{axisValue(frame.yLo)}</span>
        </div>
        <div
          role="group"
          tabIndex={0}
          aria-label={`Scatter chart of ${panel.title || 'a panel'}, ${total} points, x is ${xName}, y is ${yName}. Arrow keys move between points, Enter opens the explorer.`}
          className="relative min-h-[96px] border-b border-l focus-visible:outline-2 focus-visible:outline-ring"
          onPointerLeave={leave}
          onKeyDown={onKeyDown}
          onBlur={(event) => { if (event.target === event.currentTarget) leave() }}
        >
          {dots.map((dot, at) => (
            <span
              key={at}
              aria-hidden
              className={cn('absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background', drill ? 'cursor-pointer' : 'cursor-default', shown === at && 'size-3.5')}
              style={{ left: `${dot.x * 100}%`, top: `${dot.y * 100}%`, background: dot.colour, opacity: shown === null || shown === at ? 0.9 : 0.5 }}
              onPointerEnter={() => setHover(at)}
              onClick={() => drill?.(dot.labels, null)}
            />
          ))}
          {hovered ? (
            <SeriesTooltip
              header={hovered.group}
              rows={rows}
              format={(row) => formatValue(row.value ?? 0, row.at === 1 ? options.unit : '', options.decimals)}
              pinned={pinned !== null}
              drillable={drill !== undefined}
              className={cn('top-1', hovered.x > 0.5 ? 'left-1' : 'right-1')}
            />
          ) : null}
          {pinned !== null ? <button type="button" onClick={unpin} className="absolute bottom-1 right-1 rounded-sm border bg-background px-1.5 text-caption text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">Unpin</button> : null}
          <table className="sr-only">
            <caption>{`First ${Math.min(TABLE_ROWS, total)} of ${total} points`}</caption>
            <thead><tr><th>Group</th><th>{xName}</th><th>{yName}</th></tr></thead>
            <tbody>
              {result.points.slice(0, TABLE_ROWS).map((point, index) => <tr key={index}><td>{labelOf(point.group)}</td><td>{point.x}</td><td>{point.y}</td></tr>)}
            </tbody>
          </table>
        </div>
        <span />
        <div className="flex justify-between font-mono text-[10px] text-faint-foreground" aria-hidden>
          <span>{axisValue(frame.xLo)}</span>
          <span>x: {xName} · y: {yName}</span>
          <span>{axisValue(frame.xHi)}</span>
        </div>
      </div>
      {total > kept.length ? <p role="status" className="m-0 text-caption text-muted-foreground">Showing {kept.length.toLocaleString('en-US')} of {total.toLocaleString('en-US')} points.</p> : null}
      <Legend items={groups.map(([key, colour]) => ({ key, colour }))} position={legend} active={hovered?.group ?? null} />
    </Filled>
  )
}
