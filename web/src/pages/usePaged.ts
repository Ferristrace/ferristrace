import { useEffect, useMemo, useState } from 'react'
import { pagesOf } from '@/lib/paging'

export function usePaged<T>(items: T[], first = 25, reset?: string) {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(first)
  useEffect(() => setPage(1), [reset])
  const at = Math.min(page, pagesOf(items.length, size))
  const visible = useMemo(() => items.slice((at - 1) * size, at * size), [items, at, size])
  return { visible, at, size, setPage, setSize: (next: number) => { setPage(1); setSize(next) } }
}
