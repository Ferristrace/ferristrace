import { CardHeader, CardKind } from '@/components/ui/card'
import { SIGNAL_COLOUR } from './colours'
import type { Quota } from './shape'

const FILL = { err: 'var(--destructive-text)', warn: 'var(--warning-text)' }

export function QuotaBars({ title, quotas }: { title: string; quotas: Quota[] }) {
  return (
    <figure className="m-0 flex min-w-0 flex-col rounded-md border bg-card">
      <figcaption>
        <CardHeader className="flex-wrap gap-y-0.5">
          <span className="min-w-0 text-[13px] font-semibold leading-5">{title}</span>
          <CardKind>Bar</CardKind>
        </CardHeader>
      </figcaption>
      <ul className="m-0 flex list-none flex-col gap-5 p-4">
        {quotas.map((quota) => (
          <li key={quota.signal} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <span className="flex-1 text-control font-semibold">{quota.label}</span>
              <span className="font-mono text-control tabular-nums">{quota.used}</span>
              {quota.included ? <span className="font-mono text-caption text-muted-foreground tabular-nums">of {quota.included}</span> : null}
            </div>
            {quota.share === null ? null : (
              <div className="h-2 overflow-hidden rounded bg-muted" role="img" aria-label={`${quota.label}: ${quota.share.toFixed(0)} percent of what is included`}>
                <div className="h-full rounded" style={{ width: `${Math.min(100, quota.share)}%`, background: quota.tone ? FILL[quota.tone] : SIGNAL_COLOUR[quota.signal] }} />
              </div>
            )}
            <span className="text-caption text-muted-foreground">{quota.note}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}
