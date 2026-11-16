import { Search } from 'lucide-react'
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { InputGroup } from '@/components/ui/input'
import type { PanelKind } from '@/data/dashboards'
import { cn } from '@/lib/utils'
import { KIND_GROUPS, KIND_INFO, searchKinds } from './kinds'
import { Thumbnail } from './Thumbnail'

export function PickerBody({ onPick, initialText = '', initialGroup = null }: { onPick: (kind: PanelKind) => void; initialText?: string; initialGroup?: string | null }) {
  const [text, setText] = useState(initialText)
  const [group, setGroup] = useState<string | null>(initialGroup)
  const list = useRef<HTMLDivElement>(null)
  const heading = useId()
  const found = useMemo(() => new Set(searchKinds(text, group)), [text, group])
  const shown = KIND_GROUPS.map((one) => ({ ...one, kinds: one.kinds.filter((kind) => found.has(kind)) })).filter((one) => one.kinds.length > 0)

  const options = (): HTMLButtonElement[] => Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button[data-kind]') ?? [])

  const move = (event: KeyboardEvent<HTMLElement>) => {
    const all = options()
    if (all.length === 0) return
    const at = all.findIndex((one) => one === document.activeElement)
    const key = event.key
    let next = -1
    if (key === 'ArrowDown' || key === 'ArrowRight') next = at < 0 ? 0 : Math.min(all.length - 1, at + 1)
    else if (key === 'ArrowUp' || key === 'ArrowLeft') next = at <= 0 ? -1 : at - 1
    else if (key === 'Home' && at >= 0) next = 0
    else if (key === 'End' && at >= 0) next = all.length - 1
    else return
    if (event.target instanceof HTMLInputElement && (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End')) return
    event.preventDefault()
    if (next < 0) (document.getElementById(`${heading}-search`) as HTMLInputElement | null)?.focus()
    else all[next]?.focus()
  }

  return (
    <div className="flex min-h-0 flex-col gap-3" onKeyDown={move}>
      <InputGroup>
        <Search aria-hidden />
        <input id={`${heading}-search`} autoFocus type="search" aria-label="Search panel types" placeholder="Search panel types" value={text} onChange={(event) => setText(event.target.value)} />
      </InputGroup>
      <div role="group" aria-label="Filter by group" className="flex flex-wrap gap-1.5">
        {[{ key: null, label: 'All' }, ...KIND_GROUPS].map((one) => (
          <button
            key={one.key ?? 'all'}
            type="button"
            aria-pressed={group === one.key}
            onClick={() => setGroup(one.key)}
            className={cn('inline-flex h-6 cursor-pointer items-center rounded-sm border px-2 text-caption hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring', group === one.key ? 'border-transparent bg-accent-subtle text-accent-text' : 'text-muted-foreground')}
          >
            {one.label}
          </button>
        ))}
      </div>
      <div ref={list} className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1" aria-live="polite">
        {shown.length === 0 ? <p className="m-0 py-6 text-center text-control text-muted-foreground">No panel type matches “{text.trim()}”.</p> : null}
        {shown.map((one) => (
          <section key={one.key} aria-labelledby={`${heading}-${one.key}`} data-group={one.key} className="flex flex-col gap-2">
            <h3 id={`${heading}-${one.key}`} className="m-0 text-caption font-semibold uppercase tracking-wide text-muted-foreground">{one.label}</h3>
            <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
              {one.kinds.map((kind) => (
                <li key={kind}>
                  <button
                    type="button"
                    data-kind={kind}
                    onClick={() => onPick(kind)}
                    className="flex min-h-[64px] w-full cursor-pointer items-center gap-3 rounded-lg border bg-card p-2 text-left hover:bg-row-hover focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Thumbnail kind={kind} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sub">{KIND_INFO[kind].name}</span>
                      <span className="text-caption text-muted-foreground">{KIND_INFO[kind].description}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

export function PanelPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (kind: PanelKind) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title="Add a panel" description="Pick how the data is drawn. You choose the data next.">
        <PickerBody onPick={onPick} />
      </DialogContent>
    </Dialog>
  )
}
