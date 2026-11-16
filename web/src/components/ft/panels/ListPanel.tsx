import { SeverityBadge } from '@/components/ft/bits'
import { shortId } from '@/lib/format'
import type { Sev } from '@/lib/otel'
import { Filled, PanelEmpty } from './Empty'
import { clockOf } from './geometry'
import { isEmpty } from './result'
import { SafeLink } from './SafeLink'
import type { Of, PanelProps } from './types'

const TIME = ['timestamp', 'time', 'ts']
const MAIN = ['body', 'message', 'name', 'exception_message']
const SEVERITIES: string[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']

const asNs = (value: number): number => (value > 1e17 ? value : value * 1e6)

export function ListPanel({ result }: PanelProps<Of<'rows'>>) {
  if (isEmpty(result)) return <PanelEmpty />
  const at = (name: string) => result.columns.findIndex((column) => column.toLowerCase() === name)
  const time = TIME.map(at).find((index) => index >= 0) ?? -1
  const main = MAIN.map(at).find((index) => index >= 0) ?? -1
  const severity = at('severity')
  const trace = at('trace_id')
  return (
    <Filled className="gap-1.5">
      <ol aria-label="Records" className="m-0 flex min-h-0 flex-1 list-none flex-col overflow-auto p-0">
        {result.rows.map((row, index) => {
          const level = severity >= 0 ? String(row[severity] ?? '').toLowerCase() : ''
          const trail = result.columns.flatMap((column, position) => {
            if (position === time || position === main || position === severity || position === trace) return []
            const cell = row[position]
            return cell === null || cell === undefined || cell === '' ? [] : [`${column}=${String(cell)}`]
          })
          const traceId = trace >= 0 ? String(row[trace] ?? '') : ''
          const stamp = time >= 0 && typeof row[time] === 'number' ? clockOf(asNs(row[time] as number)) : time >= 0 ? String(row[time] ?? '') : ''
          return (
            <li key={index} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border-subtle py-1.5 text-control last:border-b-0">
              {stamp ? <time className="font-mono text-caption text-faint-foreground">{stamp}</time> : null}
              {SEVERITIES.includes(level) ? <SeverityBadge level={level as Sev} /> : null}
              {main >= 0 ? <span className="min-w-0 break-words">{String(row[main] ?? '')}</span> : null}
              {traceId ? <SafeLink to={`/traces/${encodeURIComponent(traceId)}`} className="font-mono text-caption text-accent-text" aria-label={`Open trace ${traceId}`}>{shortId(traceId)}</SafeLink> : null}
              {trail.length > 0 ? <span className="w-full truncate font-mono text-caption text-muted-foreground">{trail.join('  ')}</span> : null}
            </li>
          )
        })}
      </ol>
      {result.truncated ? (
        <p role="status" className="m-0 rounded-sm bg-warning-subtle px-2 py-1 text-caption text-warning-text">
          Showing the first {result.rows.length.toLocaleString('en-US')} records; the query matched more.
        </p>
      ) : null}
    </Filled>
  )
}
