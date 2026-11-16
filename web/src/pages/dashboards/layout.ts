import type { DashboardDoc, LayoutItem, PanelDoc } from '@/data/dashboards'

export const COLUMNS = 12

const UNPLACED_HEIGHT = 4

export type Placed = { panel: PanelDoc; x: number; y: number; w: number; h: number }

export function placed(doc: DashboardDoc): Placed[] {
  const byId = new Map<string, LayoutItem>(doc.layout.map((item) => [item.panel, item]))
  let bottom = Math.max(0, ...doc.layout.map((item) => item.y + item.h))
  const out: Placed[] = []
  for (const panel of doc.panels) {
    const item = byId.get(panel.id)
    if (item) {
      const x = Math.min(Math.max(0, item.x), COLUMNS - 1)
      out.push({ panel, x, y: Math.max(0, item.y), w: Math.max(1, Math.min(item.w, COLUMNS - x)), h: Math.max(1, item.h) })
    } else {
      out.push({ panel, x: 0, y: bottom, w: COLUMNS, h: UNPLACED_HEIGHT })
      bottom += UNPLACED_HEIGHT
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x)
}
