import { useNavigate as useRouterNavigate } from '@tanstack/react-router'
import { useSearchParam } from '@/lib/router'
import { toggled, type Direction, type Sorting } from '@/lib/sorting'
import { searchOf, sortingFrom } from './sortKeys'

export function useUrlSort<K extends string>(keys: readonly K[], fallback: K, firstOf: (key: K) => Direction) {
  const goTo = useRouterNavigate()
  const sorting = sortingFrom(keys, fallback, firstOf, useSearchParam('s'), useSearchParam('sd'))
  const apply = (next: Sorting<K>) =>
    void goTo({
      to: '.' as never,
      search: ((was: Record<string, unknown>) => ({ ...was, ...searchOf(next, fallback, firstOf) })) as never,
      replace: true,
    })
  return {
    sorting,
    pick: (key: K) => apply({ key, dir: firstOf(key) }),
    sortBy: (key: K) => apply(toggled(sorting, key, firstOf(key))),
    dirOf: (key: K): Direction | null => (sorting.key === key ? sorting.dir : null),
  }
}
