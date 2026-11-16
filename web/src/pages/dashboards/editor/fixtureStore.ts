import { useSyncExternalStore } from 'react'
import { ApiError } from '@/auth/client'
import { FIXTURE_DOC } from '@/components/ft/panels/fixtures'
import type { DashboardFile } from '@/data/dashboards'
import { draftOf, draftIssues, type Draft } from './draft'
import { panelIssues } from './kinds'

export const FIXTURE_TAKEN_NAME = 'taken'

const initial = (): Draft => draftOf({ name: 'Fixture dashboard', tags: ['sample data'], doc: FIXTURE_DOC })

let held: Draft = initial()

const listeners = new Set<() => void>()

const notify = () => listeners.forEach((listen) => listen())

export const fixtureDraft = (): Draft => held

export function saveFixture(file: DashboardFile, simulateConflict = false): Draft {
  if (simulateConflict && file.name.trim().toLowerCase() === FIXTURE_TAKEN_NAME) throw new ApiError(409, 'a dashboard of that name already exists in this project')
  const next = draftOf(file)
  const refusal = [...draftIssues(next), ...next.doc.panels.flatMap((panel) => panelIssues(panel).map((issue) => `panel \`${panel.id}\`: ${issue}`))][0]
  if (refusal) throw new ApiError(422, refusal)
  held = next
  notify()
  return next
}

export function resetFixture(): void {
  held = initial()
  notify()
}

export function useFixtureDraft(): Draft {
  return useSyncExternalStore(
    (listen) => {
      listeners.add(listen)
      return () => listeners.delete(listen)
    },
    fixtureDraft,
  )
}
