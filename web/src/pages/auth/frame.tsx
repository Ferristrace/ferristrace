import { Logo } from '@/components/ft/Logo'

const POINTS = ['OpenTelemetry native', 'Alerts, on-call and status pages', 'MCP for your agents']

export function AuthFrame({ title, intro, children, footer }: { title: string; intro?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-background md:grid-cols-2">
      <div className="flex min-h-screen flex-col px-6 py-8 md:px-12">
        <div className="flex items-center gap-2.5 text-heading">
          <Logo className="size-7" />
          FerrisTrace
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="flex w-full max-w-[380px] flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h1 className="text-title">{title}</h1>
              {intro ? <p className="m-0 text-control text-muted-foreground">{intro}</p> : null}
            </div>
            {children}
            {footer ? <p className="m-0 text-caption text-muted-foreground">{footer}</p> : null}
          </div>
        </div>
      </div>
      <aside aria-hidden className="flex flex-col justify-center gap-6 border-l bg-card bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklab,var(--primary)_22%,transparent),transparent_65%)] px-16 py-12 max-md:hidden">
        <p className="m-0 max-w-[460px] text-[32px] font-semibold leading-10 tracking-[-0.01em]">See what broke, and why, before your users tell you.</p>
        <p className="m-0 max-w-[420px] text-body text-muted-foreground">Traces, logs, metrics and incidents for your services, on OpenTelemetry.</p>
        <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-control text-muted-foreground">
          {POINTS.map((point) => (
            <li key={point} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-primary" />{point}</li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
