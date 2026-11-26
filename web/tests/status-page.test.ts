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
