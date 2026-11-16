import type { ComponentProps, ReactNode } from 'react'
import { SortTh } from '@/components/ui/misc'
import type { Direction } from '@/lib/sorting'

export function SortHead({ label, dir, onSort, numeric, className }: { label: ReactNode; dir: Direction | null; onSort: () => void; numeric?: boolean; className?: string }) {
  const props = { label, dir, onSort, numeric, className } as unknown as ComponentProps<typeof SortTh>
  return <SortTh {...props} />
}
