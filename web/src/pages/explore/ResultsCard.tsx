import { Card, CardHeader, CardTitle } from '@/components/ui/card'

export function ResultsCard({ title, note, children }: { title: React.ReactNode; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {note ? <span className="ml-auto text-caption text-muted-foreground">{note}</span> : null}
      </CardHeader>
      {children}
    </Card>
  )
}

export function TimelineBar({ share, failed }: { share: number; failed: boolean }) {
  return (
    <div className="h-2 w-full min-w-[120px] overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className={failed ? 'h-full rounded-full bg-destructive' : 'h-full rounded-full bg-primary'} style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
    </div>
  )
}
