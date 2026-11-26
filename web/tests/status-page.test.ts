import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, describe, it } from 'node:test'
import { createElement, html, load, stop } from './harness.ts'

type StatusData = typeof import('../src/data/status-page')
type StatusViewMod = typeof import('../src/components/ft/StatusPageView')

const statusData = await load<StatusData>('data/status-page.ts')
const statusView = await load<StatusViewMod>('components/ft/StatusPageView.tsx')

after(stop)

const sample = (mode: StatusData['Mode'], accent: StatusData['Accent'] = 'teal'): StatusData['PublicStatus'] => ({
  page: {
    org_slug: 'mercato',
    slug: 'prod',
    name: 'Mercato',
    theme: { accent, mode },
    intro: null,
    hide_from_search: false,
    updated_ms: 1_700_000_000_000,
  },
  overall: 'operational',
  components: [],
  incidents: [],
})

const NOW = 1_700_000_000_000
const HOUR = 3_600_000

const running: StatusData['PublicMaintenance'] = {
  id: 'm1',
  title: 'Database upgrade',
  details: 'Read only for a while.',
  starts_ms: NOW - HOUR,
  ends_ms: NOW + HOUR,
  ended_ms: null,
  phase: 'in_progress',
  components: ['Checkout'],
}

const planned: StatusData['PublicMaintenance'] = { ...running, id: 'm2', title: 'Network move', starts_ms: NOW + 24 * HOUR, ends_ms: NOW + 26 * HOUR, phase: 'scheduled', components: ['API'] }

const finished: StatusData['PublicMaintenance'] = { ...running, id: 'm3', title: 'Cache refresh', starts_ms: NOW - 30 * HOUR, ends_ms: NOW - 28 * HOUR, ended_ms: NOW - 29 * HOUR, phase: 'completed' }

describe('status page maintenances', () => {
  it('counts a maintenance day as up', () => {
    assert.equal(statusData.uptimeLabel(['operational', 'maintenance']), '100% uptime')
    assert.equal(statusData.uptimeLabel(['maintenance', 'down']), '50% uptime')
    assert.equal(statusData.uptimeLabel([null, null]), '— uptime')
  })

  it('words the maintenance status', () => {
    assert.equal(statusData.STATUS_WORDS.maintenance, 'Under maintenance')
    assert.equal(statusData.OVERALL_WORDS.maintenance, 'Maintenance in progress')
  })

  it('splits public maintenances by phase and treats a missing list as empty', () => {
    const agenda = statusData.publicAgenda([finished, planned, running])
    assert.deepEqual(agenda.running.map((one) => one.id), ['m1'])
    assert.deepEqual(agenda.upcoming.map((one) => one.id), ['m2'])
    assert.deepEqual(agenda.recent.map((one) => one.id), ['m3'])
    assert.deepEqual(statusData.publicAgenda(undefined), { running: [], upcoming: [], recent: [] })
  })

  it('splits admin maintenances and drops nothing', () => {
    const body = (id: string, phase: StatusData['MaintenancePhase'], starts: number): StatusData['Maintenance'] => ({
      id, title: id, details: null, starts_ms: starts, ends_ms: starts + HOUR, phase, closed_ms: null, components: [], created_ms: 0, updated_ms: 0,
    })
    const agenda = statusData.agendaOf([body('b', 'scheduled', 20), body('a', 'scheduled', 10), body('c', 'cancelled', 5), body('d', 'in_progress', 1), body('e', 'completed', 8)])
    assert.deepEqual(agenda.running.map((one) => one.id), ['d'])
    assert.deepEqual(agenda.upcoming.map((one) => one.id), ['a', 'b'])
    assert.deepEqual(agenda.past.map((one) => one.id), ['e', 'c'])
  })

  it('converts datetime-local values to milliseconds and back', () => {
    const ms = statusData.fromLocalInput('2026-12-01T09:30')
    assert.equal(ms, new Date(2026, 11, 1, 9, 30).getTime())
    assert.equal(statusData.toLocalInput(ms ?? 0), '2026-12-01T09:30')
    assert.equal(statusData.fromLocalInput(''), null)
    assert.equal(statusData.fromLocalInput('nonsense'), null)
  })

  it('checks the window the way the server does', () => {
    assert.equal(statusData.windowProblem(NOW + HOUR, NOW + 2 * HOUR, NOW), null)
    assert.match(statusData.windowProblem(null, NOW, NOW) ?? '', /Choose/)
    assert.match(statusData.windowProblem(NOW + 2 * HOUR, NOW + HOUR, NOW) ?? '', /after the start/)
    assert.match(statusData.windowProblem(NOW, NOW + 8 * 24 * HOUR, NOW) ?? '', /7 days/)
    assert.match(statusData.windowProblem(NOW - 2 * HOUR, NOW - HOUR, NOW) ?? '', /future/)
  })

  it('groups targets by page in order', () => {
    const groups = statusData.groupByPage([
      { id: '1', name: 'A', page_id: 'p1', page_name: 'Main' },
      { id: '2', name: 'B', page_id: 'p2', page_name: 'Docs' },
      { id: '3', name: 'C', page_id: 'p1', page_name: 'Main' },
    ])
    assert.deepEqual(groups.map((one) => [one.page_name, one.components.map((c) => c.name)]), [['Main', ['A', 'C']], ['Docs', ['B']]])
  })

  it('shows the banner, the running card and the upcoming section on the public page', () => {
    const view: StatusData['PublicStatus'] = {
      ...sample('light'),
      overall: 'maintenance',
      components: [{ name: 'Checkout', status: 'maintenance', days: Array.from({ length: 30 }, () => 'maintenance' as const) }],
      maintenances: [running, planned, finished],
    }
    const page = html(createElement(statusView.StatusPageView, { view }))
    assert.match(page, /Maintenance in progress/)
    assert.match(page, /Database upgrade/)
    assert.match(page, /Upcoming maintenance/)
    assert.match(page, /Network move/)
    assert.match(page, /Cache refresh/)
    assert.match(page, /Under maintenance/)
    assert.match(page, /100% uptime/)
  })

  it('renders a view without a maintenances field', () => {
    const page = html(createElement(statusView.StatusPageView, { view: sample('light') }))
    assert.doesNotMatch(page, /Upcoming maintenance/)
  })
})

describe('status page theme mode', () => {
  it('resolves explicit light and dark modes regardless of the visitor preference', () => {
    assert.equal(statusData.resolveStatusDark('light', true), false)
    assert.equal(statusData.resolveStatusDark('light', false), false)
    assert.equal(statusData.resolveStatusDark('dark', false), true)
    assert.equal(statusData.resolveStatusDark('dark', true), true)
  })

  it('follows the visitor preference when mode is auto or not loaded yet', () => {
    assert.equal(statusData.resolveStatusDark('auto', true), true)
    assert.equal(statusData.resolveStatusDark('auto', false), false)
    assert.equal(statusData.resolveStatusDark(undefined, true), true)
    assert.equal(statusData.resolveStatusDark(undefined, false), false)
  })

  it('stamps explicit light or dark mode on the public view while letting compact preview control its own container', () => {
    const light = html(createElement(statusView.StatusPageView, { view: sample('light', 'teal') }))
    assert.match(light, /^<div class="[^"]*\blight\b[^"]*\baccent-teal\b/)

    const dark = html(createElement(statusView.StatusPageView, { view: sample('dark', 'orange') }))
    assert.match(dark, /^<div class="[^"]*\bdark\b[^"]*\baccent-orange\b/)

    const auto = html(createElement(statusView.StatusPageView, { view: sample('auto', 'indigo') }))
    assert.doesNotMatch(auto, /^<div class="[^"]*\b(light|dark)\b/)

    const compact = html(createElement(statusView.StatusPageView, { view: sample('dark', 'teal'), compact: true }))
    assert.doesNotMatch(compact, /^<div class="[^"]*\bdark\b/)
    assert.match(compact, /^<div class="[^"]*\baccent-teal\b/)
  })

  it('scopes the dark custom variant and accent tokens out of explicit light containers', () => {
    const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/styles/globals.css'), 'utf8')
    assert.match(css, /@custom-variant dark \(&:where\(\.dark, \.dark \*\):not\(\.light, \.light \*\)\);/)
    assert.ok(css.indexOf('.light .accent-teal') > css.indexOf('.dark .accent-teal'))
  })
})
