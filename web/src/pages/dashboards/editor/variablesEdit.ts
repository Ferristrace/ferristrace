import type { DashboardDoc, PanelDoc, VariableDoc } from '@/data/dashboards'
import { dropVariable, renameVariable, variablesUsed } from './filterTree'
import { LIMITS, points } from './kinds'

const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])

const MAX_NAME = 32

export function validateVariableName(name: string, taken: string[]): string | null {
  if (name === '') return 'A variable needs a name.'
  if (name.length > MAX_NAME) return `A variable name is at most ${MAX_NAME} characters.`
  if (!/^[a-z0-9_]+$/.test(name)) return 'A variable name uses only a to z, 0 to 9 and _.'
  if (/^[0-9]/.test(name)) return 'A variable name starts with a letter or _.'
  if (RESERVED.has(name)) return `${name} is a reserved name.`
  if (taken.includes(name)) return `Another variable is already named ${name}.`
  return null
}

export function variableIssues(variable: VariableDoc, others: string[]): string[] {
  const issues: string[] = []
  const name = validateVariableName(variable.name, others)
  if (name) issues.push(name)
  if (points(variable.label) > LIMITS.label) issues.push(`A label is at most ${LIMITS.label} characters.`)
  const source = variable.source
  if (source.kind === 'attribute') {
    if (source.key.trim() === '') issues.push('An attribute variable needs an attribute key.')
  } else {
    if (source.values.length < 1 || source.values.length > LIMITS.choices) issues.push(`A static variable lists 1 to ${LIMITS.choices} values.`)
    if (source.values.some((value) => value === '' || new TextEncoder().encode(value).length > LIMITS.choice)) issues.push(`A static value is 1 to ${LIMITS.choice} bytes.`)
  }
  return issues
}

export function allVariableIssues(variables: VariableDoc[]): string[] {
  const issues: string[] = []
  if (variables.length > LIMITS.variables) issues.push(`A dashboard holds at most ${LIMITS.variables} variables.`)
  variables.forEach((variable, at) => {
    const others = variables.filter((_, index) => index !== at).map((one) => one.name)
    for (const issue of variableIssues(variable, others)) issues.push(variable.name ? `${variable.name}: ${issue}` : issue)
  })
  return issues
}

export const parseValues = (text: string): string[] => [...new Set(text.split('\n').map((line) => line.trim()).filter((line) => line !== ''))]

export function newVariable(existing: VariableDoc[]): VariableDoc {
  const names = existing.map((one) => one.name)
  let at = 1
  while (names.includes(`var_${at}`)) at += 1
  return { name: `var_${at}`, label: '', source: { kind: 'attribute', signal: 'traces', key: 'service' }, multi: false, all: false }
}

export const variableUsage = (doc: DashboardDoc, name: string): PanelDoc[] => doc.panels.filter((panel) => panel.queries.some((query) => variablesUsed(query.filter ?? null).includes(name)))

const mapFilters = (doc: DashboardDoc, change: (filter: PanelDoc['queries'][number]['filter']) => PanelDoc['queries'][number]['filter']): PanelDoc[] =>
  doc.panels.map((panel) => ({ ...panel, queries: panel.queries.map((query) => (query.filter ? { ...query, filter: change(query.filter) } : query)) }))

export const deleteVariable = (doc: DashboardDoc, name: string): DashboardDoc => ({
  ...doc,
  variables: doc.variables.filter((one) => one.name !== name),
  panels: mapFilters(doc, (filter) => dropVariable(filter ?? null, name)),
})

export const renameVariableIn = (doc: DashboardDoc, from: string, to: string): DashboardDoc => ({
  ...doc,
  variables: doc.variables.map((one) => (one.name === from ? { ...one, name: to } : one)),
  panels: mapFilters(doc, (filter) => renameVariable(filter ?? null, from, to)),
})

export function reconcileIds(ids: string[], before: VariableDoc[], after: VariableDoc[], make: () => string): string[] {
  let out = [...ids]
  if (after.length > before.length) out = [...out, ...Array.from({ length: after.length - before.length }, make)]
  else if (after.length < before.length) {
    const kept = new Set(after.map((one) => one.name))
    const at = before.findIndex((one) => !kept.has(one.name))
    if (at >= 0) out.splice(at, 1)
  }
  while (out.length < after.length) out.push(make())
  return out.slice(0, after.length)
}
