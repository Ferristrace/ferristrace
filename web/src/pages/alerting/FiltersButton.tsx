import { ListFilter } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function FiltersButton({ open, count, controls, onToggle }: { open: boolean; count: number; controls: string; onToggle: () => void }) {
  return (
    <Button size="sm" variant="outline" className="md:hidden" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <ListFilter />Filters{count > 0 ? <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] text-primary-foreground">{count}</span> : null}
    </Button>
  )
}
