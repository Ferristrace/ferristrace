import type { ReactNode } from 'react'
import { SortTh } from '@/components/ui/misc'
import type { Direction } from '@/lib/sorting'

export function SortHead({ label, dir, onSort, numeric, className }: { label: ReactNode; dir: Direction | null; onSort: () => void; numeric?: boolean; className?: string }) {
  return <SortTh label={label} dir={dir as never} onSort={onSort} numeric={numeric} className={className} />
}
