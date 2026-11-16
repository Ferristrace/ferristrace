import { MoreHorizontal, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Condition, FilterDoc, FilterOp, FilterScalar, QuerySignal } from '@/data/dashboards'
import { ColumnPicker } from './ColumnPicker'
import { useEditorEnv } from './env'
import {
  MAX_CONDITIONS,
  addCondition,
  addGroup,
  canNest,
  childrenOf,
  columnOf,
  countConditions,
  emptyCondition,
  isVariableRef,
  kindOf,
  parseScalar,
  removeAt,
  scalarText,
  setGroupKind,
  unwrap,
  updateCondition,
  variableRef,
  wrap,
  type GroupKind,
  type Path,
  type Tree,
} from './filterTree'
import { NUMERIC } from './kinds'

const OPS: { value: FilterOp; label: string }[] = [
  { value: 'eq', label: 'is' },
  { value: 'ne', label: 'is not' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'in', label: 'is one of' },
  { value: 'not_in', label: 'is none of' },
  { value: 'exists', label: 'exists' },
  { value: 'not_exists', label: 'does not exist' },
]

const isBare = (op: FilterOp): boolean => op === 'exists' || op === 'not_exists'

const isList = (op: FilterOp): boolean => op === 'in' || op === 'not_in'

const textOf = (value: Condition['value']): string => (value === undefined ? '' : Array.isArray(value) ? value.map((one) => scalarText(one)).join(', ') : scalarText(value))

function tokenOf(text: string, numeric: boolean, names: string[]): FilterScalar {
  const trimmed = text.trim()
  if (trimmed.startsWith('$') && names.includes(trimmed.slice(1))) return variableRef(trimmed.slice(1))
  return parseScalar(text, numeric)
}

function valueOf(text: string, op: FilterOp, numeric: boolean, names: string[]): Condition['value'] {
  if (isList(op)) return text.split(',').map((part) => part.trim()).filter((part) => part !== '').map((part) => tokenOf(part, numeric, names))
  return tokenOf(text, numeric, names)
}

function ValueCell({ condition, onChange }: { condition: Condition; onChange: (value: Condition['value']) => void }) {
  const { variables } = useEditorEnv()
  const names = variables.map((one) => one.name)
  const column = columnOf(condition)
  const numeric = (column !== null && 'field' in column && NUMERIC.includes(column.field)) || ['gt', 'gte', 'lt', 'lte'].includes(condition.op)
  const [text, setText] = useState(textOf(condition.value))
  const same = JSON.stringify(valueOf(text, condition.op, numeric, names)) === JSON.stringify(condition.value)
  useEffect(() => {
    if (!same) setText(textOf(condition.value))
  }, [condition.value, condition.op])
  if (isBare(condition.op)) return null
  const value = condition.value
  if (!Array.isArray(value) && isVariableRef(value)) {
    return (
      <span className="inline-flex h-8 items-center gap-1 rounded-md border bg-accent-subtle pl-2.5 pr-1 font-mono text-control text-accent-text">
        ${value.var}
        <button type="button" aria-label={`Stop using the variable ${value.var}`} onClick={() => onChange('')} className="inline-flex size-6 cursor-pointer items-center justify-center rounded-sm hover:bg-background/60 focus-visible:outline-2 focus-visible:outline-ring"><X className="size-3" aria-hidden /></button>
      </span>
    )
  }
  const insert = (name: string) => {
    if (isList(condition.op)) {
      const held = Array.isArray(value) ? value : value === undefined || value === '' ? [] : [value]
      onChange([...held, variableRef(name)])
      setText([...held.map((one) => scalarText(one)), `$${name}`].join(', '))
    } else onChange(variableRef(name))
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Input
        mono={numeric}
        aria-label={isList(condition.op) ? 'Values, separated by commas' : 'Value'}
        placeholder={isList(condition.op) ? 'a, b, c' : 'value'}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          onChange(valueOf(event.target.value, condition.op, numeric, names))
        }}
        className="w-[200px]"
      />
      {names.length > 0 ? (
        <NativeSelect aria-label="Use a variable" value="" onChange={(event) => event.target.value && insert(event.target.value)} className="w-[110px]">
          <option value="">$ variable</option>
          {names.map((name) => <option key={name} value={name}>${name}</option>)}
        </NativeSelect>
      ) : null}
    </span>
  )
}

function NodeMenu({ tree, path, onChange }: { tree: Tree; path: Path; onChange: (next: Tree) => void }) {
  const [open, setOpen] = useState(false)
  const node = path.length === 0 ? tree : childrenAt(tree, path)
  const nestable = canNest(tree)
  const act = (next: Tree) => {
    setOpen(false)
    onChange(next)
  }
  const item = 'flex w-full cursor-pointer items-center rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-control hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="More actions for this filter line"><MoreHorizontal aria-hidden /></Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[210px] p-1">
        <button type="button" className={item} disabled={!nestable} onClick={() => act(wrap(tree, path, 'not'))}>Wrap in NOT</button>
        <button type="button" className={item} disabled={!nestable} onClick={() => act(wrap(tree, path, 'all'))}>Wrap in an AND group</button>
        <button type="button" className={item} disabled={!nestable} onClick={() => act(wrap(tree, path, 'any'))}>Wrap in an OR group</button>
        <button type="button" className={item} disabled={node === null || kindOf(node) === 'condition'} onClick={() => act(unwrap(tree, path))}>Unwrap</button>
        <button type="button" className={`${item} text-destructive-text`} onClick={() => act(removeAt(tree, path))}>Remove</button>
      </PopoverContent>
    </Popover>
  )
}

const childrenAt = (tree: Tree, path: Path): FilterDoc | null => {
  let node: FilterDoc | null = tree
  for (const index of path) node = node ? (childrenOf(node)[index] ?? null) : null
  return node
}

function Line({ tree, path, signal, metric, onChange }: { tree: Tree; path: Path; signal: QuerySignal; metric: string; onChange: (next: Tree) => void }) {
  const node = path.length === 0 ? tree : childrenAt(tree, path)
  if (!node) return null
  const kind = kindOf(node)
  const room = countConditions(tree) < MAX_CONDITIONS
  if (kind === 'condition') {
    const condition = node as Condition
    return (
      <div role="group" aria-label="Filter condition" className="flex flex-wrap items-center gap-1.5">
        <ColumnPicker
          value={columnOf(condition)}
          onChange={(column) => onChange(updateCondition(tree, path, 'attr' in column ? { attr: column.attr } : { field: column.field }))}
          signal={signal}
          metric={metric}
          label="Filter field"
          className="w-[150px]"
        />
        <NativeSelect aria-label="Operator" value={condition.op} onChange={(event) => onChange(updateCondition(tree, path, { op: event.target.value as FilterOp }))} className="w-[150px]">
          {OPS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
        </NativeSelect>
        <ValueCell condition={condition} onChange={(value) => onChange(updateCondition(tree, path, { value }))} />
        <NodeMenu tree={tree} path={path} onChange={onChange} />
      </div>
    )
  }
  if (kind === 'not') {
    return (
      <div role="group" aria-label="NOT" className="flex flex-col gap-1.5 rounded-md border border-dashed p-2">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" mono>NOT</Badge>
          <span className="flex-1 text-caption text-muted-foreground">Matches when the line below does not.</span>
          <NodeMenu tree={tree} path={path} onChange={onChange} />
        </div>
        <Line tree={tree} path={[...path, 0]} signal={signal} metric={metric} onChange={onChange} />
      </div>
    )
  }
  const children = childrenOf(node)
  const group = kind as GroupKind
  return (
    <div role="group" aria-label={group === 'all' ? 'AND group' : 'OR group'} className="flex flex-col gap-2 rounded-md border bg-muted/40 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <NativeSelect aria-label="Combine with" value={group} onChange={(event) => onChange(setGroupKind(tree, path, event.target.value as GroupKind))} className="w-[110px]">
          <option value="all">All of</option>
          <option value="any">Any of</option>
        </NativeSelect>
        <span className="flex-1 text-caption text-muted-foreground">{group === 'all' ? 'every line below must match' : 'one line below is enough'}</span>
        <Button size="sm" disabled={!room} title={room ? undefined : `A filter holds at most ${MAX_CONDITIONS} conditions.`} onClick={() => onChange(addCondition(tree, path, emptyCondition(signal === 'logs' ? 'severity' : 'service')))}><Plus aria-hidden />Condition</Button>
        <Button size="sm" disabled={!canNest(tree)} title={canNest(tree) ? undefined : 'Groups nest at most eight deep.'} onClick={() => onChange(addGroup(tree, path, group === 'all' ? 'any' : 'all'))}><Plus aria-hidden />Group</Button>
        {path.length > 0 || children.length > 0 ? <NodeMenu tree={tree} path={path} onChange={onChange} /> : null}
      </div>
      {children.length === 0 ? <p className="m-0 text-caption text-muted-foreground">An empty group is dropped when the dashboard is saved.</p> : null}
      {children.map((_, at) => <Line key={at} tree={tree} path={[...path, at]} signal={signal} metric={metric} onChange={onChange} />)}
    </div>
  )
}

export function FilterBuilder({ value, onChange, signal, metric }: { value: Tree; onChange: (next: Tree) => void; signal: QuerySignal; metric: string }) {
  if (value === null) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-muted-foreground">No filter: every row in the range counts.</span>
        <Button size="sm" onClick={() => onChange(addCondition(null, [], emptyCondition(signal === 'logs' ? 'severity' : 'service')))}><Plus aria-hidden />Add a condition</Button>
      </div>
    )
  }
  return <Line tree={value} path={[]} signal={signal} metric={metric} onChange={onChange} />
}
