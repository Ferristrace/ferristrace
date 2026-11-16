import type { PanelDoc } from '@/data/dashboards'
import { isDirty, type Draft } from './draft'
import type { SaveFailure } from './saveError'

export type Editing = { panel: PanelDoc; fresh: boolean }

export type Session = {
  base: Draft
  draft: Draft
  selected: string | null
  editing: Editing | null
  failure: SaveFailure | null
  status: string
}

export const openSession = (base: Draft, selected: string | null): Session => ({
  base,
  draft: base,
  selected: selected !== null && base.doc.panels.some((panel) => panel.id === selected) ? selected : null,
  editing: null,
  failure: null,
  status: '',
})

export const edit = (session: Session, change: (draft: Draft) => Draft, status = ''): Session => ({ ...session, draft: change(session.draft), failure: null, status })

export const select = (session: Session, id: string | null): Session => ({ ...session, selected: id })

export const beginPanel = (session: Session, panel: PanelDoc, fresh: boolean): Session => ({ ...session, editing: { panel, fresh }, selected: fresh ? session.selected : panel.id })

export const endPanel = (session: Session): Session => ({ ...session, editing: null })

export const saved = (session: Session, next: Draft): Session => ({ ...session, base: next, draft: next, failure: null, status: 'Saved' })

export const failed = (session: Session, failure: SaveFailure): Session => ({ ...session, failure })

export const hasUnsaved = (session: Session | null): boolean => session !== null && (session.editing !== null || isDirty(session.base, session.draft))

export const hasConflict = (basedOn: number | undefined, remote: number): boolean => basedOn !== undefined && basedOn !== remote
