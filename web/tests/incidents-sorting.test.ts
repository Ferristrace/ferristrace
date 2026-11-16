import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sorted } from '../src/lib/sorting.ts'
import { groupValue, incidentValue, issueValue, notifiesLabel, pageValue, ruleValue, type IncidentRow, type RuleLine } from '../src/pages/alerting/sorting.ts'

const rule = (name: string, over: Partial<RuleLine> = {}): RuleLine => ({ name, signal: 'traces', severity: 'info', status: 'ok', since_ms: 0, project: 'p', notifies: [], enabled: true, ...over })

test('@spec-l19-10 the Notifies cell shows the first channel and how many more', () => {
  assert.equal(notifiesLabel([]), '')
  assert.equal(notifiesLabel(['Email']), 'Email')
  assert.equal(notifiesLabel(['Slack', 'Email', 'Hook']), 'Slack +2')
})

test('@spec-l19-10 rules sort by severity and state rank, not by the word', () => {
  const rows = [rule('a', { severity: 'info' }), rule('b', { severity: 'critical' }), rule('c', { severity: 'warning' })]
  assert.deepEqual(sorted(rows, { key: 'severity', dir: 'desc' }, ruleValue).map((r) => r.name), ['b', 'c', 'a'])
  const states = [rule('ok'), rule('firing', { status: 'firing', since_ms: 5 }), rule('older', { status: 'firing', since_ms: 1 }), rule('pending', { status: 'pending' })]
  assert.deepEqual(sorted(states, { key: 'state', dir: 'desc' }, ruleValue).map((r) => r.name), ['firing', 'older', 'pending', 'ok'])
})

test('@spec-l19-10 rules sort by their first channel and leave the unnotified last', () => {
  const rows = [rule('none'), rule('z', { notifies: ['Zed', 'Alpha'] }), rule('a', { notifies: ['Alpha'] })]
  assert.deepEqual(sorted(rows, { key: 'notifies', dir: 'asc' }, ruleValue).map((r) => r.name), ['a', 'z', 'none'])
  assert.deepEqual(sorted(rows, { key: 'notifies', dir: 'desc' }, ruleValue).map((r) => r.name), ['z', 'a', 'none'])
})

test('@spec-l19-10 incidents sort by severity and status rank and by owner', () => {
  const row = (title: string, over: Partial<IncidentRow>): IncidentRow => ({ title, severity: 'sev3', status: 'investigating', owner: null, project: 'p', opened_ms: 0, ...over })
  const rows = [row('c', { severity: 'sev4' }), row('a', { severity: 'sev1', owner: 'Zoe' }), row('b', { severity: 'sev2', owner: 'Ana' })]
  assert.deepEqual(sorted(rows, { key: 'severity', dir: 'desc' }, incidentValue).map((r) => r.title), ['a', 'b', 'c'])
  assert.deepEqual(sorted(rows, { key: 'owner', dir: 'asc' }, incidentValue).map((r) => r.title), ['b', 'a', 'c'])
  const open = [row('done', { status: 'resolved' }), row('live', { status: 'investigating' })]
  assert.deepEqual(sorted(open, { key: 'status', dir: 'desc' }, incidentValue).map((r) => r.title), ['live', 'done'])
})

test('@spec-l19-10 issues sort by events and by owner name', () => {
  const rows = [{ exception_type: 'A', service: 's', events: 3, last_seen_at_ms: 1, owner: 'x' }, { exception_type: 'B', service: 's', events: 9, last_seen_at_ms: 2, owner: null }]
  assert.deepEqual(sorted(rows, { key: 'events', dir: 'desc' }, (r, k) => issueValue(r, k, r.owner)).map((r) => r.exception_type), ['B', 'A'])
  assert.deepEqual(sorted(rows, { key: 'owner', dir: 'asc' }, (r, k) => issueValue(r, k, r.owner)).map((r) => r.exception_type), ['A', 'B'])
})

test('@spec-l19-10 pages and insight groups sort with missing times last', () => {
  const page = (headline: string, acknowledgeMs: number | null) => ({ headline, state: 'triggered', target: 't', step: 0, acknowledgeMs, created_ms: 0 })
  const pages = [page('slow', 90), page('never', null), page('fast', 10)]
  assert.deepEqual(sorted(pages, { key: 'acknowledge', dir: 'asc' }, pageValue).map((r) => r.headline), ['fast', 'slow', 'never'])
  const groups = [{ label: 'a', incidents: 1, open: 0, acknowledgeMs: null, resolveMs: 5 }, { label: 'b', incidents: 4, open: 1, acknowledgeMs: 2, resolveMs: null }]
  assert.deepEqual(sorted(groups, { key: 'incidents', dir: 'desc' }, groupValue).map((r) => r.label), ['b', 'a'])
  assert.deepEqual(sorted(groups, { key: 'resolve', dir: 'asc' }, groupValue).map((r) => r.label), ['a', 'b'])
})
