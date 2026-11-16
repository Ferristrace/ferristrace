export type Direction = 'asc' | 'desc'

export type Sorting<K extends string> = { key: K; dir: Direction }

export type Sortable = string | number | null | undefined

export function sorted<T, K extends string>(rows: readonly T[], sorting: Sorting<K> | null, value: (row: T, key: K) => Sortable): T[] {
  if (!sorting) return [...rows]
  const sign = sorting.dir === 'asc' ? 1 : -1
  return rows
    .map((row, at) => ({ row, at, v: value(row, sorting.key) }))
    .sort((a, b) => {
      const missingA = a.v === null || a.v === undefined || (typeof a.v === 'number' && Number.isNaN(a.v))
      const missingB = b.v === null || b.v === undefined || (typeof b.v === 'number' && Number.isNaN(b.v))
      if (missingA || missingB) return missingA === missingB ? a.at - b.at : missingA ? 1 : -1
      const order = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: 'base' })
      return order === 0 ? a.at - b.at : sign * order
    })
    .map(({ row }) => row)
}

export function toggled<K extends string>(current: Sorting<K> | null, key: K, first: Direction = 'desc'): Sorting<K> {
  if (current?.key !== key) return { key, dir: first }
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}
