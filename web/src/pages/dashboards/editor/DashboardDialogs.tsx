import { FileJson, TriangleAlert } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/misc'
import { useCreateDashboard, useImportDashboard, type Dashboard, type DashboardFile } from '@/data/dashboards'
import { emptyDoc } from './draft'
import { parseImport } from './files'
import { LIMITS, points } from './kinds'
import { describeSave, type SaveFailure } from './saveError'
import { SaveNotice } from './SaveNotice'

export function NewDashboardDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (dashboard: Dashboard) => void }) {
  const create = useCreateDashboard()
  const [name, setName] = useState('')
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const trimmed = name.trim()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (trimmed === '') return
    setFailure(null)
    create.mutate({ name: trimmed, tags: [], doc: emptyDoc() }, { onSuccess: (made) => { setName(''); onCreated(made) }, onError: (error) => setFailure(describeSave(error)) })
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { setFailure(null); setName('') } onOpenChange(next) }}>
      <DialogContent title="New dashboard" description="It starts empty in the current project, and opens in edit mode so you can add panels.">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Name" htmlFor="new-dashboard-name" hint={`Up to ${LIMITS.name} characters. Names are unique in a project.`}>
            <Input id="new-dashboard-name" autoFocus value={name} aria-invalid={failure?.kind === 'name' ? true : undefined} onChange={(event) => setName(event.target.value)} />
          </Field>
          <SaveNotice failure={failure} />
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={create.isPending} disabled={trimmed === '' || points(trimmed) > LIMITS.name}>Create and edit</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ImportDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (open: boolean) => void; onImported: (dashboard: Dashboard) => void }) {
  const send = useImportDashboard()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<DashboardFile | null>(null)
  const [fileName, setFileName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [failure, setFailure] = useState<SaveFailure | null>(null)

  const reset = () => {
    setFile(null)
    setFileName('')
    setProblem(null)
    setName('')
    setFailure(null)
  }

  const choose = async (picked: File | undefined) => {
    reset()
    if (!picked) return
    setFileName(picked.name)
    if (picked.size > 300 * 1024) {
      setProblem('This file is larger than 300 KB, which is more than a dashboard can be.')
      return
    }
    let content: string
    try {
      content = await picked.text()
    } catch {
      setProblem('This file could not be read.')
      return
    }
    const parsed = parseImport(content)
    if (!parsed.ok) {
      setProblem(parsed.error)
      return
    }
    setFile(parsed.file)
    setName(parsed.file.name)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!file || name.trim() === '') return
    setFailure(null)
    send.mutate({ ...file, name: name.trim() }, { onSuccess: (made) => { reset(); onImported(made) }, onError: (error) => setFailure(describeSave(error)) })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next) }}>
      <DialogContent title="Import a dashboard" description="Choose a .json file exported from FerrisTrace. It becomes a new dashboard in the current project.">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={input} type="file" accept=".json,application/json" aria-label="Dashboard file" className="sr-only" onChange={(event) => void choose(event.target.files?.[0])} />
            <Button type="button" onClick={() => input.current?.click()}><FileJson aria-hidden />Choose a file</Button>
            <span className="min-w-0 truncate font-mono text-caption text-muted-foreground">{fileName || 'No file chosen'}</span>
          </div>
          {problem ? <div data-state="refused"><Alert variant="destructive" icon={<TriangleAlert aria-hidden />}>{problem}</Alert></div> : null}
          {file ? (
            <>
              <p className="m-0 text-control text-muted-foreground" data-state="valid">
                {file.doc.panels.length} panel{file.doc.panels.length === 1 ? '' : 's'}, {file.doc.variables.length} variable{file.doc.variables.length === 1 ? '' : 's'}, schema_version 1.
              </p>
              <Field label="Name" htmlFor="import-name" hint="Change it if a dashboard of that name already exists.">
                <Input id="import-name" value={name} aria-invalid={failure?.kind === 'name' ? true : undefined} onChange={(event) => setName(event.target.value)} />
              </Field>
            </>
          ) : null}
          <SaveNotice failure={failure} />
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={send.isPending} disabled={!file || name.trim() === '' || points(name.trim()) > LIMITS.name}>Import</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ConfirmDelete({ open, onOpenChange, name, onConfirm, pending, failure }: { open: boolean; onOpenChange: (open: boolean) => void; name: string; onConfirm: () => void; pending: boolean; failure: SaveFailure | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Delete ${name}?`} description="The dashboard and its panels are removed for everyone in the project. This cannot be undone.">
        <SaveNotice failure={failure} />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" loading={pending} onClick={onConfirm}>Delete {name}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
