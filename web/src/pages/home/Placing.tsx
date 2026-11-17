import { SlidersHorizontal } from 'lucide-react'
import { PlacementPicker, placedCount } from '@/components/ft/Placement'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { isPlaced, usePlacements, type Placement } from '@/data/placement'

export function Placing({ placement, onChange, windowMs }: { placement: Placement; onChange: (part: Partial<Placement>) => void; windowMs: number }) {
  const { seen } = usePlacements(windowMs)
  const nothing = seen.clusters.length + seen.namespaces.length + seen.workloads.length + seen.pods.length + seen.nodes.length === 0
  if (nothing && !isPlaced(placement)) return null
  const count = placedCount(placement)
  return (
    <>
      <div className="md:hidden">
        <PlacementPicker collapsible placement={placement} onChange={onChange} windowMs={windowMs} />
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" className="absolute right-0 bottom-1.5 max-md:hidden" aria-label={count ? `Kubernetes placement, ${count} on` : 'Kubernetes placement'}>
            <SlidersHorizontal aria-hidden />
            Filters
            {count ? <span className="rounded-full bg-primary px-1.5 font-mono text-[11px] leading-[18px] text-primary-foreground">{count} on</span> : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(560px,calc(100vw-32px))] p-3">
          <PlacementPicker placement={placement} onChange={onChange} windowMs={windowMs} />
        </PopoverContent>
      </Popover>
    </>
  )
}
