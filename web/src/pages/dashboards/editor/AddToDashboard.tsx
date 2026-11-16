import { useNavigate as useRouterNavigate } from '@tanstack/react-router'
import { LayoutDashboard } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { get, json } from '@/auth/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { useCreateDashboard, useDashboards, useReplaceDashboard, type Dashboard } from '@/data/dashboards'
import { addPanel, canAddPanel, draftOf, emptyDoc, fileOf, panelFromMetric } from './draft'
import { LIMITS, points } from './kinds'
import { describeSave, type SaveFailure } from './saveError'
import { SaveNotice } from './SaveNotice'

const NEW = '@new'

export function AddToDashboard({ metric, agg, groupBy, unit }: { metric: string; agg: string; groupBy: string[]; unit?: string }) {
  const navigate = useRouterNavigate()
  const { dashboards, pending } = useDashboards()
  const create = useCreateDashboard()
  const replace = useReplaceDashboard()
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const target = choice === '' ? (dashboards[0]?.id ?? NEW) : choice
  const fresh = target === NEW
  const from = { metric, agg, groupBy, unit }

  const go = (made: Dashboard, panel: string) => {
    setOpen(false)
    void navigate({ to: `/dashboards/${made.id}` as never, search: { edit: 'on', panel } as never })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure(null)
    setBusy(true)
    try {
      if (fresh) {
        const empty = draftOf({ name: name.trim(), tags: [], doc: emptyDoc() })
        const panel = panelFromMetric(empty.doc, from)
        const file = fileOf(addPanel(empty, panel))
        go(await create.mutateAsync(file), panel.id)
      } else {
        const current = draftOf(await json<Dashboard>(await get(`/api/v1/dashboards/${encodeURIComponent(target)}`)))
        if (!canAddPanel(current)) {
          setFailure({ kind: 'invalid', message: `That dashboard already holds ${LIMITS.panels} panels, which is the most it can.` })
          return
        }
        const panel = panelFromMetric(current.doc, from)
        go(await replace.mutateAsync({ id: target, ...fileOf(addPanel(current, panel)) }), panel.id)
      }
    } catch (error) {
      setFailure(describeSave(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><LayoutDashboard aria-hidden />Add to dashboard</Button>
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setFailure(null) }}>
        <DialogContent title="Add to dashboard" description={`A time series of ${agg} of ${metric}${groupBy.length > 0 ? `, grouped by ${groupBy.join(', ')}` : ''}. You can change it in the editor.`}>
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
            <Field label="Dashboard" htmlFor="add-to-dashboard">
              <NativeSelect id="add-to-dashboard" value={target} disabled={pending} onChange={(event) => setChoice(event.target.value)}>
                {dashboards.map((one) => <option key={one.id} value={one.id}>{one.name}</option>)}
                <option value={NEW}>New dashboard…</option>
              </NativeSelect>
            </Field>
            {fresh ? (
              <Field label="Name of the new dashboard" htmlFor="add-to-dashboard-name" hint={`Up to ${LIMITS.name} characters.`}>
                <Input id="add-to-dashboard-name" autoFocus value={name} aria-invalid={failure?.kind === 'name' ? true : undefined} onChange={(event) => setName(event.target.value)} />
              </Field>
            ) : null}
            <SaveNotice failure={failure} />
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={busy} disabled={fresh && (name.trim() === '' || points(name.trim()) > LIMITS.name)}>Add and edit</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
