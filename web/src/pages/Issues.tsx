import { Bug, CircleCheck, EyeOff, RotateCcw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@/lib/router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InputGroup, NativeSelect } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Avatar, Table, Td, Th } from '@/components/ui/misc'
import { Pager } from '@/components/ui/pager'
import { EmptyState, PageHeader, ServiceDot } from '@/components/ft/bits'
import { useMembers } from '@/data/members'
import { nameOf, initialsOf } from '@/data/profile'
import {
  ANY,
  COUNTS,
  RANGES,
  shortPrint,
  useDecide,
  useIssues,
  type Issue,
  type IssueStatus,
} from '@/data/issues'
import { stamp } from '@/lib/format'
import { pagesOf } from '@/lib/paging'
import { cn } from '@/lib/utils'

const TABS: [IssueStatus, string][] = [
  ['unresolved', 'Unresolved'],
  ['resolved', 'Resolved'],
  ['ignored', 'Ignored'],
]

export function useOwners() {
  const { members } = useMembers()
  return (account: string | null) => {
    if (!account) return null
    const held = members?.find((one) => one.account === account)
    return held ? nameOf(held) : account.slice(0, 8)
  }
}

export function Issues() {
  const [sift, setSift] = useState(ANY)
  const { issues, loading, nothing, failed } = useIssues(sift)
  const { members } = useMembers()
  const decide = useDecide()
  const owner = useOwners()
  const navigate = useNavigate()
  const [tab, setTab] = useState<IssueStatus>('unresolved')
  const [sort, setSort] = useState<'last' | 'events'>('last')
  const [sel, setSel] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)

  const count = (status: IssueStatus) => issues.filter((one) => one.status === status).length
  const rows = useMemo(() => {
    const kept = issues.filter((one) => one.status === tab)
    return sort === 'events' ? [...kept].sort((a, b) => b.events - a.events) : kept
  }, [issues, tab, sort])
  const services = [...new Set(issues.map((one) => one.service))].sort()
  const current = Math.min(page, pagesOf(rows.length, size))
  const shown = rows.slice((current - 1) * size, current * size)
  const allSel = shown.length > 0 && shown.every((one) => sel.includes(one.fingerprint))

  const bulk = (said: { status?: IssueStatus; owner?: string | null }, told: string) => {
    const chosen = rows.filter((one) => sel.includes(one.fingerprint))
    Promise.all(chosen.map((issue) => decide.mutateAsync({ issue, ...said })))
      .then(() => toast.success(told, { description: `${chosen.length} issue${chosen.length > 1 ? 's' : ''}` }))
      .catch(() => toast.error('Nothing was changed'))
    setSel([])
  }

  return (
    <>
      <PageHeader
        title="Issues"
        meta={
          <span className="rounded-full bg-muted px-2 text-caption font-medium leading-5 text-muted-foreground">
            {count('unresolved')} open
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-2" role="search">
        <InputGroup className="w-[320px] max-w-full max-md:w-full">
          <Search aria-hidden />
          <input
            aria-label="Search issues"
            placeholder="Search the type or the message"
            value={sift.q}
            onChange={(event) => {
              setSift((was) => ({ ...was, q: event.target.value }))
              setPage(1)
            }}
          />
        </InputGroup>
        <NativeSelect
          aria-label="Status"
          value={tab}
          onChange={(event) => {
            setTab(event.target.value as IssueStatus)
            setSel([])
            setPage(1)
          }}
          className="w-[170px]"
        >
          {TABS.map(([value, label]) => (
            <option key={value} value={value}>
              Status: {label.toLowerCase()} ({count(value)})
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Service"
          value={sift.service}
          onChange={(event) => {
            setSift((was) => ({ ...was, service: event.target.value }))
            setPage(1)
          }}
          className="w-[190px]"
        >
          <option value="">Service: any</option>
          {services.map((service) => (
            <option key={service}>{service}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Window"
          value={String(sift.rangeMs)}
          onChange={(event) => {
            setSift((was) => ({ ...was, rangeMs: Number(event.target.value) }))
            setPage(1)
          }}
          className="w-[150px]"
        >
          {RANGES.map(([label, ms]) => (
            <option key={label} value={ms}>
              Last {label}
            </option>
          ))}
        </NativeSelect>
        <span className="flex-1 max-md:hidden" />
        <NativeSelect
          aria-label="Sort"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as typeof sort)
            setPage(1)
          }}
          className="w-[170px]"
        >
          <option value="last">Sort: last seen</option>
          <option value="events">Sort: events</option>
        </NativeSelect>
        <NativeSelect
          aria-label="Rows"
          value={String(sift.limit)}
          onChange={(event) => {
            setSift((was) => ({ ...was, limit: Number(event.target.value) }))
            setPage(1)
          }}
          className="w-[110px]"
        >
          {COUNTS.map((many) => (
            <option key={many} value={many}>
              {many} rows
            </option>
          ))}
        </NativeSelect>
      </div>
      {sel.length ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border bg-accent-subtle px-3 py-2 text-control"
          role="toolbar"
          aria-label="Bulk actions"
        >
          <span className="font-semibold text-accent-text">{sel.length} selected</span>
          <span className="flex-1" />
          {tab === 'unresolved' ? (
            <>
              <Button size="sm" onClick={() => bulk({ status: 'resolved' }, 'Resolved')}>
                <CircleCheck />
                Resolve
              </Button>
              <Button size="sm" onClick={() => bulk({ status: 'ignored' }, 'Ignored')}>
                <EyeOff />
                Ignore
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => bulk({ status: 'unresolved' }, 'Reopened')}>
              <RotateCcw />
              Reopen
            </Button>
          )}
          <NativeSelect
            aria-label="Assign selected"
            className="h-7 w-[180px]"
            value=""
            onChange={(event) =>
              event.target.value && bulk({ owner: event.target.value }, 'Assigned')
            }
          >
            <option value="">Assign to…</option>
            {(members ?? []).map((one) => (
              <option key={one.account} value={one.account}>
                {nameOf(one)}
              </option>
            ))}
          </NativeSelect>
          <Button variant="ghost" size="sm" onClick={() => setSel([])}>
            Clear
          </Button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon={<Bug />} title={failed ? 'Issues could not be read' : `No ${tab} issues`}>
          {failed || loading
            ? nothing
            : sift.q || sift.service
              ? 'No issue matches these filters in this window.'
              : 'An exception recorded on a span shows up here within a minute of happening.'}
        </EmptyState>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table aria-label="Issues" className="min-w-[760px]">
                <thead>
                  <tr>
                    <Th className="w-[40px]">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={allSel}
                        onChange={() => setSel(allSel ? [] : shown.map((one) => one.fingerprint))}
                        className="size-4 accent-[var(--primary)]"
                      />
                    </Th>
                    <Th>Issue</Th>
                    <Th className="w-[180px]">Service</Th>
                    <Th numeric className="w-[90px]">
                      Events
                    </Th>
                    <Th className="w-[170px]">Last seen</Th>
                    <Th className="w-[70px]">Owner</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((issue) => (
                    <Row
                      key={issue.fingerprint}
                      issue={issue}
                      owner={owner(issue.owner)}
                      chosen={sel.includes(issue.fingerprint)}
                      onChoose={() =>
                        setSel((held) =>
                          held.includes(issue.fingerprint)
                            ? held.filter((one) => one !== issue.fingerprint)
                            : [...held, issue.fingerprint],
                        )
                      }
                      onOpen={() => navigate(`/issues/${issue.fingerprint}`)}
                    />
                  ))}
                </tbody>
              </Table>
            </div>
            <Pager
              total={rows.length}
              page={current}
              size={size}
              onPage={setPage}
              onSize={(many) => {
                setSize(many)
                setPage(1)
              }}
              noun="issues"
              className="border-t"
            />
          </Card>
          <p className="m-0 text-caption text-muted-foreground">
            An issue groups exceptions that share a service, a type and a message whose digits,
            identifiers and quoted values have been normalised away. A resolved issue seen again is
            marked Regressed.
          </p>
        </>
      )}
    </>
  )
}

function Row({
  issue,
  owner,
  chosen,
  onChoose,
  onOpen,
}: {
  issue: Issue
  owner: string | null
  chosen: boolean
  onChoose: () => void
  onOpen: () => void
}) {
  return (
    <tr
      onClick={onOpen}
      className={cn('cursor-pointer hover:[&>td]:bg-row-hover', chosen && '[&>td]:bg-accent-subtle')}
    >
      <Td onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${issue.exception_type}`}
          checked={chosen}
          onChange={onChoose}
          className="size-4 accent-[var(--primary)]"
        />
      </Td>
      <Td className="max-w-[420px] whitespace-normal py-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <Link
              to={`/issues/${issue.fingerprint}`}
              onClick={(event) => event.stopPropagation()}
              className="font-semibold text-accent-text"
            >
              {issue.exception_type || 'Exception'}
            </Link>
            {issue.regressed ? (
              <Badge variant="warning" size="xs">
                Regressed
              </Badge>
            ) : null}
          </span>
          <span className="truncate text-control">{issue.message}</span>
          <span className="flex flex-wrap gap-x-2 text-caption text-muted-foreground">
            <span className="font-mono">{shortPrint(issue.fingerprint)}</span>
            <span aria-hidden>·</span>
            <span>first {stamp(issue.first_seen_at_ms)}</span>
          </span>
        </div>
      </Td>
      <Td>
        <span className="inline-flex items-center gap-1.5">
          <ServiceDot name={issue.service} />
          {issue.service}
        </span>
      </Td>
      <Td numeric>{issue.events.toLocaleString('en-US')}</Td>
      <Td className="font-mono text-control">{stamp(issue.last_seen_at_ms)}</Td>
      <Td>
        {owner ? (
          <span title={owner}>
            <Avatar initials={initialsOf(owner)} className="size-6 text-[10px]" />
          </span>
        ) : (
          <span className="text-caption text-faint-foreground">—</span>
        )}
      </Td>
    </tr>
  )
}
