import { Search, SearchX, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate as useRouterNavigate } from '@tanstack/react-router'
import { Link, useSearchParam } from '@/lib/router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { InputGroup, NativeSelect } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, Td, Th, Tr, Kbd } from '@/components/ui/misc'
import { EmptyState, PageHeader, ServiceDot } from '@/components/ft/bits'
import { ERROR_THRESHOLD, useServiceTable } from '@/data/services'
import { useWindow } from '@/lib/window'
import { placementSearch, usePlacement } from '@/data/placement'
import { PlacementPicker } from '@/components/ft/Placement'
import { because } from '@/auth/client'
import { useSettled } from '@/lib/settle'
import { cn } from '@/lib/utils'
import { Note, PagedFooter, PanelEmpty, Pill, Pills, SEARCH, SkeletonRows, Toolbar, usePaged } from './backend/kit'

const SORTS = [
  { value: 'err', label: 'Error rate' },
  { value: 'rps', label: 'Requests' },
  { value: 'p95', label: 'p95' },
  { value: 'name', label: 'Name' },
] as const

export function Services() {
  const { ms: windowMs, label } = useWindow()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'err' | 'rps' | 'p95' | 'name'>('err')
  const [hideEmpty, setHideEmpty] = useState(false)
  const route = useRouterNavigate()
  const environment = useSearchParam('env') ?? ''
  const [typedEnv, setTypedEnv] = useState(environment)
  const settledEnv = useSettled(typedEnv)
  const { placement, place } = usePlacement()
  const { services, pending, failed } = useServiceTable(settledEnv, windowMs, placement)
  const kept = { ...(settledEnv.trim() ? { env: settledEnv.trim() } : {}), ...placementSearch(placement) }
  useEffect(() => {
    if (settledEnv.trim() !== environment) void route({ to: '/services' as never, search: kept as never, replace: true })
  }, [settledEnv])
  const rows = useMemo(() => {
    const r = services.filter((s) => s.name.includes(q.trim()) && (!hideEmpty || s.err !== null))
    return [...r].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'rps' ? b.perSecond - a.perSecond : sort === 'p95' ? b.p95Us - a.p95Us : (b.err ?? -1) - (a.err ?? -1))
  }, [q, sort, hideEmpty, services])
  const paged = usePaged(rows, `${q}|${sort}|${hideEmpty}|${settledEnv}`)
  const pressured = services.filter((s) => (s.err ?? 0) >= ERROR_THRESHOLD).length
  return (
    <>
      <PageHeader title="Services" meta={<Pills><Pill>{services.length} {services.length === 1 ? 'service' : 'services'}</Pill>{pressured > 0 ? <Pill tone="err">{pressured} above {ERROR_THRESHOLD} % errors</Pill> : null}<Pill>last {label}</Pill></Pills>} />
      <Toolbar role="search">
        <InputGroup className={SEARCH}><Search aria-hidden /><input aria-label="Find service" placeholder="Find service" value={q} onChange={(e) => setQ(e.target.value)} /><Kbd>/</Kbd></InputGroup>
        <InputGroup className="w-[220px] max-w-full max-md:w-full"><input aria-label="Environment" placeholder="Environment, e.g. production" value={typedEnv} onChange={(e) => setTypedEnv(e.target.value)} /></InputGroup>
        <NativeSelect aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-auto max-md:flex-1">
          {SORTS.map((o) => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
        </NativeSelect>
        <span className="flex-1 max-md:hidden" />
        <Switch checked={hideEmpty} onCheckedChange={setHideEmpty} label="Hide services with no data" />
      </Toolbar>
      <PlacementPicker collapsible placement={placement} onChange={place} windowMs={windowMs} />
      {failed ? <EmptyState title="The services could not be read">{because(failed, 'The span store did not answer')}</EmptyState> : null}
      {!failed && !pending && services.length === 0 ? <EmptyState title={settledEnv.trim() ? `No services in ${settledEnv.trim()} in the last ${label}` : `No services in the last ${label}`} code="OTEL_SERVICE_NAME=checkout-api">A service appears as soon as one span it served arrives with a service.name. The environment filter reads the deployment.environment span attribute.</EmptyState> : null}
      {!failed && pending && services.length === 0 ? <Card className="overflow-hidden"><SkeletonRows label="Reading the services" /></Card> : null}
      <Card className={cn('overflow-hidden', services.length === 0 && 'hidden')}>
        <CardHeader><CardTitle>Services</CardTitle><CardKind>Table</CardKind><span className="text-caption text-muted-foreground">{rows.length} of {services.length}</span></CardHeader>
        {rows.length === 0 && services.length > 0 ? (
          <PanelEmpty icon={<SearchX />} title="No service matches" actions={<Button size="sm" onClick={() => { setQ(''); setHideEmpty(false) }}>Clear filters</Button>}>Try another name, or show the services with no data.</PanelEmpty>
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Services">
              <thead><tr><Th>Service</Th><Th numeric className="w-[100px]">Requests</Th><Th numeric className="w-[110px]">Error rate</Th><Th numeric className="w-[80px]">p50</Th><Th numeric className="w-[80px]">p95</Th><Th numeric className="w-[80px]">p99</Th><Th className="w-[120px]">Last span</Th></tr></thead>
              <tbody>
                {paged.shown.map((s) => {
                  const bad = (s.err ?? 0) >= ERROR_THRESHOLD
                  return (
                    <Tr key={s.name} className="cursor-pointer" onClick={() => void route({ to: `/services/${s.name}` as never, search: kept as never })}>
                      <Td><Link to={`/services/${s.name}`} search={kept} className="inline-flex items-center gap-2 text-foreground no-underline" onClick={(e) => e.stopPropagation()}><ServiceDot name={s.name} /><span className="font-mono font-semibold">{s.name}</span>{s.name.startsWith('unknown') ? <Badge variant="warning" size="xs">service.name not set</Badge> : null}</Link></Td>
                      <Td numeric>{s.rps}</Td>
                      <Td numeric className={cn(bad && 'font-semibold text-warning-text', s.err === null && 'text-muted-foreground')}><span className="inline-flex items-center gap-1">{bad ? <TriangleAlert className="size-3.5" aria-hidden /> : null}{s.err === null ? '—' : `${s.err.toFixed(1)} %`}</span></Td>
                      <Td numeric>{s.p50}</Td><Td numeric className={cn(bad && 'text-warning-text')}>{s.p95}</Td><Td numeric>{s.p99}</Td>
                      <Td className={cn('font-mono text-control', s.seen.includes('min') && 'text-muted-foreground')}>{s.seen}</Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </div>
        )}
        <PagedFooter paged={paged} noun="services" />
        <Note>From the <span className="font-mono">service.name</span> resource attribute of your spans. Requests and error rate count the server and consumer spans of each service: spans with status ERROR ÷ all of them. Amber from {ERROR_THRESHOLD} %, the status page threshold.</Note>
      </Card>
    </>
  )
}
