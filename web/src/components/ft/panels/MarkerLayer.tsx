import { MarkerLayer as Lanes } from '../MarkerLayer'
import { axisTime, nearbyBy, xFraction, type Frame } from './geometry'
import type { Mark } from './types'

export function MarkerLayer({ marks, frame }: { marks: Mark[]; frame: Frame }) {
  const span = frame.t1 - frame.t0
  const pins = marks
    .filter((mark) => mark.atNs >= frame.t0 && mark.atNs <= frame.t1)
    .map((mark) => ({ frac: xFraction(mark.atNs, frame), label: mark.label, to: mark.to, when: axisTime(mark.atNs, span) }))
  return <Lanes pins={pins} popover={false} />
}

export function releasesNear(marks: Mark[], atNs: number, spanNs: number): Mark[] {
  return nearbyBy(marks, (mark) => mark.atNs, atNs, spanNs)
}
