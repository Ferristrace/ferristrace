import { useEffect, useRef, useState } from 'react'
import { Link } from '@/lib/router'

export type MarkerPin = { frac: number; label: string; to?: string; when?: string }

export type Cluster = { frac: number; pins: MarkerPin[] }

const MERGE_PX = 12
const LISTED = 6

export function clusterPins(pins: MarkerPin[], width: number): Cluster[] {
  const sorted = [...pins].sort((a, b) => a.frac - b.frac)
  const clusters: Cluster[] = []
  let anchor = -Infinity
  for (const pin of sorted) {
    const x = pin.frac * width
    const last = clusters[clusters.length - 1]
    if (last && x - anchor < MERGE_PX) {
      last.pins.push(pin)
      last.frac = last.pins.reduce((sum, one) => sum + one.frac, 0) / last.pins.length
    } else {
      clusters.push({ frac: pin.frac, pins: [pin] })
      anchor = x
    }
  }
  return clusters
}

export function MarkerLayer({ pins, popover = true }: { pins: MarkerPin[]; popover?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth || 600)
    const observer = new ResizeObserver(() => setWidth(el.clientWidth || 600))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0">
      {clusterPins(pins, width).map((cluster) => {
        const shown = cluster.pins.slice(0, LISTED)
        const hidden = cluster.pins.length - shown.length
        const flip = cluster.frac > 0.6
        const name = cluster.pins.length === 1 ? `Release ${cluster.pins[0].label}` : `${cluster.pins.length} releases`
        return (
          <span key={`${cluster.pins[0].label}-${cluster.frac}`} className="group/release absolute inset-y-0 border-l border-dashed border-foreground/30" style={{ left: `${cluster.frac * 100}%` }}>
            <span
              tabIndex={popover ? 0 : -1}
              role={popover ? 'button' : undefined}
              aria-label={popover ? name : undefined}
              aria-hidden={popover ? undefined : true}
              className={`${popover ? 'pointer-events-auto cursor-default' : ''} absolute -left-[7px] top-0 flex h-4 min-w-[14px] items-center justify-center rounded-sm bg-background/90 px-0.5 font-mono text-[9px] leading-none text-foreground ring-1 ring-border focus-visible:outline-2 focus-visible:outline-ring`}
            >
              ▲{cluster.pins.length > 1 ? <span className="ml-px">{cluster.pins.length}</span> : null}
            </span>
            {popover ? (
              <span role="group" aria-label={name} className={`pointer-events-auto absolute top-4 z-20 hidden min-w-[180px] max-w-[300px] flex-col gap-0.5 rounded-md border bg-popover px-2 py-1.5 text-caption text-popover-foreground shadow-md group-hover/release:flex group-focus-within/release:flex ${flip ? 'right-0' : 'left-0'}`}>
                <span className="font-mono text-muted-foreground">{cluster.pins.length === 1 ? 'Release' : `${cluster.pins.length} releases`}</span>
                {shown.map((pin, index) => {
                  const body = (
                    <>
                      <span className="truncate font-mono">{pin.label}</span>
                      {pin.when ? <span className="ml-auto pl-2 font-mono text-faint-foreground">{pin.when}</span> : null}
                    </>
                  )
                  return pin.to ? (
                    <Link key={`${index}-${pin.label}`} to={pin.to} className="flex items-center gap-1.5 rounded-sm px-1 py-px text-popover-foreground no-underline hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">{body}</Link>
                  ) : (
                    <span key={`${index}-${pin.label}`} className="flex items-center gap-1.5 px-1 py-px">{body}</span>
                  )
                })}
                {hidden > 0 ? <span className="px-1 text-faint-foreground">and {hidden} more</span> : null}
              </span>
            ) : null}
          </span>
        )
      })}
    </div>
  )
}
