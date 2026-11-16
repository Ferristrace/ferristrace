import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PanelEmpty({ children = 'No data in this range', hint }: { children?: ReactNode; hint?: ReactNode }) {
  return (
    <div data-state="empty" role="status" className="flex h-full min-h-[80px] flex-col items-center justify-center gap-1 text-center">
      <span className="text-control font-semibold text-muted-foreground">{children}</span>
      {hint ? <span className="max-w-[320px] text-caption text-faint-foreground">{hint}</span> : null}
    </div>
  )
}

export function Filled({ children, className }: { children: ReactNode; className?: string }) {
  return <div data-state="data" className={cn('flex h-full min-h-0 min-w-0 flex-col', className)}>{children}</div>
}
