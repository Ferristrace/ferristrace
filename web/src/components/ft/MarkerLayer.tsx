import { useEffect, useRef, useState } from 'react'
import { Link } from '@/lib/router'

export type MarkerPin = { frac: number; label: string; to?: string }

const ROWS = 3
const ROW_HEIGHT = 16
const GAP = 6
const CHAR_WIDTH = 6.2
const PADDING = 22

const labelWidth = (label: string) => label.length * CHAR_WIDTH + PADDING

export type Placement = { pin: MarkerPin; x: number; row: number | null; flip: boolean }

export function placeMarkers(pins: MarkerPin[], width: number): Placement[] {
  const rowEnd = new Array<number>(ROWS).fill(-Infinity)
  return [...pins].sort((a, b) => a.frac - b.frac).map((pin) => {
    const x = pin.frac * width
    const w = labelWidth(pin.label)
    const flip = x + 4 + w > width && x - 4 - w >= 0
    const start = flip ? x - 4 - w : x + 4
    const row = rowEnd.findIndex((end) => start >= end + GAP)
    if (row === -1) return { pin, x, row: null, flip }
    rowEnd[row] = start + w
    return { pin, x, row, flip }
  })
}

export function MarkerLayer({ pins }: { pins: MarkerPin[] }) {
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
      {placeMarkers(pins, width).map(({ pin, row, flip }) => {
        const line = 'border-foreground/60'
        const tag = row === null ? null : (
          <span
            className={`pointer-events-auto absolute whitespace-nowrap rounded-sm border bg-background px-1 font-mono text-[10px] leading-4 text-foreground shadow-sm ${flip ? 'right-1' : 'left-1'}`}
            style={{ top: `${row * ROW_HEIGHT}px` }}
          >▲ {pin.label}</span>
        )
        const hit = row === null && pin.to ? (
          <Link to={pin.to} aria-label={`Release ${pin.label}`} title={pin.label} className="pointer-events-auto absolute inset-y-0 -left-1 w-2" />
        ) : row === null ? <span title={pin.label} className="pointer-events-auto absolute inset-y-0 -left-1 w-2" /> : null
        return (
          <span key={`${pin.label}-${pin.frac}`} className={`absolute inset-y-0 border-l border-dashed ${line}`} style={{ left: `${pin.frac * 100}%` }}>
            {tag && pin.to ? <Link to={pin.to} aria-label={`Release ${pin.label}`} className="no-underline">{tag}</Link> : tag}
            {hit}
          </span>
        )
      })}
    </div>
  )
}
