import { AlertTriangle, CircleCheck, EyeOff, RotateCcw, Waypoints } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from '@/lib/router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/input'
import { Alert, Skeleton, Table, Td, Th, Tr } from '@/components/ui/misc'
import { ServiceDot } from '@/components/ft/bits'
import { because } from '@/auth/client'
import { useMembers } from '@/data/members'
import { nameOf } from '@/data/profile'
import {
  RANGES,
  shortPrint,
  useDecide,
  useIssue,
  useOccurrences,
  type Issue,
  type IssueStatus,
} from '@/data/issues'
import { stamp } from '@/lib/format'
import { sorted, toggled, type Sorting } from '@/lib/sorting'
import { cn } from '@/lib/utils'
import { occurrenceValue, type OccurrenceKey } from './alerting/sorting'
import { SortHead } from './alerting/SortHead'
import { useOwners } from './Issues'

const A_DAY = 24 * 60 * 60 * 1000

export function IssueDetail() {
  const { id } = useParams()
  const [rangeMs, setRangeMs] = useState(A_DAY)
  const { issue, nothing, failed } = useIssue(id, rangeMs)

  if (!issue) {
    return (
      <>
        <nav aria-label="Breadcrumb" className="text-control">
          <Link to="/issues">Issues</Link>
          <span className="text-faint-foreground"> / </span>
          <span className="font-mono">{id ? shortPrint(id) : '—'}</span>
        </nav>
        {failed ? (
          <Alert variant="warning" icon={<AlertTriangle />}>
            {because(failed, nothing)}
          </Alert>
        ) : (
          <Skeleton className="w-64" />
        )}
      </>
    )
  }
  return <Known issue={issue} rangeMs={rangeMs} onRange={setRangeMs} />
}

function Known({
  issue,
  rangeMs,
  onRange,
}: {
  issue: Issue
  rangeMs: number
  onRange: (ms: number) => void
}) {
  const { members } = useMembers()
  const owner = useOwners()
  const decide = useDecide()
  const { occurrences, asking } = useOccurrences(issue, rangeMs)
  const latest = occurrences[0]
  const [sorting, setSorting] = useState<Sorting<OccurrenceKey> | null>(null)
  const listed = sorted(occurrences, sorting, occurrenceValue)
  const dirOf = (key: OccurrenceKey) => (sorting?.key === key ? sorting.dir : null)

  const set = (said: { status?: IssueStatus; owner?: string | null }, told: string) =>
    decide.mutate(
      { issue, ...said },
      {
        onSuccess: () => toast.success(told),
        onError: (refused) => toast.error(because(refused, 'Nothing was changed')),
      },
    )

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-control">
        <Link to="/issues">Issues</Link>
        <span className="text-faint-foreground"> / </span>
        <span className="font-mono">{shortPrint(issue.fingerprint)}</span>
      </nav>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-title">{issue.exception_type || 'Exception'}</h1>
        {issue.regressed ? <Badge variant="warning">Regressed</Badge> : null}
        {issue.status === 'resolved' ? (
          <Badge variant="success">
            <CircleCheck />
            Resolved
          </Badge>
        ) : issue.status === 'ignored' ? (
          <Badge variant="outline">
            <EyeOff />
            Ignored
          </Badge>
        ) : (
          <Badge variant="destructive">Unresolved</Badge>
        )}
        <span className="rounded-full bg-muted px-2 text-caption font-medium leading-5 text-muted-foreground">
          {issue.events.toLocaleString('en-US')} events
        </span>
        <span className="flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label="Window"
            className="w-[150px]"
            value={String(rangeMs)}
            onChange={(event) => onRange(Number(event.target.value))}
          >
            {RANGES.map(([label, ms]) => (
              <option key={label} value={ms}>
                Last {label}
              </option>
            ))}
          </NativeSelect>
          {issue.status === 'unresolved' ? (
            <>
              <Button size="sm" onClick={() => set({ status: 'ignored' }, 'Issue ignored')}>
                <EyeOff />
                Ignore
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={decide.isPending}
                onClick={() => set({ status: 'resolved' }, 'Issue resolved')}
              >
                <CircleCheck />
                Resolve
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => set({ status: 'unresolved' }, 'Issue reopened')}>
              <RotateCcw />
              Reopen
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-body">{issue.message}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ServiceDot name={issue.service} />
            {issue.service}
          </span>
          <span aria-hidden>·</span>
          <span className="break-all font-mono">{issue.fingerprint}</span>
        </span>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3 max-lg:order-2">
          {latest?.stacktrace ? (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="flex-1">Stack trace</CardTitle>
                <span className="text-caption text-muted-foreground">as the sdk sent it</span>
              </CardHeader>
              <div className="border-b border-border-subtle bg-destructive-subtle px-4 py-2.5 font-mono text-control text-destructive-text">
                {latest.exception_type}: {latest.message}
              </div>
              <pre className="m-3 overflow-x-auto rounded-md border bg-background p-3 font-mono text-[12px] leading-5">
                {latest.stacktrace}
              </pre>
            </Card>
          ) : null}
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Occurrences</CardTitle>
              <CardKind>Table</CardKind>
              <span className="flex-1" />
              <span className="text-caption text-muted-foreground">{sorting ? 'sorted by the column you chose' : 'most recent first'}</span>
            </CardHeader>
            <div className="overflow-x-auto">
              <Table aria-label="Occurrences" className="min-w-[560px]">
                <thead>
                  <tr>
                    <SortHead label="Time" dir={dirOf('time')} onSort={() => setSorting((was) => toggled(was, 'time'))} className="w-[170px]" />
                    <SortHead label="Trace" dir={dirOf('trace')} onSort={() => setSorting((was) => toggled(was, 'trace', 'asc'))} className="w-[180px]" />
                    <SortHead label="Message" dir={dirOf('message')} onSort={() => setSorting((was) => toggled(was, 'message', 'asc'))} />
                    <Th className="w-[110px]">
                      <span className="sr-only">Links</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {asking ? (
                    <Tr>
                      <Td colSpan={4}>
                        <Skeleton className="w-48" />
                      </Td>
                    </Tr>
                  ) : occurrences.length === 0 ? (
                    <Tr>
                      <Td colSpan={4} className="text-muted-foreground">
                        No occurrence in this window.
                      </Td>
                    </Tr>
                  ) : (
                    listed.map((seen) => (
                      <Tr key={`${seen.trace_id}-${seen.span_id}-${seen.at_ms}`}>
                        <Td className="font-mono">{stamp(seen.at_ms)}</Td>
                        <Td>
                          <Link to={`/traces/${seen.trace_id}`} className="font-mono">
                            {shortPrint(seen.trace_id)}…{seen.trace_id.slice(-4)}
                          </Link>
                        </Td>
                        <Td className="max-w-[320px] truncate">{seen.message}</Td>
                        <Td numeric>
                          <Button asChild variant="ghost" size="sm">
                            <Link to={`/traces/${seen.trace_id}`}>
                              <Waypoints />
                              Trace
                            </Link>
                          </Button>
                        </Td>
                      </Tr>
                    ))
                  )}
                </tbody>
              </Table>
            </div>
          </Card>
        </div>
        <Card className="max-lg:order-1">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <dl className="m-0 flex flex-col gap-2.5 p-3.5 text-control">
            <Detail label="First seen" value={stamp(issue.first_seen_at_ms)} mono />
            <Detail label="Last seen" value={stamp(issue.last_seen_at_ms)} mono />
            <Detail label="Events" value={`${issue.events.toLocaleString('en-US')} in this window`} />
            <Detail label="Service" value={issue.service} />
            <Detail
              label="Decided"
              value={issue.decided_at_ms ? stamp(issue.decided_at_ms) : 'never'}
              mono={issue.decided_at_ms > 0}
            />
            <Detail label="Assignee" value={owner(issue.owner) ?? 'Unassigned'} />
            <NativeSelect
              aria-label="Owner"
              value={issue.owner ?? ''}
              onChange={(event) =>
                set(
                  { owner: event.target.value || null },
                  event.target.value ? 'Owner set' : 'Owner cleared',
                )
              }
            >
              <option value="">Unassigned</option>
              {(members ?? []).map((one) => (
                <option key={one.account} value={one.account}>
                  {nameOf(one)}
                </option>
              ))}
            </NativeSelect>
            {latest ? (
              <Button asChild size="sm" className="mt-1 w-full justify-start">
                <Link to={`/traces/${latest.trace_id}`}>
                  <Waypoints />
                  Open latest trace
                </Link>
              </Button>
            ) : null}
          </dl>
        </Card>
      </div>
      <p className="m-0 text-caption text-muted-foreground">
        The stack trace is the string the sdk recorded on the exception. FerrisTrace holds no source
        and no source maps, so there is no code to show around a frame. Resolving an issue keeps its
        owner; an occurrence after that marks it Regressed without reopening it.
      </p>
    </>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('m-0 min-w-0 text-right', mono && 'font-mono text-caption')}>
        {value}
      </dd>
    </div>
  )
}
