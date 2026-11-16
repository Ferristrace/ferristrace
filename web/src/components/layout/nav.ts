import {
  Activity, ArrowLeftRight, Coins, BellRing, Boxes, CircleAlert, Gauge, Network, Sparkles, Rocket, Cpu, Database, House, Layers, LayoutDashboard, LayoutGrid, LineChart, ScrollText, Server, Siren, Waypoints, Zap, type LucideIcon,
} from 'lucide-react'

export type NavItem = { label: string; to: string; icon: LucideIcon; keys?: string; badge?: boolean }
export type NavAxis = { key: string; label: string; icon: LucideIcon; tabs: NavItem[] }

export const AXES: NavAxis[] = [
  {
    key: 'home', label: 'Home', icon: House,
    tabs: [
      { label: 'Overview', to: '/', icon: House, keys: 'O' },
      { label: 'AI', to: '/ai', icon: Sparkles, keys: 'C' },
      { label: 'Cost', to: '/cost', icon: Coins },
    ],
  },
  {
    key: 'alerts', label: 'Alerts', icon: BellRing,
    tabs: [{ label: 'Rules', to: '/alerts', icon: BellRing, keys: 'A', badge: true }],
  },
  {
    key: 'incidents', label: 'Incidents', icon: Siren,
    tabs: [
      { label: 'Incidents', to: '/incidents', icon: Siren, keys: 'N', badge: true },
      { label: 'Insights', to: '/incidents/insights', icon: Gauge },
      { label: 'Issues', to: '/issues', icon: CircleAlert, keys: 'I', badge: true },
      { label: 'Status page', to: '/status-page', icon: Activity, keys: 'P' },
    ],
  },
  {
    key: 'dashboards', label: 'Dashboards', icon: LayoutDashboard,
    tabs: [{ label: 'Dashboards', to: '/dashboards', icon: LayoutDashboard }],
  },
  {
    key: 'services', label: 'Services', icon: Server,
    tabs: [
      { label: 'Services', to: '/services', icon: LayoutGrid, keys: 'V' },
      { label: 'Service map', to: '/service-map', icon: Network },
      { label: 'Releases', to: '/releases', icon: Rocket, keys: 'R' },
      { label: 'Requests', to: '/backend/requests', icon: ArrowLeftRight },
      { label: 'Jobs', to: '/backend/jobs', icon: Layers },
      { label: 'Cache', to: '/backend/cache', icon: Zap },
      { label: 'Queries', to: '/backend/queries', icon: Database },
      { label: 'System metrics', to: '/backend/system', icon: Cpu },
    ],
  },
  { key: 'logs', label: 'Logs', icon: ScrollText, tabs: [{ label: 'Logs', to: '/logs', icon: ScrollText, keys: 'L' }] },
  { key: 'traces', label: 'Traces', icon: Waypoints, tabs: [{ label: 'Traces', to: '/traces', icon: Waypoints, keys: 'T' }] },
  { key: 'metrics', label: 'Metrics', icon: LineChart, tabs: [{ label: 'Metrics', to: '/metrics', icon: LineChart, keys: 'M' }] },
  {
    key: 'infra', label: 'Infrastructure', icon: Boxes,
    tabs: [
      { label: 'Overview', to: '/infra', icon: LayoutGrid },
      { label: 'Kubernetes', to: '/infra/kubernetes', icon: Boxes },
    ],
  },
]

export const ALL_NAV = AXES.flatMap((axis) => axis.tabs)

export const axisOf = (matches: (to: string) => boolean): NavAxis | undefined =>
  AXES.find((axis) => axis.tabs.some((tab) => matches(tab.to)))

export const currentTab = (tabs: NavItem[], pathname: string): NavItem | undefined =>
  tabs
    .filter((tab) => (tab.to === '/' ? pathname === '/' : pathname === tab.to || pathname.startsWith(`${tab.to}/`)))
    .sort((one, other) => other.to.length - one.to.length)[0]

export const sectionOf = (pathname: string): NavAxis | undefined => {
  const hits = AXES.flatMap((axis) => axis.tabs.filter((tab) => (tab.to === '/' ? pathname === '/' : pathname === tab.to || pathname.startsWith(`${tab.to}/`))).map((tab) => ({ axis, length: tab.to.length })))
  return hits.sort((one, other) => other.length - one.length)[0]?.axis
}
