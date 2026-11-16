import { ListFilter } from 'lucide-react'
import { useId, useState, type ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function FiltersBar({ active = 0, className, children, ...rest }: ComponentProps<'div'> & { active?: number }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <Button size="sm" variant="outline" className="self-start md:hidden" aria-expanded={open} aria-controls={id} onClick={() => setOpen((was) => !was)}>
        <ListFilter aria-hidden />Filters{active > 0 ? <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] text-primary-foreground">{active}</span> : null}
      </Button>
      <div id={id} className={cn('flex flex-wrap items-center gap-2', !open && 'max-md:hidden', className)} {...rest}>{children}</div>
    </div>
  )
}
