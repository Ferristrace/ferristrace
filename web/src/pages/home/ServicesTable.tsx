import { SafeLink } from '@/components/ft/panels/SafeLink'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, Td, Th, Tr } from '@/components/ui/misc'
import type { Release } from '@/data/releases'
import { cn } from '@/lib/utils'
import { linkOf, withSearch } from './attention'
import { heat, lastRelease, worst, type Heat, type ServiceRow } from './hub'

const HEAT: Record<Heat, string> = { bad: 'font-semibold text-destructive-text', mid: 'font-semibold text-warning-text', none: '' }

const cell = 'h-11 px-3.5'

const note = 'm-0 px-3.5 py-3 text-control text-muted-foreground'

export function ServicesTable({ services, total, releases, pending, failed, place, now }: { services: ServiceRow[]; total: number; releases: Release[]; pending: boolean; failed: boolean; place: Record<string, string>; now: number }) {
  const rows = worst(services)
  const all = linkOf(withSearch('/services', place))
  return (
    <section aria-labelledby="home-services" className="col-span-full min-w-0">
      <Card className="flex flex-col overflow-hidden rounded-sm">
        <CardHeader>
          <CardTitle id="home-services" className="flex-1">Services by error rate</CardTitle>
          <SafeLink to={all.path} search={all.search} className="text-caption font-medium text-accent-text no-underline hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center">
            {total > 0 ? `All ${total.toLocaleString('en-US')} ${total === 1 ? 'service' : 'services'}` : 'All services'}
          </SafeLink>
        </CardHeader>
        {failed ? (
          <p className={note}>Could not read the services.</p>
        ) : pending ? (
          <p className={note}>Reading the services…</p>
        ) : rows.length === 0 ? (
          <p className={note}>No request in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[540px] text-body tabular">
              <thead>
                <tr>
                  <Th className={cn(cell, 'text-body')}>Application</Th>
                  <Th numeric className={cn(cell, 'text-body')}>p99 latency</Th>
                  <Th numeric className={cn(cell, 'text-body')}>Error rate</Th>
                  <Th numeric className={cn(cell, 'text-body')}>Requests per second</Th>
                  <Th numeric className={cn(cell, 'text-body')}>Last release</Th>
                </tr>
              </thead>
              <tbody className="[&>tr:last-child>td]:border-b-0">
                {rows.map((service) => {
                  const to = linkOf(withSearch(`/services/${encodeURIComponent(service.name)}`, place))
                  const release = lastRelease(service.name, releases, now)
                  return (
                    <Tr key={service.name}>
                      <Td className={cell}>
                        <SafeLink to={to.path} search={to.search} className="font-medium text-accent-text no-underline hover:underline focus-visible:outline-2 focus-visible:outline-ring">{service.name}</SafeLink>
                      </Td>
                      <Td className={cn(cell, 'text-right')}>{service.p99}</Td>
                      <Td className={cn(cell, 'text-right', HEAT[heat(service.err)])}>{service.err === null ? '—' : `${service.err.toFixed(2)} %`}</Td>
                      <Td className={cn(cell, 'text-right')}>{service.perSecond.toFixed(2)}</Td>
                      <Td className={cn(cell, 'text-right text-faint-foreground')}>{release ?? '—'}</Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </section>
  )
}
