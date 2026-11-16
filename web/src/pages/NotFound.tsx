import { Logo } from '@/components/ft/Logo'
import { Link } from '@/lib/router'
import { Button } from '@/components/ui/button'

export function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
      <Logo className="size-7" />
      <span className="text-[56px] font-semibold leading-none text-faint-foreground">404</span>
      <h1 className="text-heading">This page does not exist</h1>
      <p className="m-0 max-w-[420px] text-control text-muted-foreground">The link may be old, or the trace was deleted by retention.</p>
      <Button asChild variant="primary"><Link to="/">Back to Overview</Link></Button>
    </div>
  )
}
