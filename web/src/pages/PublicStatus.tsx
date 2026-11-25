import { useEffect, useState } from 'react'
import { ApiError } from '@/auth/client'
import { StatusPageView } from '@/components/ft/StatusPageView'
import { Markdown } from '@/lib/markdown'
import { useParams, useSearchParam } from '@/lib/router'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { resolveStatusDark, usePublicPostmortem, usePublicStatus, useSubscribe, type Theme } from '@/data/status-page'

const NOTICES: Record<string, string> = {
  confirmed: 'Your subscription is confirmed. You will get an email when an incident is posted here.',
  unsubscribed: 'You are unsubscribed and will not get emails from this page any more.',
}

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function usePublicTheme(theme: Theme | undefined) {
  const { dark: appDark } = useTheme()
  const [sysDark, setSysDark] = useState(systemPrefersDark)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setSysDark(mq.matches)
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  const dark = resolveStatusDark(theme?.mode, sysDark)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    return () => {
      document.documentElement.classList.toggle('dark', appDark)
    }
  }, [dark, appDark])
  return cn(dark ? 'dark' : 'light', theme && theme.accent !== 'indigo' && `accent-${theme.accent}`)
}

function useNoIndex(hidden: boolean) {
  useEffect(() => {
    if (!hidden) return
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => {
      meta.remove()
    }
  }, [hidden])
}

function Missing({ failed, themeClass }: { failed: unknown; themeClass: string }) {
  const gone = failed instanceof ApiError && failed.status === 404
  return (
    <div className={cn(themeClass, 'flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground')}>
      <p className="m-0 text-control text-muted-foreground">{gone ? 'There is no status page at this address.' : 'The status page could not be loaded. Try again in a minute.'}</p>
    </div>
  )
}

export function PublicStatus() {
  const { org, slug } = useParams()
  const notice = useSearchParam('notice')
  const { status, failed } = usePublicStatus(slug, org)
  const subscribe = useSubscribe(slug, org)
  const themeClass = usePublicTheme(status?.page.theme)
  useNoIndex(status?.page.hide_from_search ?? true)
  useEffect(() => {
    if (status) document.title = `${status.page.name} status`
  }, [status])
  if (failed) return <Missing failed={failed} themeClass={themeClass} />
  if (!status) return <div className={cn(themeClass, 'min-h-screen bg-background')} aria-busy />
  return (
    <div className={cn(themeClass, 'min-h-screen bg-background text-foreground')}>
      {notice && NOTICES[notice] ? <div role="status" className="bg-accent-subtle px-4 py-2.5 text-center text-control text-accent-text">{NOTICES[notice]}</div> : null}
      <StatusPageView view={status} subscribe={async (email) => subscribe.mutateAsync(email)} />
    </div>
  )
}

export function PublicPostmortem() {
  const { org, slug, incident } = useParams()
  const { postmortem, failed } = usePublicPostmortem(slug, incident, org)
  const { status } = usePublicStatus(slug, org)
  const themeClass = usePublicTheme(status?.page.theme)
  useNoIndex(status?.page.hide_from_search ?? true)
  if (failed) return <Missing failed={failed} themeClass={themeClass} />
  if (!postmortem) return <div className={cn(themeClass, 'min-h-screen bg-background')} aria-busy />
  const backHref = org ? `/status/${org}/${slug}` : `/status/${slug}`
  return (
    <div className={cn(themeClass, 'min-h-screen bg-background text-foreground')}>
      <main className="mx-auto flex max-w-[880px] flex-col gap-4 px-6 pb-16 pt-8">
        <a className="text-control" href={backHref}>Back to the status page</a>
        <h1 className="text-[24px] font-semibold">{postmortem.title}</h1>
        <span className="text-caption text-muted-foreground">Published {new Date(postmortem.published_ms).toLocaleString('en-US')}</span>
        <article className="rounded-md border bg-card px-6 py-5"><Markdown source={postmortem.body} /></article>
      </main>
    </div>
  )
}
