import { useState } from 'react'
import { useOrganisations } from '@/auth/session'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/input'
import { Pager } from '@/components/ui/pager'
import { Table, Td, Tr } from '@/components/ui/misc'
import { AUDIT_ACTIONS, OPERATOR, actorName, useAuditLog, type AuditEntry, type AuditFilter } from '@/data/audit'
import { useMembers } from '@/data/members'
import { stamp } from '@/lib/format'
import { pagesOf } from '@/lib/paging'
import { sorted } from '@/lib/sorting'
import { FiltersBar } from '../FiltersBar'
import { useSortState } from '../useSortState'
import { SortHead } from '../SortHead'
import { H } from './parts'

function details(entry: AuditEntry) {
  return Object.entries(entry.detail)
    .map(([key, value]) => `${key}: ${value ?? '—'}`)
    .join(' · ')
}

export function AuditLog() {
  const { active } = useOrganisations()
  const mayRead = active?.role === 'owner' || active?.role === 'admin'
  const [filter, setFilter] = useState<AuditFilter>({ action: '', actor: '' })
  const { entries, nothing, more, loadingMore } = useAuditLog(filter, mayRead)
  const { members } = useMembers()
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)
  const { sorting, dir, on } = useSortState<'time' | 'actor' | 'action' | 'target' | 'detail'>()
  const roll = sorted(entries ?? [], sorting, (e, key) =>
    key === 'time' ? e.at_ms : key === 'actor' ? actorName(e) : key === 'action' ? e.action : key === 'target' ? `${e.target.kind} ${e.target.id ?? ''}` : details(e),
  )
  const current = Math.min(page, pagesOf(roll.length, size))
  const visible = roll.slice((current - 1) * size, current * size)

  if (!mayRead) {
    return (
      <>
        <H title="Audit log" sub="Who changed what in the organisation, and when." />
        <Card className="px-4 py-3 text-control text-muted-foreground">Only an owner or an administrator can read the audit log.</Card>
      </>
    )
  }

  return (
    <>
      <H title="Audit log" sub="Every change to the organisation, its projects, teams, members and keys, newest first." />
      <FiltersBar active={(filter.action ? 1 : 0) + (filter.actor ? 1 : 0)}>
        <NativeSelect aria-label="Action" value={filter.action} onChange={(e) => { setFilter((now) => ({ ...now, action: e.target.value })); setPage(1) }} className="w-[220px] max-md:flex-1">
          <option value="">Action: any</option>
          {AUDIT_ACTIONS.map((action) => <option key={action} value={action}>{action}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Actor" value={filter.actor} onChange={(e) => { setFilter((now) => ({ ...now, actor: e.target.value })); setPage(1) }} className="w-[220px] max-md:flex-1">
          <option value="">Actor: anyone</option>
          <option value={OPERATOR}>Operator (command line)</option>
          {(members ?? []).map((member) => <option key={member.account} value={member.account}>{member.email}</option>)}
        </NativeSelect>
      </FiltersBar>
      <Card className="overflow-x-auto">
        {entries ? (
          <Table>
            <thead><tr><SortHead label="Time" dir={dir('time')} onSort={on('time', 'desc')} className="w-[170px]" /><SortHead label="Actor" dir={dir('actor')} onSort={on('actor')} className="w-[200px]" /><SortHead label="Action" dir={dir('action')} onSort={on('action')} className="w-[190px]" /><SortHead label="Target" dir={dir('target')} onSort={on('target')} className="w-[220px]" /><SortHead label="Detail" dir={dir('detail')} onSort={on('detail')} /></tr></thead>
            <tbody>
              {roll.length === 0 ? <Tr><Td colSpan={5} className="text-muted-foreground">Nothing has been recorded{filter.action || filter.actor ? ' for this filter' : ' yet'}.</Td></Tr> : null}
              {visible.map((entry) => (
                <Tr key={entry.id}>
                  <Td className="font-mono">{stamp(entry.at_ms)}</Td>
                  <Td><span className="flex items-center gap-2">{actorName(entry)}{entry.actor.kind === 'api_key' ? <Badge variant="outline">key</Badge> : null}{entry.actor.kind === 'agent' ? <Badge variant="accent">agent</Badge> : null}</span></Td>
                  <Td className="font-mono">{entry.action}</Td>
                  <Td><span className="flex items-center gap-2"><Badge variant="outline">{entry.target.kind}</Badge><span className="truncate font-mono text-caption text-muted-foreground">{entry.target.id ?? ''}</span></span></Td>
                  <Td className="max-w-[360px] truncate text-caption text-muted-foreground" title={details(entry)}>{details(entry)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : <div className="px-4 py-3 text-control text-muted-foreground">{nothing}</div>}
      </Card>
      {roll.length > 10 ? <Pager total={roll.length} page={current} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1) }} noun={more ? 'entries loaded' : 'entries'} /> : null}
      {more ? <div><Button size="sm" disabled={loadingMore} onClick={more}>{loadingMore ? 'Loading…' : 'Load more'}</Button></div> : null}
    </>
  )
}
