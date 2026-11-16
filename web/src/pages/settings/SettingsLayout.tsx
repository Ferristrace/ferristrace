import { ChevronsUpDown, Folder } from 'lucide-react'
import { useOrganisations } from '@/auth/session'
import { NavLink, Outlet } from '@/lib/router'
import { NativeSelect } from '@/components/ui/input'
import { useProjects } from '@/data/projects'
import { useScope } from '@/lib/scope'
import { cn } from '@/lib/utils'

const ADMINISTERED = new Set(['audit', 'agents', 'mcp'])

const GROUPS: { label: string; items: [string, string][] }[] = [
  { label: 'Personal', items: [['profile', 'Profile'], ['preferences', 'Preferences']] },
  { label: 'Organisation', items: [['general', 'General'], ['members', 'Members'], ['teams', 'Teams'], ['projects', 'Projects'],['agents', 'Agents'], ['mcp', 'MCP'], ['audit', 'Audit log'], ['llm-prices', 'LLM prices'], ['billing', 'Billing']] },
  { label: 'Project', items: [['project/general', 'General'], ['project/alerts', 'Exception alerts'], ['project/api-keys', 'API keys']] },
]

export function SettingsLayout() {
  const projects = useProjects()
  const { project, chooseProject } = useScope()
  const { active } = useOrganisations()
  const administers = active?.role === 'owner' || active?.role === 'admin'
  return (
    <div className="flex items-start gap-8 max-md:flex-col max-md:items-stretch max-md:gap-4">
      <nav aria-label="Settings sections" className="flex shrink-0 flex-col gap-0.5 max-md:scrollbar-none max-md:-mx-[max(16px,env(safe-area-inset-left))] max-md:-mt-3.5 max-md:w-auto max-md:flex-row max-md:items-center max-md:gap-1.5 max-md:self-stretch max-md:overflow-x-auto max-md:border-b max-md:px-3 max-md:py-2 md:sticky md:top-[51px] md:-mb-10 md:-ml-5 md:-mt-3.5 md:min-h-[calc(100vh-51px)] md:w-[224px] md:border-r md:px-3 md:py-3.5">
        <h1 className="mb-1 px-2.5 text-title max-md:hidden">Settings</h1>
        {GROUPS.map((g) => (
          <div key={g.label} className="flex flex-col gap-0.5 max-md:contents">
            <span className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[.05em] text-faint-foreground max-md:hidden">{g.label}</span>
            {g.label === 'Project' ? (
              <div className="relative mb-1 max-md:mb-0 max-md:w-[150px] max-md:shrink-0">
                <Folder className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted-foreground" aria-hidden />
                <NativeSelect aria-label="Project to configure" value={projects.find((p) => p.id === project)?.id ?? projects[0]?.id ?? ''} onChange={(e) => chooseProject(e.target.value)} className="h-[30px] appearance-none pl-7 font-semibold">
                  {projects.length > 0 ? projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="">No project yet</option>}
                </NativeSelect>
                <ChevronsUpDown className="pointer-events-none absolute right-2 top-2 size-3.5 text-muted-foreground" aria-hidden />
              </div>
            ) : null}
            {g.items.filter(([to]) => administers || !ADMINISTERED.has(to)).map(([to, label]) => (
              <NavLink key={to} to={`/settings/${to}`} className={({ isActive }) => cn('flex h-[30px] shrink-0 items-center whitespace-nowrap rounded-md px-2.5 text-control font-medium text-muted-foreground no-underline hover:bg-muted hover:text-foreground', isActive && 'bg-accent-subtle font-semibold text-accent-text hover:bg-accent-subtle hover:text-accent-text')}>{label}</NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex min-w-0 max-w-[900px] flex-[999_1_560px] flex-col gap-4 max-md:flex-none">
        <Outlet />
      </div>
    </div>
  )
}
