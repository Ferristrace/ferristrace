import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, describe, it } from 'node:test'
import { load, stop } from './harness.ts'

const geometry = await load<typeof import('../src/components/ft/panels/geometry')>('components/ft/panels/geometry.ts')
const lines = await load<typeof import('../src/components/ft/percentiles')>('components/ft/percentiles.ts')

after(stop)

const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/styles/globals.css'), 'utf8')

const block = (opening: string): Map<string, string> => {
  const start = css.indexOf(`${opening} {`)
  assert.ok(start >= 0, `${opening} block exists`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start))
  const found = new Map<string, string>()
  for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) found.set(name, value.trim())
  return found
}

const light = block(':root, .light')

const themes = { light, dark: new Map([...light, ...block('.dark')]) }

const resolve = (theme: Map<string, string>, name: string): string => {
  let value = theme.get(name)
  assert.ok(value !== undefined, `${name} is defined`)
  for (let depth = 0; depth < 6; depth++) {
    const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value ?? '')
    if (!alias) break
    value = theme.get(alias[1])
  }
  assert.match(value ?? '', /^#[0-9a-f]{6}$/i, `${name} resolves to a hex colour`)
  return value as string
}

const channels = (hex: string): [number, number, number] => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]

const luminance = (hex: string): number => {
  const [r, g, b] = channels(hex).map((value) => {
    const unit = value / 255
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const ratio = (a: string, b: string): number => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

const over = (foreground: string, background: string, alpha: number): string => {
  const f = channels(foreground)
  const b = channels(background)
  return `#${f.map((value, at) => Math.round(value * alpha + b[at] * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`
}

const TEXT = 4.5
const GRAPHIC = 3

for (const [mode, theme] of Object.entries(themes)) {
  describe(`contrast in ${mode} (@spec-l18-10)`, () => {
    const card = resolve(theme, '--card')
    const popover = resolve(theme, '--popover')
    const at = (name: string, background = card) => ratio(resolve(theme, name), background)

    it('axis text is at least 4.5:1 on the card', () => {
      assert.ok(at('--chart-axis') >= TEXT, `${at('--chart-axis')}`)
    })

    it('legend text, its overflow note and the live values are at least 4.5:1', () => {
      for (const name of ['--muted-foreground', '--faint-foreground', '--foreground']) assert.ok(at(name) >= TEXT, `${name} ${at(name)}`)
    })

    it('tooltip text is at least 4.5:1 on the popover', () => {
      for (const name of ['--popover-foreground', '--muted-foreground', '--faint-foreground']) assert.ok(at(name, popover) >= TEXT, `${name} ${at(name, popover)}`)
    })

    it('every series colour is at least 3:1 on the card', () => {
      const names = ['--chart-line', '--chart-p50', '--chart-p95', '--chart-p99', '--warning-text', ...Array.from({ length: 8 }, (_, index) => `--svc-${index + 1}`)]
      for (const name of names) assert.ok(at(name) >= GRAPHIC, `${name} ${at(name)}`)
    })

    it('the palette of the dashboard charts only names defined tokens that pass', () => {
      for (const colour of geometry.PALETTE) {
        const name = /^var\((--[a-z0-9-]+)\)$/.exec(colour)?.[1]
        assert.ok(name, `${colour} is a token`)
        assert.ok(at(name) >= GRAPHIC, `${name} ${at(name)}`)
      }
    })

    it('the faded p50 line stays at least 3:1 once blended with the card', () => {
      const blended = over(resolve(theme, '--chart-p50'), card, lines.P50_OPACITY)
      assert.ok(ratio(blended, card) >= GRAPHIC, `${ratio(blended, card)}`)
    })
  })
}
