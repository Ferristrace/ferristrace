import { currentTab, sectionOf } from './nav'
import { useNavCounts } from './useNavCounts'
import { NavLink, useLocation } from '@/lib/router'
import { cn } from '@/lib/utils'

const countLabel = (to: string, count: number) => `${count} ${to === '/issues' ? 'new issues' : to === '/alerts' ? 'alerts firing' : 'open incidents'}`

export function SectionTabs() {
  const { pathname } = useLocation()
  const counts = useNavCounts()
  const section = sectionOf(pathname)
  if (!section || section.tabs.length < 2) return null
  const current = currentTab(section.tabs, pathname)
  if (!current || current.to !== pathname) return null
  return (
    <nav aria-label={section.label} className="scrollbar-none -mx-[max(16px,env(safe-area-inset-left))] flex shrink-0 gap-5 overflow-x-auto border-b px-[max(16px,env(safe-area-inset-left))] md:-mx-5 md:px-5">
      {section.tabs.map((t) => {
        const count = t.badge ? counts[t.to] : 0
        return (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={() =>
              cn(
                'relative flex h-10 shrink-0 items-center gap-1.5 text-control font-medium text-muted-foreground no-underline hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                current === t && 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary',
              )
            }
          >
            {t.label}
            {count ? <span className="rounded-full bg-destructive-subtle px-1.5 font-mono text-[11px] font-semibold leading-[18px] text-destructive-text" aria-label={countLabel(t.to, count)}>{count}</span> : null}
          </NavLink>
        )
      })}
    </nav>
  )
}
