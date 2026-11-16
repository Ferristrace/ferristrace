import type { Labels, PanelDoc, PanelResult } from '@/data/dashboards'

export type Range = { fromNs: number; toNs: number }

export type Mark = { atNs: number; label: string; to: string }

export type DrillAt = { atNs: number; stepNs: number }

export type DrillFn = (labels: Labels, at: DrillAt | null) => void

export type ZoomFn = (fromMs: number, toMs: number) => void

export type PanelProps<R extends PanelResult = PanelResult> = {
  panel: PanelDoc
  result: R
  range: Range
  markers?: Mark[]
  onZoom?: ZoomFn
  drill?: DrillFn
}

export type Of<K extends PanelResult['kind']> = Extract<PanelResult, { kind: K }>
