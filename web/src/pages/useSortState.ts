import { useState } from 'react'
import { toggled, type Direction, type Sorting } from '@/lib/sorting'

export function useSortState<K extends string>(initial: Sorting<K> | null = null) {
  const [sorting, setSorting] = useState<Sorting<K> | null>(initial)
  const dir = (key: K): Direction | null => (sorting?.key === key ? sorting.dir : null)
  const on = (key: K, first: Direction = 'asc') => () => setSorting((now) => toggled(now, key, first))
  return { sorting, dir, on }
}
