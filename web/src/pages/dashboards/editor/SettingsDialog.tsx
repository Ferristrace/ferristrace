import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ConfirmDelete } from './DashboardDialogs'
import { setSettings, parseTags, type Draft } from './draft'
import { DURATION_PRESETS, durationIssue, formatDuration, parseDuration } from './duration'
import { LIMITS } from './kinds'
import type { SaveFailure } from './saveError'

export function SettingsDialog({ open, onOpenChange, draft, onChange, onDelete, deleting, deleteFailure }: { open: boolean; onOpenChange: (open: boolean) => void; draft: Draft; onChange: (draft: Draft) => void; onDelete: (() => void) | null; deleting: boolean; deleteFailure: SaveFailure | null }) {
  const [tags, setTags] = useState(draft.tags.join(', '))
  const [custom, setCustom] = useState('')
  const [confirming, setConfirming] = useState(false)
  const trimmed = draft.name.trim()
  const nameIssue = trimmed === '' ? 'A dashboard needs a name.' : [...trimmed].length > LIMITS.name ? `A dashboard name is at most ${LIMITS.name} characters.` : null
  const parsedTags = parseTags(tags)
  const tagIssue = parsedTags.length > LIMITS.tags ? `At most ${LIMITS.tags} tags.` : parsedTags.some((tag) => [...tag].length > LIMITS.tag) ? `A tag is at most ${LIMITS.tag} characters.` : null
  const typed = custom.trim() === '' ? null : parseDuration(custom)
  const customIssue = custom.trim() === '' ? null : typed === null ? 'Write it as 90s, 15m, 6h, 7d or 1h30m.' : durationIssue(typed)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md" title="Dashboard settings" description="Changes apply to the draft. They are saved with the rest of the dashboard.">
          <div className="flex flex-col gap-4">
            <Field label="Name" htmlFor="settings-name" hint={nameIssue ?? undefined}>
              <Input id="settings-name" value={draft.name} aria-invalid={nameIssue ? true : undefined} onChange={(event) => onChange(setSettings(draft, { name: event.target.value }))} />
            </Field>
            <Field label="Tags" htmlFor="settings-tags" hint={tagIssue ?? 'Separated by commas. Up to 10 tags of 32 characters.'}>
              <Input
                id="settings-tags"
                value={tags}
                aria-invalid={tagIssue ? true : undefined}
                onChange={(event) => {
                  setTags(event.target.value)
                  onChange(setSettings(draft, { tags: parseTags(event.target.value) }))
                }}
              />
            </Field>
            <Field label="Default time range" hint={`Now ${formatDuration(draft.doc.duration)}. From one minute to 31 days.`}>
              <div className="flex flex-col gap-2">
                <div role="group" aria-label="Time range presets" className="flex flex-wrap gap-1.5">
                  {DURATION_PRESETS.map((preset) => (
                    <button
                      key={preset.seconds}
                      type="button"
                      aria-pressed={draft.doc.duration === preset.seconds}
                      onClick={() => {
                        setCustom('')
                        onChange(setSettings(draft, { duration: preset.seconds }))
                      }}
                      className={cn('inline-flex h-7 cursor-pointer items-center rounded-sm border px-2.5 text-caption hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring', draft.doc.duration === preset.seconds ? 'border-transparent bg-accent-subtle text-accent-text' : 'text-muted-foreground')}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <Input
                  mono
                  aria-label="Custom time range"
                  placeholder="Custom, such as 90m or 2h30m"
                  value={custom}
                  aria-invalid={customIssue ? true : undefined}
                  onChange={(event) => {
                    setCustom(event.target.value)
                    const seconds = parseDuration(event.target.value)
                    if (seconds !== null && durationIssue(seconds) === null) onChange(setSettings(draft, { duration: seconds }))
                  }}
                  className="w-[260px]"
                />
                {customIssue ? <span role="alert" className="text-caption text-destructive-text">{customIssue}</span> : null}
              </div>
            </Field>
            <div className="flex flex-col gap-1.5 border-t pt-4">
              <span className="text-control font-semibold">Delete this dashboard</span>
              <span className="text-caption text-muted-foreground">{onDelete ? 'It disappears for everyone in the project.' : 'The sample dashboard lives in this browser only, so there is nothing to delete.'}</span>
              <div>
                <Button variant="outline" disabled={!onDelete} onClick={() => setConfirming(true)}><Trash2 aria-hidden />Delete…</Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDelete open={confirming} onOpenChange={setConfirming} name={draft.name.trim() || 'this dashboard'} pending={deleting} failure={deleteFailure} onConfirm={() => onDelete?.()} />
    </>
  )
}
