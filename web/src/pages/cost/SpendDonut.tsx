import { useState } from 'react'
import { CardHeader, CardKind } from '@/components/ui/card'
import { arcPath, pieSlices } from '@/components/ft/panels/geometry'
import { cn } from '@/lib/utils'
import { SIGNAL_COLOUR } from './colours'
import type { Slice } from './shape'

const SIZE = 100
const OUTER = 46
const INNER = 32

export function SpendDonut({ title, slices, total, format, caption }: { title: string; slices: Slice[]; total: number; format: (value: number) => string; caption: string }) {
  const [hovered, setHovered] = useState<string | null>(null)
  const arcs = pieSlices(slices.map((slice) => ({ label: slice.label, value: slice.value, labels: { signal: slice.signal } })))
  const share = (value: number) => (total > 0 ? `${Math.round((value / total) * 100)} %` : '0 %')
  return (
    <figure className="m-0 flex min-w-0 flex-col rounded-md border bg-card">
      <figcaption>
        <CardHeader className="flex-wrap gap-y-0.5">
          <span className="min-w-0 text-[13px] font-semibold leading-5">{title}</span>
          <CardKind>Pie</CardKind>
        </CardHeader>
      </figcaption>
      <div className="flex flex-1 flex-wrap items-center justify-center gap-x-6 gap-y-4 px-4 py-5">
        <div className="relative size-[176px] shrink-0">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${title}: ${format(total)} ${caption}, ${slices.map((slice) => `${slice.label} ${format(slice.value)}`).join(', ')}`} className="size-full">
            {arcs.length === 0 ? <circle cx={SIZE / 2} cy={SIZE / 2} r={(OUTER + INNER) / 2} fill="none" stroke="var(--muted)" strokeWidth={OUTER - INNER} /> : null}
            {arcs.map((arc) => (
              <path
                key={arc.label}
                d={arcPath(SIZE / 2, SIZE / 2, OUTER, INNER, arc.start, arc.end)}
                fillRule="evenodd"
                fill={SIGNAL_COLOUR[arc.labels.signal as keyof typeof SIGNAL_COLOUR]}
                fillOpacity={hovered === null || hovered === arc.labels.signal ? 1 : 0.5}
                stroke="var(--card)"
                strokeWidth="0.8"
                onPointerEnter={() => setHovered(arc.labels.signal)}
                onPointerLeave={() => setHovered(null)}
              >
                <title>{`${arc.label}: ${format(arc.value)}, ${share(arc.value)}`}</title>
              </path>
            ))}
          </svg>
          <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-center">
            <span className="max-w-[100px] truncate font-mono text-[15px] font-semibold leading-none">{format(total)}</span>
            <span className="max-w-[100px] truncate text-caption text-muted-foreground">{caption}</span>
          </div>
        </div>
        <ul aria-label="Legend" className="m-0 flex min-w-[170px] max-w-full list-none flex-col gap-2 p-0 text-control">
          {slices.map((slice) => (
            <li key={slice.signal} className={cn('flex items-center gap-2', hovered !== null && hovered !== slice.signal && 'opacity-60')}>
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: SIGNAL_COLOUR[slice.signal] }} aria-hidden />
              <span className="flex-1">{slice.label}</span>
              <span className="font-mono font-semibold tabular-nums">{format(slice.value)}</span>
              <span className="w-10 text-right font-mono text-caption text-muted-foreground tabular-nums">{share(slice.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  )
}
