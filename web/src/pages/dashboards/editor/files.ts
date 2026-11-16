import type { DashboardDoc, DashboardFile } from '@/data/dashboards'
import { DURATION_MAX, DURATION_MIN } from './duration'
import { LIMITS } from './kinds'

export type Parsed = { ok: true; file: DashboardFile } | { ok: false; error: string }

const MAX_DOC_BYTES = 256 * 1024

const refuse = (error: string): Parsed => ({ ok: false, error })

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export const MAX_NESTING = 32

export function nestingExceeds(value: unknown, limit: number, level = 1): boolean {
  if (level > limit) return true
  if (value === null || typeof value !== 'object') return false
  const children = Array.isArray(value) ? value : Object.values(value)
  return children.some((child) => nestingExceeds(child, limit, level + 1))
}

export function parseImport(text: string): Parsed {
  try {
    return parseFile(text)
  } catch {
    return refuse('This file could not be read. It is nested too deeply or is too large to be a dashboard.')
  }
}

function parseFile(text: string): Parsed {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return refuse('This file is not valid JSON.')
  }
  if (nestingExceeds(parsed, MAX_NESTING)) return refuse(`This file is nested more than ${MAX_NESTING} levels deep, which no dashboard is.`)
  if (!isObject(parsed)) return refuse('A dashboard file is a JSON object with a name, tags and doc.')
  const name = parsed.name
  if (typeof name !== 'string' || name.trim() === '') return refuse('The file has no dashboard name.')
  if ([...name.trim()].length > LIMITS.name) return refuse(`A dashboard name is at most ${LIMITS.name} characters.`)
  const rawTags = parsed.tags ?? []
  if (!Array.isArray(rawTags) || rawTags.some((tag) => typeof tag !== 'string')) return refuse('The tags of the file are a list of text.')
  const tags = [...new Set((rawTags as string[]).map((tag) => tag.trim()).filter((tag) => tag !== ''))]
  if (tags.some((tag) => [...tag].length > LIMITS.tag)) return refuse(`A tag is 1 to ${LIMITS.tag} characters.`)
  if (tags.length > LIMITS.tags) return refuse(`A dashboard holds at most ${LIMITS.tags} tags.`)
  const doc = parsed.doc
  if (!isObject(doc)) return refuse('The file has no doc object.')
  if (doc.schema_version === undefined) return refuse('The file has no doc.schema_version.')
  if (doc.schema_version !== 1) return refuse(typeof doc.schema_version === 'number' ? `This file uses schema_version ${doc.schema_version}, and only 1 is supported.` : 'doc.schema_version must be the number 1.')
  for (const key of ['panels', 'variables', 'layout'] as const) if (doc[key] !== undefined && !Array.isArray(doc[key])) return refuse(`doc.${key} must be a list.`)
  const panels = (doc.panels ?? []) as unknown[]
  const variables = (doc.variables ?? []) as unknown[]
  if (panels.length > LIMITS.panels) return refuse(`A dashboard holds at most ${LIMITS.panels} panels.`)
  if (variables.length > LIMITS.variables) return refuse(`A dashboard holds at most ${LIMITS.variables} variables.`)
  for (const [at, panel] of panels.entries()) {
    if (!isObject(panel) || typeof panel.id !== 'string' || typeof panel.kind !== 'string') return refuse(`Panel ${at + 1} needs an id and a kind.`)
  }
  const duration = doc.duration
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < DURATION_MIN || duration > DURATION_MAX) return refuse('doc.duration is a whole number of seconds, from one minute to 31 days.')
  const full = { ...doc, panels, variables, layout: doc.layout ?? [] } as unknown as DashboardDoc
  if (new TextEncoder().encode(JSON.stringify(full)).length > MAX_DOC_BYTES) return refuse('A dashboard document is at most 256 KB.')
  return { ok: true, file: { name: name.trim(), tags, doc: full } }
}

export function slugOf(name: string): string {
  const dashed = [...name].map((character) => (/[A-Za-z0-9]/.test(character) ? character.toLowerCase() : '-')).join('')
  const trimmed = dashed.replace(/^-+|-+$/g, '')
  return trimmed === '' ? 'dashboard' : trimmed
}

export const fileNameOf = (name: string): string => `${slugOf(name)}.json`

export const serialise = (file: DashboardFile): string => `${JSON.stringify(file, null, 2)}\n`
