import { Link } from '@/lib/router'
import { xFraction, type Frame } from './geometry'
import type { Mark } from './types'

const LANES = 3

export function MarkerLayer({ marks, frame }: { marks: Mark[]; frame: Frame }) {
  const inside = marks.filter((mark) => mark.atNs >= frame.t0 && mark.atNs <= frame.t1)
  return (
    <>
      {inside.map((mark, index) => (
        <span key={`${index}-${mark.label}-${mark.atNs}`} className="pointer-events-none absolute inset-y-0 border-l border-dashed border-foreground/60" style={{ left: `${xFraction(mark.atNs, frame) * 100}%` }}>
          <Link to={mark.to} aria-label={`Release ${mark.label}`} className="pointer-events-auto absolute left-1 whitespace-nowrap rounded-sm border bg-background px-1 font-mono text-[10px] leading-4 text-foreground no-underline" style={{ top: `${(index % LANES) * 16}px` }}>
            ▲ {mark.label}
          </Link>
        </span>
      ))}
    </>
  )
}
