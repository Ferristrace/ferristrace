import { MarkerLayer as Lanes } from '../MarkerLayer'
import { xFraction, type Frame } from './geometry'
import type { Mark } from './types'

export function MarkerLayer({ marks, frame }: { marks: Mark[]; frame: Frame }) {
  const pins = marks
    .filter((mark) => mark.atNs >= frame.t0 && mark.atNs <= frame.t1)
    .map((mark) => ({ frac: xFraction(mark.atNs, frame), label: mark.label, to: mark.to }))
  return <Lanes pins={pins} />
}
