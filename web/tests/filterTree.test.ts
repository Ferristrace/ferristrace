import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { load, stop } from './harness.ts'

type Tree = typeof import('../src/pages/dashboards/editor/filterTree')
type Filter = import('../src/data/dashboards').FilterDoc

const tree = await load<Tree>('pages/dashboards/editor/filterTree.ts')

after(stop)

const a: Filter = { field: 'service', op: 'eq', value: 'checkout' }
const b: Filter = { field: 'status', op: 'eq', value: 'error' }
const c: Filter = { attr: 'http.route', op: 'contains', value: '/pay' }

describe('adding', () => {
  it('starts an and group from nothing', () => {
    assert.deepEqual(tree.addCondition(null, [], a), { all: [a] })
  })

  it('appends to a group', () => {
    assert.deepEqual(tree.addCondition({ all: [a] }, [], b), { all: [a, b] })
  })

  it('appends to a nested group', () => {
    assert.deepEqual(tree.addCondition({ all: [a, { any: [b] }] }, [1], c), { all: [a, { any: [b, c] }] })
  })

  it('groups a bare root condition with the new one', () => {
    assert.deepEqual(tree.addCondition(a, [], b), { all: [a, b] })
  })

  it('adds a group', () => {
    assert.deepEqual(tree.addGroup({ all: [a] }, [], 'any'), { all: [a, { any: [] }] })
    assert.deepEqual(tree.addGroup(null, [], 'any'), { all: [{ any: [] }] })
  })

  it('adds into the child of a not', () => {
    assert.deepEqual(tree.addCondition({ not: { all: [a] } }, [0], b), { not: { all: [a, b] } })
  })

  it('does not change what it was given', () => {
    const start: Filter = { all: [a] }
    tree.addCondition(start, [], b)
    assert.deepEqual(start, { all: [a] })
  })

  it('refuses to nest past the depth the server reads', () => {
    let deep: Filter | null = null
    for (let at = 0; at < 12; at += 1) deep = tree.wrap(deep ?? a, [], 'all')
    assert.ok(tree.depthOf(deep) > tree.MAX_DEPTH)
    assert.equal(tree.canNest(deep), false)
    assert.equal(tree.canNest({ all: [a] }), true)
  })

  it('counts conditions against the server cap', () => {
    assert.equal(tree.countConditions({ all: [a, { any: [b, c] }] }), 3)
    assert.equal(tree.countConditions(null), 0)
    assert.equal(tree.MAX_CONDITIONS, 32)
  })
})

describe('removing', () => {
  it('removes a condition from a group', () => {
    assert.deepEqual(tree.removeAt({ all: [a, b] }, [0]), { all: [b] })
  })

  it('removes the root', () => {
    assert.equal(tree.removeAt({ all: [a] }, []), null)
    assert.equal(tree.removeAt(a, []), null)
  })

  it('removes the not around a condition that goes', () => {
    assert.deepEqual(tree.removeAt({ all: [a, { not: b }] }, [1, 0]), { all: [a] })
  })

  it('removes a whole nested group', () => {
    assert.deepEqual(tree.removeAt({ all: [a, { any: [b, c] }] }, [1]), { all: [a] })
  })

  it('ignores a path that leads nowhere', () => {
    assert.deepEqual(tree.removeAt({ all: [a] }, [4]), { all: [a] })
    assert.deepEqual(tree.removeAt({ all: [a] }, [0, 0, 0]), { all: [a] })
  })
})

describe('wrapping and unwrapping', () => {
  it('wraps a condition in an or group', () => {
    assert.deepEqual(tree.wrap({ all: [a, b] }, [1], 'any'), { all: [a, { any: [b] }] })
  })

  it('wraps in a not', () => {
    assert.deepEqual(tree.wrap({ all: [a, b] }, [0], 'not'), { all: [{ not: a }, b] })
  })

  it('wraps the root', () => {
    assert.deepEqual(tree.wrap({ all: [a] }, [], 'not'), { not: { all: [a] } })
  })

  it('unwraps a not', () => {
    assert.deepEqual(tree.unwrap({ all: [{ not: a }, b] }, [0]), { all: [a, b] })
  })

  it('unwraps a group of one into its parent group', () => {
    assert.deepEqual(tree.unwrap({ all: [a, { any: [b] }] }, [1]), { all: [a, b] })
  })

  it('splices a nested group of several into its parent group', () => {
    assert.deepEqual(tree.unwrap({ all: [a, { any: [b, c] }] }, [1]), { all: [a, b, c] })
  })

  it('unwraps a root group of one into the condition', () => {
    assert.deepEqual(tree.unwrap({ all: [a] }, []), a)
  })

  it('leaves a root group of several alone', () => {
    assert.deepEqual(tree.unwrap({ all: [a, b] }, []), { all: [a, b] })
  })

  it('leaves a condition alone', () => {
    assert.deepEqual(tree.unwrap({ all: [a, b] }, [0]), { all: [a, b] })
  })

  it('wrap then unwrap is the identity', () => {
    const start: Filter = { all: [a, b] }
    for (const kind of ['all', 'any', 'not'] as const) assert.deepEqual(tree.unwrap(tree.wrap(start, [1], kind), [1]), start)
  })
})

describe('editing a group and a condition', () => {
  it('switches a group between and and or', () => {
    assert.deepEqual(tree.setGroupKind({ all: [a, b] }, [], 'any'), { any: [a, b] })
    assert.deepEqual(tree.setGroupKind({ all: [a, { any: [b] }] }, [1], 'all'), { all: [a, { all: [b] }] })
  })

  it('changes the operator and clears the value for exists', () => {
    assert.deepEqual(tree.updateCondition({ all: [a] }, [0], { op: 'exists' }), { all: [{ field: 'service', op: 'exists' }] })
  })

  it('turns a value into a list for in and back to one value for eq', () => {
    const listed = tree.updateCondition({ all: [a] }, [0], { op: 'in' })
    assert.deepEqual(listed, { all: [{ field: 'service', op: 'in', value: ['checkout'] }] })
    assert.deepEqual(tree.updateCondition(listed, [0], { op: 'eq' }), { all: [{ field: 'service', op: 'eq', value: 'checkout' }] })
  })

  it('switches between a built in field and an attribute', () => {
    assert.deepEqual(tree.updateCondition({ all: [a] }, [0], { attr: 'k8s.pod.name' }), { all: [{ attr: 'k8s.pod.name', op: 'eq', value: 'checkout' }] })
    assert.deepEqual(tree.updateCondition({ all: [c] }, [0], { field: 'service' }), { all: [{ field: 'service', op: 'contains', value: '/pay' }] })
  })

  it('edits the condition of a bare root', () => {
    assert.deepEqual(tree.updateCondition(a, [], { value: 'cart' }), { field: 'service', op: 'eq', value: 'cart' })
  })

  it('reads the column of a condition', () => {
    assert.deepEqual(tree.columnOf({ field: 'service', op: 'eq' }), { field: 'service' })
    assert.deepEqual(tree.columnOf({ attr: 'x', op: 'eq' }), { attr: 'x' })
    assert.equal(tree.columnOf({ op: 'eq' }), null)
  })

  it('parses typed values', () => {
    assert.equal(tree.parseScalar('500', true), 500)
    assert.equal(tree.parseScalar('500', false), '500')
    assert.equal(tree.parseScalar('abc', true), 'abc')
    assert.equal(tree.parseScalar('', true), '')
    assert.deepEqual(tree.parseList('a, b ,,c', false), ['a', 'b', 'c'])
    assert.deepEqual(tree.parseList('1,2', true), [1, 2])
    assert.equal(tree.scalarText(12), '12')
    assert.equal(tree.scalarText(true), 'true')
    assert.equal(tree.scalarText('x'), 'x')
  })
})

describe('variable references', () => {
  const withVar: Filter = { all: [{ field: 'service', op: 'eq', value: { var: 'service' } }, b, { attr: 'env', op: 'in', value: [{ var: 'env' }, 'prod'] }] }

  it('builds and recognises a reference', () => {
    assert.deepEqual(tree.variableRef('service'), { var: 'service' })
    assert.equal(tree.isVariableRef({ var: 'x' }), true)
    assert.equal(tree.isVariableRef('x'), false)
    assert.equal(tree.isVariableRef(undefined), false)
  })

  it('lists the variables a filter uses, once each', () => {
    assert.deepEqual(tree.variablesUsed(withVar), ['service', 'env'])
    assert.deepEqual(tree.variablesUsed({ all: [{ field: 'service', op: 'eq', value: { var: 'service' } }, { field: 'name', op: 'eq', value: { var: 'service' } }] }), ['service'])
    assert.deepEqual(tree.variablesUsed(null), [])
  })

  it('sets a reference as the value of a condition', () => {
    assert.deepEqual(tree.updateCondition({ all: [a] }, [0], { value: tree.variableRef('service') }), { all: [{ field: 'service', op: 'eq', value: { var: 'service' } }] })
  })

  it('keeps a reference when the operator becomes in', () => {
    const out = tree.updateCondition({ all: [{ field: 'service', op: 'eq', value: { var: 'service' } }] }, [0], { op: 'in' })
    assert.deepEqual(out, { all: [{ field: 'service', op: 'in', value: [{ var: 'service' }] }] })
  })

  it('renames a variable inside conditions and lists', () => {
    assert.deepEqual(tree.renameVariable(withVar, 'env', 'stage'), { all: [{ field: 'service', op: 'eq', value: { var: 'service' } }, b, { attr: 'env', op: 'in', value: [{ var: 'stage' }, 'prod'] }] })
  })

  it('drops the conditions that use a deleted variable', () => {
    assert.deepEqual(tree.dropVariable(withVar, 'service'), { all: [b, { attr: 'env', op: 'in', value: [{ var: 'env' }, 'prod'] }] })
  })

  it('removes a list reference but keeps the literals', () => {
    assert.deepEqual(tree.dropVariable(withVar, 'env'), { all: [{ field: 'service', op: 'eq', value: { var: 'service' } }, b, { attr: 'env', op: 'in', value: ['prod'] }] })
  })

  it('drops a group that ends up empty, and the filter itself', () => {
    assert.equal(tree.dropVariable({ field: 'service', op: 'eq', value: { var: 'service' } }, 'service'), null)
    assert.deepEqual(tree.dropVariable({ all: [a, { any: [{ field: 'name', op: 'eq', value: { var: 'x' } }] }] }, 'x'), { all: [a] })
  })
})

describe('pruning what the server refuses', () => {
  it('removes empty groups at any depth', () => {
    assert.deepEqual(tree.pruneFilter({ all: [a, { any: [] }, { all: [{ not: { any: [] } }] }] }), { all: [a] })
  })

  it('removes a filter that is only an empty group', () => {
    assert.equal(tree.pruneFilter({ all: [] }), null)
    assert.equal(tree.pruneFilter(null), null)
  })

  it('keeps a filled filter exactly', () => {
    const filled: Filter = { all: [a, { not: b }, { any: [c, a] }] }
    assert.deepEqual(tree.pruneFilter(filled), filled)
  })

  it('removes the conditions that name a field the signal lacks', () => {
    const out = tree.withoutFields({ all: [a, { field: 'duration', op: 'gt', value: 5 }, { attr: 'x', op: 'exists' }] }, (column) => 'field' in column && column.field === 'duration')
    assert.deepEqual(out, { all: [a, { attr: 'x', op: 'exists' }] })
  })
})
