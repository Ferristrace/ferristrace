import { Plus, Settings2, Variable } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LIMITS } from './kinds'
import { SaveNotice } from './SaveNotice'
import type { SaveFailure } from './saveError'

export function EditBar({ dirty, saving, issues, failure, panels, variables, onAdd, onVariables, onSettings, onSave, onDiscard }: {
  dirty: boolean
  saving: boolean
  issues: string[]
  failure: SaveFailure | null
  panels: number
  variables: number
  onAdd: () => void
  onVariables: () => void
  onSettings: () => void
  onSave: () => void
  onDiscard: () => void
}) {
  const full = panels >= LIMITS.panels
  return (
    <div className="flex flex-col gap-2" role="region" aria-label="Editing tools">
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2">
        <Button size="sm" variant="primary" disabled={full} title={full ? `A dashboard holds at most ${LIMITS.panels} panels.` : undefined} onClick={onAdd}><Plus aria-hidden />Add panel</Button>
        <Button size="sm" onClick={onVariables}><Variable aria-hidden />Variables{variables > 0 ? ` (${variables})` : ''}</Button>
        <Button size="sm" onClick={onSettings}><Settings2 aria-hidden />Settings</Button>
        <span className="flex-1" />
        <span aria-live="polite" className="text-caption text-muted-foreground">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'No changes'}</span>
        <Button size="sm" onClick={onDiscard} disabled={saving}>{dirty ? 'Discard' : 'Done'}</Button>
        <Button size="sm" variant="primary" onClick={onSave} loading={saving} disabled={!dirty || issues.length > 0} title={issues[0]}>Save</Button>
      </div>
      <SaveNotice failure={failure} />
      {issues.length > 0 ? (
        <ul aria-label="Problems with this dashboard" role="status" className="m-0 flex list-none flex-col gap-1 rounded-md bg-warning-subtle px-3 py-2 text-control text-warning-text">
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      ) : null}
    </div>
  )
}
