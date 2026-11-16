import type { LayoutItem } from '@/data/dashboards'

export const COLUMNS = 12

export const MAX_ROWS = 60

export type SizeKey = 's' | 'm' | 'l' | 'full'

export const SIZES: { key: SizeKey; label: string; w: number; h: number | null }[] = [
  { key: 's', label: 'Small', w: 4, h: 4 },
  { key: 'm', label: 'Medium', w: 6, h: 5 },
  { key: 'l', label: 'Large', w: 8, h: 6 },
  { key: 'full', label: 'Full width', w: COLUMNS, h: null },
]

export const collides = (a: LayoutItem, b: LayoutItem): boolean => a.panel !== b.panel && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high)

function bounded(item: LayoutItem): LayoutItem {
  const w = clamp(Math.round(item.w), 1, COLUMNS)
  return { panel: item.panel, x: clamp(Math.round(item.x), 0, COLUMNS - w), y: Math.max(0, Math.round(item.y)), w, h: clamp(Math.round(item.h), 1, MAX_ROWS) }
}

export function compact(items: LayoutItem[], first?: string): LayoutItem[] {
  const order = items.map(bounded).map((item, index) => ({ item, index }))
  order.sort((a, b) => a.item.y - b.item.y || Number(b.item.panel === first) - Number(a.item.panel === first) || a.item.x - b.item.x || a.index - b.index)
  const placed: LayoutItem[] = []
  for (const { item } of order) {
    let y = item.y
    while (placed.some((other) => collides({ ...item, y }, other))) y += 1
    while (y > 0 && !placed.some((other) => collides({ ...item, y: y - 1 }, other))) y -= 1
    placed.push({ ...item, y })
  }
  return items.flatMap((original) => {
    const found = placed.find((item) => item.panel === original.panel)
    return found ? [found] : []
  })
}

const find = (items: LayoutItem[], id: string): LayoutItem | undefined => items.find((item) => item.panel === id)

const replaced = (items: LayoutItem[], next: LayoutItem): LayoutItem[] => items.map((item) => (item.panel === next.panel ? next : item))

export function nudge(items: LayoutItem[], id: string, dx: number, dy: number): LayoutItem[] {
  const current = find(items, id)
  if (!current) return items
  const aimed = bounded({ ...current, x: current.x + dx, y: current.y + dy })
  if (dy !== 0) {
    const blockers = items.filter((other) => collides(aimed, other))
    if (blockers.length > 0) aimed.y = dy < 0 ? Math.min(...blockers.map((other) => other.y)) : Math.max(...blockers.map((other) => other.y + other.h))
  }
  return compact(replaced(items, aimed), id)
}

export function resizeBy(items: LayoutItem[], id: string, dw: number, dh: number): LayoutItem[] {
  const current = find(items, id)
  if (!current) return items
  const w = clamp(current.w + dw, 1, COLUMNS - current.x)
  const h = clamp(current.h + dh, 1, MAX_ROWS)
  return compact(replaced(items, { ...current, w, h }), id)
}

export function setSize(items: LayoutItem[], id: string, key: SizeKey): LayoutItem[] {
  const current = find(items, id)
  const size = SIZES.find((one) => one.key === key)
  if (!current || !size) return items
  const h = size.h ?? current.h
  return compact(replaced(items, { ...current, w: size.w, h, x: Math.min(current.x, COLUMNS - size.w) }), id)
}

export function append(items: LayoutItem[], id: string, w: number, h: number): LayoutItem[] {
  const bottom = Math.max(0, ...items.map((item) => item.y + item.h))
  return compact([...items, { panel: id, x: 0, y: bottom, w, h }])
}

export function duplicate(items: LayoutItem[], id: string, copy: string): LayoutItem[] {
  const current = find(items, id)
  if (!current) return items
  return compact([...items, { ...current, panel: copy, y: current.y + current.h }], copy)
}

export function remove(items: LayoutItem[], id: string): LayoutItem[] {
  if (!find(items, id)) return items
  return compact(items.filter((item) => item.panel !== id))
}

const reading = (items: LayoutItem[]): LayoutItem[] => [...items].sort((a, b) => a.y - b.y || a.x - b.x)

export function reorder(items: LayoutItem[], id: string, by: number): LayoutItem[] {
  const sequence = reading(items)
  const from = sequence.findIndex((item) => item.panel === id)
  const to = clamp(from + by, 0, sequence.length - 1)
  if (from < 0 || from === to) return items
  const [moved] = sequence.splice(from, 1)
  sequence.splice(to, 0, moved)
  let x = 0
  let y = 0
  let rowBottom = 0
  const flowed = sequence.map((item) => {
    if (x + item.w > COLUMNS) {
      x = 0
      y = rowBottom
    }
    const out = { ...item, x, y }
    x += item.w
    rowBottom = Math.max(rowBottom, y + item.h)
    return out
  })
  const compacted = compact(flowed)
  return items.flatMap((original) => {
    const found = compacted.find((item) => item.panel === original.panel)
    return found ? [found] : []
  })
}

export const fits = (items: LayoutItem[]): boolean => items.every((item) => item.w >= 1 && item.h >= 1 && item.x >= 0 && item.y >= 0 && item.x + item.w <= COLUMNS)
