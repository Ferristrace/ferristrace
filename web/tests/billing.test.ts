import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createElement, html, load, stop } from './harness.ts'

type Data = typeof import('../src/data/billing')
type Page = typeof import('../src/pages/settings/Billing')

const data = await load<Data>('data/billing.ts')
const page = await load<Page>('pages/settings/Billing.tsx')

after(stop)

const free: import('../src/data/billing').Billing = { plan: 'free', status: null, period_end_ms: null }
const pro: import('../src/data/billing').Billing = { plan: 'pro', status: 'active', period_end_ms: Date.UTC(2026, 10, 1) }

const render = (billing: import('../src/data/billing').Billing | undefined, over: Partial<Parameters<typeof page.BillingPage>[0]> = {}) =>
  html(createElement(page.BillingPage, {
    billing,
    nothing: 'Reading the billing…',
    upgrading: false,
    managing: false,
    onUpgrade: () => {},
    onManage: () => {},
    ...over,
  }))

describe('billing: plan copy and request shape', () => {
  it('describes the sub-header for free and pro, with no period on free', () => {
    assert.equal(data.planSub(free), 'Free plan')
    assert.equal(data.planSub(pro), 'Pro plan · renews Nov 1, 2026')
    assert.equal(data.planSub({ plan: 'pro', status: 'past_due', period_end_ms: null }), 'Pro plan')
  })

  it('builds the checkout and portal bodies from the current url, both urls equal', () => {
    assert.deepEqual(data.checkoutBody('https://app.example/settings/billing'), {
      success_url: 'https://app.example/settings/billing',
      cancel_url: 'https://app.example/settings/billing',
    })
    assert.deepEqual(data.portalBody('https://app.example/settings/billing'), {
      return_url: 'https://app.example/settings/billing',
    })
  })

  it('reads the current url from window origin and pathname, dropping query and hash', () => {
    Object.assign(globalThis, { window: { location: { origin: 'https://app.example', pathname: '/settings/billing', search: '?x=1', hash: '#y' } } })
    assert.equal(data.currentUrl(), 'https://app.example/settings/billing')
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('never shows a price, amount, currency or payment method anywhere in the plan copy', () => {
    for (const copy of Object.values(data.PLAN_COPY)) assert.doesNotMatch(copy, /€|\$|price|invoice|payment/i)
  })
})

describe('@spec-l20b billing page', () => {
  it('while the org or the billing read is unknown, shows the loading/empty message and no plan UI', () => {
    const out = render(undefined)
    assert.match(out, /Reading the billing…/)
    assert.doesNotMatch(out, /Upgrade to Pro/)
    assert.doesNotMatch(out, /Manage billing/)
  })

  it('a free organisation sees the upgrade action and the free plan copy, no portal link', () => {
    const out = render(free)
    assert.match(out, /Free plan/)
    assert.match(out, /30 GB ingest per month, 7-day retention/)
    assert.match(out, /Upgrade to Pro/)
    assert.doesNotMatch(out, /Manage billing/)
    assert.doesNotMatch(out, /€|\$/)
  })

  it('a pro organisation sees the manage action, its billing period and the pro plan copy, no upgrade link', () => {
    const out = render(pro)
    assert.match(out, /Pro plan · renews Nov 1, 2026/)
    assert.match(out, /100 GB ingest per month, 30-day retention/)
    assert.match(out, /Manage billing/)
    assert.doesNotMatch(out, /Upgrade to Pro/)
  })

  it('disables the action button while its mutation is in flight', () => {
    const upgrading = render(free, { upgrading: true })
    assert.match(upgrading, /disabled=""/)
    const managing = render(pro, { managing: true })
    assert.match(managing, /disabled=""/)
  })
})
