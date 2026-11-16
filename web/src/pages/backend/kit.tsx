import { useEffect, useMemo, useState } from 'react'
import { Pager } from '@/components/ui/pager'
import { Skeleton } from '@/components/ui/misc'
import { pagesOf } from '@/lib/paging'
import { cn } from '@/lib/utils'

export const KPI_GRID = 'grid grid-cols-2 gap-3 md:grid-cols-4'

export const SEARCH = 'w-[320px] max-w-full max-md:w-full'

export function Pill({ children, tone }: { children: React.ReactNode; tone?: 'err' | 'warn' }) {
  return (
    <span className={cn('inline-flex h-5 items-center rounded-full border border-transparent bg-muted px-2 text-[11.5px] font-medium text-muted-foreground', tone === 'err' && 'border-destructive-border bg-destructive-subtle text-destructive-text', tone === 'warn' && 'border-warning-border bg-warning-subtle text-warning-text')}>
      {children}
    </span>
  )
}

export function Pills({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex flex-wrap items-center gap-2">{children}</span>
}

export function Toolbar({ children, className, ...p }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)} {...p}>{children}</div>
}

export function PanelToolbar({ children, className, ...p }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-wrap items-center gap-2 border-b px-3.5 py-2.5', className)} {...p}>{children}</div>
}

export function PanelEmpty({ icon, title, children, code, actions }: { icon?: React.ReactNode; title: string; children: React.ReactNode; code?: string; actions?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center gap-2.5 px-4 py-10 text-center">
      {icon ? <span className="text-muted-foreground [&_svg]:size-6">{icon}</span> : null}
      <h3 className="text-[14px] font-semibold">{title}</h3>
      <p className="m-0 text-control text-muted-foreground">{children}</p>
      {code ? <pre className="m-0 max-w-full overflow-x-auto whitespace-pre rounded-md border bg-muted px-3 py-2.5 text-left font-mono text-[12px] leading-5">{code}</pre> : null}
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  )
}

export function SkeletonRows({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true">
      <div className="flex h-9 items-center gap-6 border-b bg-panel-head px-3"><Skeleton className="w-24" /><Skeleton className="w-16" /><Skeleton className="w-16" /></div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-6 border-b border-border px-3 last:border-b-0">
          <Skeleton className={cn('w-40', i % 2 === 0 ? 'max-w-[40%]' : 'max-w-[55%]')} />
          <Skeleton className="w-14" />
          <Skeleton className="w-14" />
          <Skeleton className="w-14" />
        </div>
      ))}
    </div>
  )
}

export function usePaged<T>(rows: T[], resetKey: string, initial = 25) {
  const [size, setSize] = useState(initial)
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [resetKey, size])
  const at = Math.min(page, pagesOf(rows.length, size))
  const shown = useMemo(() => rows.slice((at - 1) * size, at * size), [rows, at, size])
  return { shown, page: at, size, total: rows.length, setPage, setSize }
}

export function PagedFooter({ paged, noun, className }: { paged: { page: number; size: number; total: number; setPage: (page: number) => void; setSize: (size: number) => void }; noun: string; className?: string }) {
  if (paged.total === 0) return null
  return <Pager className={cn('border-t', className)} total={paged.total} page={paged.page} size={paged.size} onPage={paged.setPage} onSize={paged.setSize} noun={noun} />
}

export const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="m-0 border-t px-3.5 py-2.5 text-caption text-muted-foreground">{children}</p>
)
