import { useId, useState, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'
import { areaPath, barsOf, bucketAt, indexAt, linePath, spotsOf, type SparkStyle } from './sparkGeometry'

const WIDTH = 132
const HEIGHT = 30

export type SparkTone = 'line' | 'bad' | 'warn' | 'ok'

const TONE: Record<SparkTone, string> = {
  line: 'var(--chart-line)',
  bad: 'var(--destructive-text)',
  warn: 'var(--warning-text)',
  ok: 'var(--success-text)',
}

export function Spark({ values, times, style, tone = 'line', format, label, className }: { values: readonly (number | null)[]; times: readonly number[]; style: SparkStyle; tone?: SparkTone; format: (value: number) => string; label: string; className?: string }) {
  const [at, setAt] = useState<number | null>(null)
  const fill = useId()
  const colour = TONE[tone]
  const spots = style === 'bars' ? [] : spotsOf(values, WIDTH, HEIGHT)
  const bars = style === 'bars' ? barsOf(values, WIDTH, HEIGHT) : []
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const move = (event: PointerEvent<HTMLSpanElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const fraction = box.width > 0 ? (event.clientX - box.left) / box.width : 0
    setAt(style === 'bars' ? bucketAt(fraction, values.length) : indexAt(fraction, values.length))
  }
  const value = at === null ? null : values[at]
  const spot = at === null ? undefined : spots.find((one) => one.at === at)
  const x = at === null ? 0 : style === 'bars' ? (bars[at]?.x ?? 0) + (bars[at]?.width ?? 0) / 2 : values.length > 1 ? (at * WIDTH) / (values.length - 1) : WIDTH / 2
  const summary = known.length === 0 ? `${label}: no data` : `${label}: last ${format(known[known.length - 1])}, highest ${format(Math.max(...known))}`
  return (
    <span className={cn('relative inline-block h-[30px] w-[132px] shrink-0 align-middle', className)} role="img" aria-label={summary} onPointerMove={move} onPointerLeave={() => setAt(null)}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
        {style === 'bars' ? (
          bars.map((bar) => <rect key={bar.at} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={1} fill={colour} opacity={at === null || at === bar.at ? 0.85 : 0.45} />)
        ) : (
          <>
            {style === 'area' ? (
              <>
                <defs>
                  <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor={colour} stopOpacity={0.35} />
                    <stop offset="1" stopColor={colour} stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <path d={areaPath(spots, HEIGHT)} fill={`url(#${fill})`} />
              </>
            ) : null}
            <path d={linePath(spots)} fill="none" stroke={colour} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
          </>
        )}
        {at !== null ? <line x1={x} x2={x} y1={-3} y2={HEIGHT + 3} stroke="var(--chart-axis)" strokeDasharray="2 2" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.8} /> : null}
      </svg>
      {spot ? <span aria-hidden className="pointer-events-none absolute size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card" style={{ left: `${(spot.x / WIDTH) * 100}%`, top: `${(spot.y / HEIGHT) * 100}%`, background: colour, boxSizing: 'content-box' }} /> : null}
      {at !== null ? (
        <span aria-hidden className="pointer-events-none absolute bottom-[calc(100%+8px)] z-30 min-w-[112px] -translate-x-1/2 whitespace-nowrap rounded-sm border border-line-strong bg-popover px-2 py-1.5 text-left shadow-md max-md:left-0 max-md:translate-x-0" style={{ left: `${(x / WIDTH) * 100}%` }}>
          <span className="block font-mono text-[11px] text-muted-foreground">{times[at] ? new Date(times[at]).toTimeString().slice(0, 5) : ''}</span>
          <b className="font-mono text-[12px] font-medium text-foreground">{typeof value === 'number' ? format(value) : 'no data'}</b>
        </span>
      ) : null}
    </span>
  )
}
