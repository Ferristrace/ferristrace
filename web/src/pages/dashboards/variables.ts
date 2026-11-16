import type { FilterDoc, QueryDoc, VariableDoc } from '@/data/dashboards'

export type Choice = { all: true } | { values: string[] }

export type Chosen = Record<string, Choice>

const VALUE = 'v.'

const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])

export const isReserved = (name: string): boolean => RESERVED.has(name)

const own = <T>(record: Record<string, T>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined)

const blank = <T>(): Record<string, T> => Object.create(null) as Record<string, T>

export function decodeVars(raw: string | undefined): Chosen {
  const chosen = blank<Choice>()
  const params = new URLSearchParams(raw ?? '')
  for (const name of params.getAll('all')) if (!isReserved(name)) chosen[name] = { all: true }
  for (const [key, value] of params) {
    if (!key.startsWith(VALUE)) continue
    const name = key.slice(VALUE.length)
    if (isReserved(name)) continue
    const held = own(chosen, name)
    if (held && 'values' in held) held.values.push(value)
    else chosen[name] = { values: [value] }
  }
  return chosen
}

export function encodeVars(chosen: Chosen): string | undefined {
  const params = new URLSearchParams()
  for (const [name, choice] of Object.entries(chosen)) {
    if ('all' in choice) params.append('all', name)
    else for (const value of choice.values) params.append(`${VALUE}${name}`, value)
  }
  return params.toString() || undefined
}

export function choiceOf(variable: VariableDoc, chosen: Chosen): Choice {
  const held = own(chosen, variable.name)
  if (held) return held
  if (variable.all) return { all: true }
  return { values: variable.source.kind === 'static' && variable.source.values.length > 0 ? [variable.source.values[0]] : [] }
}

export function sentVariables(variables: VariableDoc[], chosen: Chosen): Record<string, string[]> {
  const sent = blank<string[]>()
  for (const variable of variables) {
    const choice = choiceOf(variable, chosen)
    if ('all' in choice) continue
    const values = variable.multi ? choice.values : choice.values.slice(0, 1)
    if (values.length > 0) sent[variable.name] = values
  }
  return sent
}

export function usedVariables(filter: FilterDoc | null | undefined): string[] {
  if (!filter) return []
  if ('all' in filter) return filter.all.flatMap(usedVariables)
  if ('any' in filter) return filter.any.flatMap(usedVariables)
  if ('not' in filter) return usedVariables(filter.not)
  const raw = filter.value
  if (raw === undefined) return []
  return (Array.isArray(raw) ? raw : [raw]).flatMap((value) => (typeof value === 'object' ? [value.var] : []))
}

export function variablesFor(query: QueryDoc, sent: Record<string, string[]>): Record<string, string[]> {
  const used = new Set(usedVariables(query.filter))
  const kept = blank<string[]>()
  for (const [name, values] of Object.entries(sent)) if (used.has(name)) kept[name] = values
  return kept
}
