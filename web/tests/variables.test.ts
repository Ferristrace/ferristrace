import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { load, stop } from './harness.ts'

type Vars = typeof import('../src/pages/dashboards/editor/variablesEdit')
type Fixtures = typeof import('../src/components/ft/panels/fixtures')

const vars = await load<Vars>('pages/dashboards/editor/variablesEdit.ts')
const fixtures = await load<Fixtures>('components/ft/panels/fixtures.ts')

after(stop)

describe('variable names', () => {
  it('accepts lowercase letters, digits and underscores', () => {
    for (const name of ['service', 'env', '_x', 'a1', 'a_b_2', 'a'.repeat(32)]) assert.equal(vars.validateVariableName(name, []), null, name)
  })

  it('refuses an empty name', () => {
    assert.match(vars.validateVariableName('', []) ?? '', /name/i)
  })

  it('refuses more than 32 characters', () => {
    assert.match(vars.validateVariableName('a'.repeat(33), []) ?? '', /32/)
  })

  it('refuses a leading digit', () => {
    assert.match(vars.validateVariableName('1a', []) ?? '', /start/i)
  })

  it('refuses capitals, dashes, spaces and dots', () => {
    for (const name of ['Service', 'a-b', 'a b', 'a.b', 'é', '$x']) assert.match(vars.validateVariableName(name, []) ?? '', /a to z/, name)
  })

  it('refuses the names that would poison an object', () => {
    for (const name of ['__proto__', 'constructor', 'prototype']) assert.match(vars.validateVariableName(name, []) ?? '', /reserved/i, name)
  })

  it('refuses a name another variable holds', () => {
    assert.match(vars.validateVariableName('env', ['service', 'env']) ?? '', /already/i)
    assert.equal(vars.validateVariableName('stage', ['service', 'env']), null)
  })
})

describe('a variable as a whole', () => {
  const ok = { name: 'env', label: 'Environment', source: { kind: 'static' as const, values: ['prod'] }, multi: false, all: false }

  it('a complete variable has no issue', () => {
    assert.deepEqual(vars.variableIssues(ok, []), [])
    assert.deepEqual(vars.variableIssues({ ...ok, source: { kind: 'attribute', signal: 'logs', key: 'k8s.namespace.name' } }, []), [])
  })

  it('an attribute variable needs a key', () => {
    assert.match(vars.variableIssues({ ...ok, source: { kind: 'attribute', signal: 'traces', key: ' ' } }, []).join(' '), /attribute key/i)
  })

  it('a static variable lists 1 to 100 values of 1 to 512 bytes', () => {
    assert.match(vars.variableIssues({ ...ok, source: { kind: 'static', values: [] } }, []).join(' '), /1 to 100/)
    assert.match(vars.variableIssues({ ...ok, source: { kind: 'static', values: Array.from({ length: 101 }, (_, at) => `v${at}`) } }, []).join(' '), /1 to 100/)
    assert.match(vars.variableIssues({ ...ok, source: { kind: 'static', values: ['a', ''] } }, []).join(' '), /1 to 512/)
    assert.match(vars.variableIssues({ ...ok, source: { kind: 'static', values: ['x'.repeat(513)] } }, []).join(' '), /1 to 512/)
  })

  it('a label is at most 80 characters', () => {
    assert.match(vars.variableIssues({ ...ok, label: 'x'.repeat(81) }, []).join(' '), /80/)
  })

  it('reads the static values typed one per line', () => {
    assert.deepEqual(vars.parseValues('prod\n staging \n\nprod'), ['prod', 'staging'])
    assert.deepEqual(vars.parseValues(''), [])
  })

  it('offers a new variable with a name no one holds', () => {
    const first = vars.newVariable([])
    assert.equal(vars.validateVariableName(first.name, []), null)
    const second = vars.newVariable([first])
    assert.notEqual(second.name, first.name)
  })

  it('lists the issues of every variable of a dashboard', () => {
    assert.deepEqual(vars.allVariableIssues(fixtures.FIXTURE_DOC.variables), [])
    assert.match(vars.allVariableIssues([ok, ok]).join(' '), /already/i)
    assert.match(vars.allVariableIssues(Array.from({ length: 21 }, (_, at) => ({ ...ok, name: `v${at}` }))).join(' '), /20 variables/)
  })
})

describe('using and removing a variable', () => {
  it('finds the panels whose filter uses it', () => {
    assert.deepEqual(vars.variableUsage(fixtures.FIXTURE_DOC, 'service').map((panel) => panel.id), ['errors'])
    assert.deepEqual(vars.variableUsage(fixtures.FIXTURE_DOC, 'env'), [])
    assert.deepEqual(vars.variableUsage(fixtures.FIXTURE_DOC, 'ghost'), [])
  })

  it('deleting it drops the variable and the conditions that used it', () => {
    const out = vars.deleteVariable(fixtures.FIXTURE_DOC, 'service')
    assert.deepEqual(out.variables.map((one) => one.name), ['env'])
    const errors = out.panels.find((panel) => panel.id === 'errors')
    assert.deepEqual(errors?.queries[0].filter, { all: [{ field: 'status', op: 'eq', value: 'error' }] })
    assert.equal(vars.variableUsage(out, 'service').length, 0)
  })

  it('renaming it follows the references', () => {
    const out = vars.renameVariableIn(fixtures.FIXTURE_DOC, 'service', 'svc')
    assert.deepEqual(out.variables.map((one) => one.name), ['svc', 'env'])
    assert.deepEqual(vars.variableUsage(out, 'svc').map((panel) => panel.id), ['errors'])
    assert.deepEqual(vars.variableUsage(out, 'service'), [])
  })

  it('does not change the document it was given', () => {
    const before = JSON.stringify(fixtures.FIXTURE_DOC)
    vars.deleteVariable(fixtures.FIXTURE_DOC, 'service')
    vars.renameVariableIn(fixtures.FIXTURE_DOC, 'service', 'svc')
    assert.equal(JSON.stringify(fixtures.FIXTURE_DOC), before)
  })
})

describe('keeping card state with the right variable', () => {
  const make = () => {
    let at = 0
    return () => `n${(at += 1)}`
  }
  const one = (name: string) => ({ name, label: '', source: { kind: 'static' as const, values: ['x'] }, multi: false, all: false })

  it('drops the id of the variable that was deleted, not the last one', () => {
    const before = [one('a'), one('b'), one('c')]
    assert.deepEqual(vars.reconcileIds(['i1', 'i2', 'i3'], before, [one('a'), one('c')], make()), ['i1', 'i3'])
  })

  it('after deleting the first, editing the next one still hits its own id', () => {
    const ids = vars.reconcileIds(['i1', 'i2'], [one('a'), one('b')], [one('b')], make())
    assert.deepEqual(ids, ['i2'])
    const renamed = vars.reconcileIds(ids, [one('b')], [one('b2')], make())
    assert.deepEqual(renamed, ['i2'])
  })

  it('adds a fresh id for a new variable and keeps the rest', () => {
    assert.deepEqual(vars.reconcileIds(['i1'], [one('a')], [one('a'), one('b')], make()), ['i1', 'n1'])
  })

  it('repairs a list of the wrong length', () => {
    assert.deepEqual(vars.reconcileIds([], [], [one('a')], make()), ['n1'])
  })
})
