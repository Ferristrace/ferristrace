import { ChevronDown, ChevronUp, Copy, GripVertical, Maximize2, Pencil, Trash2 } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { PanelDoc } from '@/data/dashboards'
import { cn } from '@/lib/utils'
import { SIZES, type SizeKey } from './grid'
import { KIND_INFO } from './kinds'

export type FrameActions = {
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onSize: (key: SizeKey) => void
  onNudge: (dx: number, dy: number) => void
  onResize: (dw: number, dh: number) => void
  onReorder: (by: number) => void
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

export function PanelFrame({ panel, selected, narrow, canDuplicate, actions }: { panel: PanelDoc; selected: boolean; narrow: boolean; canDuplicate: boolean; actions: FrameActions }) {
  const [sizing, setSizing] = useState(false)
  const label = panel.title || 'Untitled panel'

  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    const arrow = ARROWS[event.key]
    if (!arrow) return
    event.preventDefault()
    if (event.shiftKey) actions.onResize(arrow[0], arrow[1])
    else actions.onNudge(arrow[0], arrow[1])
  }

  return (
    <div data-selected={selected || undefined} className={cn('flex h-8 shrink-0 items-center gap-0.5 rounded-t-lg border border-b-0 bg-muted px-1', selected && 'border-ring bg-accent-subtle')}>
      {narrow ? (
        <>
          <Button size="icon-sm" variant="ghost" aria-label={`Move ${label} up`} onClick={() => actions.onReorder(-1)}><ChevronUp aria-hidden /></Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Move ${label} down`} onClick={() => actions.onReorder(1)}><ChevronDown aria-hidden /></Button>
        </>
      ) : (
        <button
          type="button"
          onKeyDown={key}
          aria-label={`Move or resize ${label}. Arrow keys move it, Shift with arrow keys resizes it.`}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
          title="Drag to move. With the keyboard: arrows move, Shift with arrows resizes."
          className="panel-handle inline-flex size-7 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-background focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      )}
      <span className="min-w-0 flex-1 truncate px-1 text-micro text-muted-foreground">{KIND_INFO[panel.kind].name}</span>
      {!narrow ? (
        <Popover open={sizing} onOpenChange={setSizing}>
          <PopoverTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`Size of ${label}`} title="Size"><Maximize2 aria-hidden /></Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[170px] p-1">
            {SIZES.map((size) => (
              <button
                key={size.key}
                type="button"
                onClick={() => {
                  setSizing(false)
                  actions.onSize(size.key)
                }}
                className="flex w-full cursor-pointer items-center justify-between rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-control hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span>{size.label}</span>
                <span className="font-mono text-caption text-muted-foreground">{size.h === null ? '12 wide' : `${size.w} by ${size.h}`}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${label}`} title="Edit" onClick={actions.onEdit}><Pencil aria-hidden /></Button>
      <Button size="icon-sm" variant="ghost" aria-label={`Duplicate ${label}`} title={canDuplicate ? 'Duplicate' : 'A dashboard holds at most 30 panels'} disabled={!canDuplicate} onClick={actions.onDuplicate}><Copy aria-hidden /></Button>
      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${label}`} title="Delete" onClick={actions.onDelete}><Trash2 aria-hidden /></Button>
    </div>
  )
}
