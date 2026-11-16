import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState, PageHeader } from '@/components/ft/bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardKind, CardTitle } from '@/components/ui/card'
import { Avatar, Table, Td, Th, Tr } from '@/components/ui/misc'
import { Segmented } from '@/components/ui/segmented'
import { personOf, type Person } from '@/data/incidents'
import { useMembers } from '@/data/members'
import { pageLink, pageStateVariant, useOnCallNow, usePages, useSchedules, useShifts, type Page, type Schedule } from '@/data/oncall'
import { initialsOf } from '@/data/profile'
import { dur, stamp } from '@/lib/format'
import { Link } from '@/lib/router'
import { cn } from '@/lib/utils'
import { DAY_MS, days, gaps, place, startOfDay } from './timeline'

const SPAN_DAYS = 14

type Named = Schedule & { teamName: string }

const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short' })
const dayOfMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const when = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const tint = (slot: number) => `var(--svc-${(slot % 8) + 1})`

function usePalette() {
  const { members } = useMembers()
  return useMemo(() => {
    const order = new Map((members ?? []).map((member, at) => [member.account, at]))
    return {
      slot: (account: string) => order.get(account) ?? [...account].reduce((sum, char) => sum + char.charCodeAt(0), 0),
      name: (account: string) => {
        const member = members?.find((one) => one.account === account)
        return member ? (member.name ?? member.email) : 'a former member'
      },
    }
  }, [members])
}

function NowCard({ schedule }: { schedule: Named }) {
  const { now, failed } = useOnCallNow(schedule.id)
  const who: Person | null = now?.account ?? null
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-md border bg-card px-4 py-3.5">
      <span className="flex items-center gap-2 text-caption text-muted-foreground">
        <CalendarClock className="size-3.5" aria-hidden />
        <span className="truncate font-semibold text-foreground">{schedule.name}</span>
        <span className="truncate">{schedule.teamName}</span>
        {who ? <span className="ml-auto flex shrink-0 items-center gap-1.5 font-medium text-success-text"><span className="size-1.5 rounded-full bg-status-ok" aria-hidden />On call</span> : null}
      </span>
      <span className="flex items-center gap-2.5">
        <Avatar initials={who ? initialsOf(personOf(who)) : '—'} className="size-8" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-semibold">{failed ? 'Could not read' : now === undefined ? '…' : personOf(who)}</span>
          <span className="text-caption text-faint-foreground">{now?.until_ms ? `until ${when.format(now.until_ms)}` : who ? 'no handoff planned' : 'nobody holds the pager'}</span>
        </span>
      </span>
    </div>
  )
}

function Lane({ schedule, fromMs, toMs, nowMs, first }: { schedule: Named; fromMs: number; toMs: number; nowMs: number; first: boolean }) {
  const { shifts, failed } = useShifts(schedule.id, fromMs, toMs)
  const palette = usePalette()
  const placed = place(shifts ?? [], fromMs, toMs)
  const holes = shifts ? place(gaps(shifts, Math.max(fromMs, nowMs), toMs), fromMs, toMs) : []
  const nowAt = (nowMs - fromMs) / (toMs - fromMs)
  return (
    <div className="grid grid-cols-[190px_minmax(0,1fr)] border-b last:border-b-0 max-md:grid-cols-[130px_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col justify-center border-r px-3.5 py-2">
        <span className="truncate font-semibold">{schedule.name}</span>
        <span className="truncate text-caption text-faint-foreground">{schedule.teamName} · every {schedule.length_days} {schedule.length_days === 1 ? 'day' : 'days'}</span>
      </div>
      <div className="relative h-[58px] bg-[repeating-linear-gradient(90deg,transparent_0,transparent_calc(100%/14_-_1px),var(--border)_calc(100%/14_-_1px),var(--border)_calc(100%/14))]">
        {failed ? <span className="absolute inset-0 flex items-center px-3 text-caption text-destructive-text">Shifts could not be read</span> : null}
        {placed.map((stint) => {
          const colour = tint(palette.slot(stint.account.id))
          const wide = stint.width > 0.09
          return (
            <span
              key={`${stint.from_ms}-${stint.account.id}`}
              title={`${personOf(stint.account)}${stint.cover ? ' (override)' : ''}, ${when.format(stint.from_ms)} to ${when.format(stint.to_ms)}`}
              className={cn('absolute flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border px-2 text-caption font-medium text-foreground', stint.cover ? 'inset-y-1.5 z-10 border-dashed' : 'inset-y-2.5 border-transparent')}
              style={{
                left: `${stint.left * 100}%`,
                width: `${stint.width * 100}%`,
                background: stint.cover ? `repeating-linear-gradient(135deg, color-mix(in srgb, ${colour} 30%, transparent) 0 6px, color-mix(in srgb, ${colour} 12%, transparent) 6px 12px)` : `color-mix(in srgb, ${colour} 20%, transparent)`,
                borderColor: stint.cover ? colour : undefined,
              }}
            >
              {stint.width > 0.025 ? <Avatar initials={initialsOf(personOf(stint.account))} className="size-[18px] text-[9px]" /> : null}
              {wide ? <span className="truncate">{personOf(stint.account)}</span> : null}
            </span>
          )
        })}
        {holes.map((hole) => (
          <span key={hole.from_ms} className="absolute inset-y-2.5 flex items-center overflow-hidden whitespace-nowrap rounded-md border border-dashed border-destructive-border px-2 text-caption font-medium text-destructive-text" style={{ left: `${hole.left * 100}%`, width: `${hole.width * 100}%` }}>
            {hole.width > 0.05 ? 'Nobody' : ''}
          </span>
        ))}
        {nowAt >= 0 && nowAt <= 1 ? (
          <span aria-hidden className="absolute inset-y-0 z-20 w-0.5 bg-destructive" style={{ left: `${nowAt * 100}%` }}>
            {first ? <span className="absolute left-1 top-0 rounded-sm bg-card px-1 font-mono text-[10px] font-semibold text-destructive-text">Now</span> : null}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function Timeline({ schedules }: { schedules: Named[] }) {
  const [shift, setShift] = useState(0)
  const nowMs = Date.now()
  const fromMs = startOfDay(nowMs) + shift * SPAN_DAYS * DAY_MS
  const columns = days(fromMs, SPAN_DAYS)
  const toMs = days(fromMs, SPAN_DAYS + 1)[SPAN_DAYS]
  const today = startOfDay(nowMs)
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Next {SPAN_DAYS} days</CardTitle>
        <CardKind>Timeline</CardKind>
        <span className="flex-1" />
        <Button size="sm" onClick={() => setShift(0)} disabled={shift === 0}>Today</Button>
        <Button size="icon-sm" aria-label="Previous two weeks" onClick={() => setShift(shift - 1)}><ChevronLeft /></Button>
        <Button size="icon-sm" aria-label="Next two weeks" onClick={() => setShift(shift + 1)}><ChevronRight /></Button>
        <span className="hidden text-control font-semibold sm:inline">{dayOfMonth.format(fromMs)} – {dayOfMonth.format(toMs - 1)}</span>
      </CardHeader>
      <div className="overflow-x-auto">
        <div className="min-w-[1000px]">
          <div className="grid h-11 grid-cols-[190px_minmax(0,1fr)] border-b max-md:grid-cols-[130px_minmax(0,1fr)]">
            <span className="border-r" />
            <div className="grid grid-cols-14">
              {columns.map((day) => {
                const weekend = [0, 6].includes(new Date(day).getDay())
                return (
                  <span key={day} className={cn('flex flex-col justify-center border-l px-2 text-[11px] leading-[15px] text-faint-foreground', weekend && 'bg-muted/40')}>
                    <span className={cn('text-caption font-semibold text-foreground', day === today && 'text-accent-text')}>{weekday.format(day)}</span>
                    {dayOfMonth.format(day)}
                  </span>
                )
              })}
            </div>
          </div>
          {schedules.map((schedule, at) => <Lane key={schedule.id} schedule={schedule} fromMs={fromMs} toMs={toMs} nowMs={nowMs} first={at === 0} />)}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 border-t px-3.5 py-2.5 text-caption text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-[18px] rounded-sm bg-muted" aria-hidden />Shift from the rotation</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-[18px] rounded-sm border border-dashed border-line-strong" aria-hidden />Override</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-[18px] rounded-sm border border-dashed border-destructive-border" aria-hidden />Nobody on call</span>
      </div>
    </Card>
  )
}

function Overrides({ schedules }: { schedules: Named[] }) {
  const palette = usePalette()
  const nowMs = Date.now()
  const rows = schedules
    .flatMap((schedule) => schedule.overrides.filter((cover) => cover.to_ms > nowMs).map((cover) => ({ cover, schedule })))
    .sort((a, b) => a.cover.from_ms - b.cover.from_ms)
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Overrides</CardTitle>
        <CardKind>Table</CardKind>
        <span className="flex-1" />
        <Link to="/settings/teams" className="text-control font-medium">Add in Teams</Link>
      </CardHeader>
      {rows.length === 0 ? (
        <p className="m-0 px-3.5 py-6 text-center text-control text-muted-foreground">No override planned.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead><tr><Th>Who covers</Th><Th>Schedule</Th><Th>From</Th><Th>To</Th></tr></thead>
            <tbody>
              {rows.map(({ cover, schedule }) => (
                <Tr key={cover.id}>
                  <Td><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: tint(palette.slot(cover.account)) }} aria-hidden />{palette.name(cover.account)}</span></Td>
                  <Td>{schedule.name}</Td>
                  <Td className="tabular">{when.format(cover.from_ms)}</Td>
                  <Td className="tabular">{when.format(cover.to_ms)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  )
}

function PageDetail({ page }: { page: Page }) {
  const link = pageLink(page)
  const facts: [string, React.ReactNode][] = [
    ['Source', page.source.kind === 'incident' ? 'Incident' : 'Alert rule'],
    ['Schedule', page.schedule.name ?? 'a deleted schedule'],
    ['Paged', personOf(page.target)],
    ['Step', page.step === 0 ? 'first person' : `escalated ${page.step} ${page.step === 1 ? 'time' : 'times'}`],
    ['Triggered', stamp(page.created_ms)],
    ['Escalates at', page.escalate_at_ms && page.state !== 'acknowledged' && page.state !== 'resolved' ? stamp(page.escalate_at_ms) : '—'],
    ['Acknowledged', page.acknowledged_ms ? `${stamp(page.acknowledged_ms)}, after ${dur(page.acknowledged_ms - page.created_ms)}` : '—'],
    ['Resolved', page.resolved_ms ? stamp(page.resolved_ms) : '—'],
  ]
  return (
    <Card className="min-w-0 self-start">
      <CardHeader>
        <CardTitle className="truncate">{page.headline}</CardTitle>
        <span className="flex-1" />
        <Badge variant={pageStateVariant(page.state)}>{page.state}</Badge>
      </CardHeader>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-3.5 py-3 text-control">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-faint-foreground">{label}</dt>
            <dd className="m-0 min-w-0 truncate">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t px-3.5 py-3">
        <Button asChild size="sm" variant="primary"><Link to={link.to} search={link.search}>{page.source.kind === 'incident' ? 'Open the incident' : 'Open the alert'}</Link></Button>
      </div>
    </Card>
  )
}

function Pages() {
  const { pages, nothing } = usePages('all')
  const [picked, setPicked] = useState<string | null>(null)
  const list = pages ?? []
  const shown = list.find((page) => page.id === picked) ?? list[0]
  if (nothing) return <EmptyState title="No page to show">{nothing}</EmptyState>
  if (list.length === 0) return <EmptyState icon={<CalendarClock />} title="Nobody has been paged">A page is sent when an alert or an incident asks for a schedule. It moves to the next person if nobody acknowledges it.</EmptyState>
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <Card className="min-w-0">
        <CardHeader><CardTitle>Pages</CardTitle><CardKind>Table</CardKind></CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <thead><tr><Th>Page</Th><Th>Status</Th><Th>Paged</Th><Th numeric>Step</Th><Th numeric>To acknowledge</Th><Th>When</Th></tr></thead>
            <tbody>
              {list.map((page) => (
                <Tr key={page.id} className={cn('cursor-pointer', page.id === shown?.id && '[&>td]:bg-accent-subtle')} onClick={() => setPicked(page.id)}>
                  <Td className="max-w-[320px] truncate font-medium text-accent-text">{page.headline}</Td>
                  <Td><Badge variant={pageStateVariant(page.state)}>{page.state}</Badge></Td>
                  <Td>{personOf(page.target)}</Td>
                  <Td numeric>{page.step + 1}</Td>
                  <Td numeric>{page.acknowledged_ms ? dur(page.acknowledged_ms - page.created_ms) : '—'}</Td>
                  <Td className="text-faint-foreground">{stamp(page.created_ms)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
      {shown ? <PageDetail page={shown} /> : null}
    </div>
  )
}

export function OnCallPage() {
  const { schedules } = useSchedules()
  const [view, setView] = useState<'schedules' | 'pages'>('schedules')
  return (
    <>
      <PageHeader title="On-call" meta={`${schedules.length} ${schedules.length === 1 ? 'schedule' : 'schedules'}`}>
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'schedules', label: 'Schedules' }, { value: 'pages', label: 'Pages' }]} />
        <Button asChild size="sm"><Link to="/settings/teams">Edit schedules in Teams</Link></Button>
      </PageHeader>
      {view === 'pages' ? <Pages /> : schedules.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title="No on-call schedule yet" actions={<Button asChild size="sm" variant="primary"><Link to="/settings/teams">Open Teams</Link></Button>}>
          A schedule belongs to a team: it says who holds the pager, in which order, and when the pager changes hands. Create one from the team in Settings, Teams.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {schedules.map((schedule) => <NowCard key={schedule.id} schedule={schedule} />)}
          </div>
          <Timeline schedules={schedules} />
          <Overrides schedules={schedules} />
        </>
      )}
    </>
  )
}
