import { SafeLink } from '@/components/ft/panels/SafeLink'
import { cn } from '@/lib/utils'
import { linkOf } from './attention'
import type { Fill, Tile } from './hub'

const FILL: Record<Exclude<Fill, null>, string> = {
  error: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive-hover',
  warning: 'border-transparent bg-[color-mix(in_srgb,var(--status-deg)_82%,black)] text-destructive-foreground hover:bg-[color-mix(in_srgb,var(--status-deg)_74%,black)]',
}

export function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <section aria-label="Figures" className="col-span-full grid min-w-0 grid-cols-4 gap-3.5 max-[1100px]:grid-cols-1">
      {tiles.map((tile) => {
        const to = linkOf(tile.to)
        return (
          <SafeLink
            key={tile.key}
            to={to.path}
            search={to.search}
            aria-label={`${tile.label}: ${tile.value ?? 'no data'}. ${tile.sub}`}
            data-fill={tile.fill ?? 'none'}
            className={cn(
              'flex min-w-0 flex-col rounded-sm border no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              tile.fill ? FILL[tile.fill] : 'bg-card text-foreground hover:bg-row-hover',
            )}
          >
            <span className="flex h-10 items-center px-3.5 text-control font-semibold">{tile.label}</span>
            <span className="flex flex-1 flex-col items-center justify-center gap-0.5 px-3 pt-2.5 pb-[18px] text-center">
              <span className="text-[56px] font-medium leading-[60px] tracking-[-0.03em] tabular max-md:text-[36px] max-md:leading-10">{tile.value ?? '—'}</span>
              <span className={cn('text-caption tabular', !tile.fill && 'text-muted-foreground')}>{tile.sub}</span>
            </span>
          </SafeLink>
        )
      })}
    </section>
  )
}
