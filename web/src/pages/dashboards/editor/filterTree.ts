import type { Column, Condition, FilterDoc, FilterScalar } from '@/data/dashboards'

export type Path = number[]

export type Tree = FilterDoc | null

export type GroupKind = 'all' | 'any'

export const MAX_DEPTH = 8

export const MAX_CONDITIONS = 32

export const MAX_LIST = 50

export type NodeKind = 'all' | 'any' | 'not' | 'condition'

export const kindOf = (node: FilterDoc): NodeKind => ('all' in node ? 'all' : 'any' in node ? 'any' : 'not' in node ? 'not' : 'condition')

export const groupKindOf = (node: FilterDoc): GroupKind | null => ('all' in node ? 'all' : 'any' in node ? 'any' : null)

export const childrenOf = (node: FilterDoc): FilterDoc[] => ('all' in node ? node.all : 'any' in node ? node.any : 'not' in node ? [node.not] : [])

export const isVariableRef = (value: unknown): value is { var: string } => typeof value === 'object' && value !== null && !Array.isArray(value) && 'var' in value && typeof (value as { var: unknown }).var === 'string'

export const variableRef = (name: string): { var: string } => ({ var: name })

const group = (kind: GroupKind, children: FilterDoc[]): FilterDoc => (kind === 'all' ? { all: children } : { any: children })

const withChildren = (node: FilterDoc, children: FilterDoc[]): FilterDoc => {
  if ('all' in node) return { all: children }
  if ('any' in node) return { any: children }
  if ('not' in node) return children[0] ? { not: children[0] } : node
  return node
}

export function nodeAt(tree: Tree, path: Path): FilterDoc | null {
  let node = tree
  for (const index of path) {
    if (!node) return null
    node = childrenOf(node)[index] ?? null
  }
  return node
}

export function replaceAt(tree: Tree, path: Path, next: FilterDoc): Tree {
  if (path.length === 0) return next
  if (!tree) return tree
  const [index, ...rest] = path
  const children = childrenOf(tree)
  const child = children[index]
  if (!child) return tree
  return withChildren(tree, children.map((one, at) => (at === index ? (replaceAt(child, rest, next) as FilterDoc) : one)))
}

export function depthOf(tree: Tree): number {
  if (!tree) return 0
  return 1 + Math.max(0, ...childrenOf(tree).map((child) => depthOf(child)))
}

export const canNest = (tree: Tree): boolean => depthOf(tree) < MAX_DEPTH

export function countConditions(tree: Tree): number {
  if (!tree) return 0
  if (kindOf(tree) === 'condition') return 1
  return childrenOf(tree).reduce((sum, child) => sum + countConditions(child), 0)
}

function insert(tree: Tree, path: Path, added: FilterDoc, kind: GroupKind): Tree {
  if (!tree) return group(kind, [added])
  const node = nodeAt(tree, path)
  if (!node) return tree
  const was = kindOf(node)
  if (was === 'condition') return replaceAt(tree, path, group('all', [node, added]))
  if (was === 'not') return insert(tree, [...path, 0], added, kind)
  return replaceAt(tree, path, withChildren(node, [...childrenOf(node), added]))
}

export const addCondition = (tree: Tree, path: Path, condition: Condition): Tree => insert(tree, path, condition, 'all')

export const addGroup = (tree: Tree, path: Path, kind: GroupKind): Tree => insert(tree, path, group(kind, []), 'all')

export function removeAt(tree: Tree, path: Path): Tree {
  if (path.length === 0) return null
  if (!tree || !nodeAt(tree, path)) return tree
  const parentPath = path.slice(0, -1)
  const parent = nodeAt(tree, parentPath)
  if (!parent) return tree
  if (kindOf(parent) === 'not') return removeAt(tree, parentPath)
  const index = path[path.length - 1]
  return replaceAt(tree, parentPath, withChildren(parent, childrenOf(parent).filter((_, at) => at !== index)))
}

export function wrap(tree: Tree, path: Path, kind: GroupKind | 'not'): Tree {
  const node = nodeAt(tree, path)
  if (!node) return tree
  return replaceAt(tree, path, kind === 'not' ? { not: node } : group(kind, [node]))
}

export function unwrap(tree: Tree, path: Path): Tree {
  const node = nodeAt(tree, path)
  if (!node) return tree
  const was = kindOf(node)
  if (was === 'condition') return tree
  const children = childrenOf(node)
  const parentPath = path.slice(0, -1)
  const parent = path.length > 0 ? nodeAt(tree, parentPath) : null
  const parentIsGroup = parent !== null && groupKindOf(parent) !== null
  if (children.length === 1 && (was === 'not' || path.length === 0 || parentIsGroup || (parent !== null && kindOf(parent) === 'not'))) return replaceAt(tree, path, children[0])
  if (children.length > 1 && parent !== null && parentIsGroup && was !== 'not') {
    const index = path[path.length - 1]
    const siblings = childrenOf(parent)
    return replaceAt(tree, parentPath, withChildren(parent, [...siblings.slice(0, index), ...children, ...siblings.slice(index + 1)]))
  }
  return tree
}

export function setGroupKind(tree: Tree, path: Path, kind: GroupKind): Tree {
  const node = nodeAt(tree, path)
  if (!node || groupKindOf(node) === null) return tree
  return replaceAt(tree, path, group(kind, childrenOf(node)))
}

export const columnOf = (condition: Condition): Column | null => (condition.attr !== undefined ? { attr: condition.attr } : condition.field ? { field: condition.field } : null)

const isBare = (op: Condition['op']): boolean => op === 'exists' || op === 'not_exists'

const isList = (op: Condition['op']): boolean => op === 'in' || op === 'not_in'

function settled(condition: Condition): Condition {
  const { value, ...rest } = condition
  if (isBare(condition.op)) return rest
  if (value === undefined) return rest
  if (isList(condition.op)) return { ...rest, value: Array.isArray(value) ? value : value === '' ? [] : [value] }
  return { ...rest, value: Array.isArray(value) ? (value[0] ?? '') : value }
}

export function updateCondition(tree: Tree, path: Path, patch: Partial<Condition>): Tree {
  const node = nodeAt(tree, path)
  if (!node || kindOf(node) !== 'condition') return tree
  const current = node as Condition
  const merged: Condition = { ...current, ...patch }
  if (patch.field !== undefined) delete merged.attr
  if (patch.attr !== undefined) delete merged.field
  return replaceAt(tree, path, settled(merged))
}

export const emptyCondition = (field: Condition['field'] = 'service'): Condition => ({ field, op: 'eq', value: '' })

export const scalarText = (value: FilterScalar | undefined): string => (value === undefined ? '' : typeof value === 'object' ? `$${value.var}` : String(value))

export function parseScalar(text: string, numeric: boolean): string | number {
  const trimmed = text.trim()
  if (numeric && trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed)
  return text
}

export const parseList = (text: string, numeric: boolean): (string | number)[] =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => parseScalar(part, numeric))

const refsOf = (condition: Condition): string[] => {
  const raw = condition.value
  if (raw === undefined) return []
  return (Array.isArray(raw) ? raw : [raw]).flatMap((value) => (isVariableRef(value) ? [value.var] : []))
}

export function variablesUsed(tree: Tree): string[] {
  if (!tree) return []
  const names = kindOf(tree) === 'condition' ? refsOf(tree as Condition) : childrenOf(tree).flatMap((child) => variablesUsed(child))
  return [...new Set(names)]
}

function mapConditions(tree: Tree, change: (condition: Condition) => Condition | null): Tree {
  if (!tree) return null
  if (kindOf(tree) === 'condition') return change(tree as Condition)
  const children = childrenOf(tree).flatMap((child) => {
    const out = mapConditions(child, change)
    return out ? [out] : []
  })
  if ('not' in tree) return children[0] ? { not: children[0] } : null
  return withChildren(tree, children)
}

export function renameVariable(tree: Tree, from: string, to: string): Tree {
  const rename = (value: FilterScalar): FilterScalar => (isVariableRef(value) && value.var === from ? variableRef(to) : value)
  return mapConditions(tree, (condition) => {
    const raw = condition.value
    if (raw === undefined) return condition
    return { ...condition, value: Array.isArray(raw) ? raw.map(rename) : rename(raw) }
  })
}

export function dropVariable(tree: Tree, name: string): Tree {
  const out = mapConditions(tree, (condition) => {
    const raw = condition.value
    if (raw === undefined) return condition
    if (Array.isArray(raw)) {
      const kept = raw.filter((value) => !(isVariableRef(value) && value.var === name))
      if (kept.length === raw.length) return condition
      return kept.length === 0 ? null : { ...condition, value: kept }
    }
    return isVariableRef(raw) && raw.var === name ? null : condition
  })
  return pruneFilter(out)
}

export function withoutFields(tree: Tree, drop: (column: Column) => boolean): Tree {
  return mapConditions(tree, (condition) => {
    const column = columnOf(condition)
    return column && drop(column) ? null : condition
  })
}

export function pruneFilter(tree: Tree): Tree {
  if (!tree) return null
  if (kindOf(tree) === 'condition') return tree
  const children = childrenOf(tree).flatMap((child) => {
    const out = pruneFilter(child)
    return out ? [out] : []
  })
  if (children.length === 0) return null
  return withChildren(tree, children)
}
