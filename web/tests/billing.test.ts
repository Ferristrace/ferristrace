import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createElement, html, load, stop } from './harness.ts'

type Data = typeof import('../src/data/billing')
type Page = typeof import('../src/pages/settings/Billing')
type Billing = import('../src/data/billing').Billing

const data = await load<Data>('data/billing.ts')
const page = await load<Page>('pages/settings/Billing.tsx')

after(stop)

const selfHosted: Billing = {
  plan: { slug: 'self-hosted', name: 'Self-hosted', ingest_gb: null, retention_days: null, overage: false },
  payments: false,
  upgrade: null,
  portal: false,
  owner: true,
  status: null,
  period_end_ms: null,
}

const free: Billing = {
  plan: { slug: 'free', name: 'Free', ingest_gb: 30, retention_days: 7, overage: false },
  payments: true,
  upgrade: { slug: 'pro', name: 'Pro' },
  portal: false,
  owner: true,
  status: null,
  period_end_ms: null,
}

const pro: Billing = {
  plan: { slug: 'pro', name: 'Pro', ingest_gb: 100, retention_days: 30, overage: true },
  payments: true,
  upgrade: null,
  portal: true,
  owner: true,
  status: 'active',
  period_end_ms: Date.UTC(2026, 10, 1),
}

const render = (billing: Billing | undefined, over: Partial<Parameters<typeof page.BillingPage>[0]> = {}) =>
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
  it('names the plan in the sub-header, with the renewal only on a paid plan', () => {
    assert.equal(data.planSub(selfHosted), 'Self-hosted plan')
    assert.equal(data.planSub(free), 'Free plan')
    assert.equal(data.planSub(pro), 'Pro plan · renews Nov 1, 2026')
    assert.equal(data.planSub({ ...pro, period_end_ms: null }), 'Pro plan')
  })

  it('describes what a plan includes from its own limits', () => {
    assert.equal(data.planCopy(selfHosted.plan), 'No ingest limit.')
    assert.equal(data.planCopy(free.plan), '30 GB ingest per month, 7-day retention.')
    assert.equal(data.planCopy(pro.plan), '100 GB ingest per month, 30-day retention, pay-as-you-go beyond that.')
  })

  it('builds the checkout and portal bodies from the plan and the current url', () => {
    assert.deepEqual(data.checkoutBody('pro', 'https://app.example/settings/billing'), {
      plan: 'pro',
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

  it('never shows a price, amount, currency or payment method in the plan copy', () => {
    for (const billing of [selfHosted, free, pro]) assert.doesNotMatch(data.planCopy(billing.plan), /€|\$|price|invoice|payment/i)
  })
})

describe('@spec-l20b billing page', () => {
  it('while the org or the billing read is unknown, shows the loading/empty message and no plan UI', () => {
    const out = render(undefined)
    assert.match(out, /Reading the billing…/)
    assert.doesNotMatch(out, /Upgrade to/)
    assert.doesNotMatch(out, /Manage billing/)
  })

  it('a self-hosted organisation sees its own plan and no payment action', () => {
    const out = render(selfHosted)
    assert.match(out, /Self-hosted plan/)
    assert.match(out, /No ingest limit/)
    assert.doesNotMatch(out, /Free plan/)
    assert.doesNotMatch(out, /Upgrade to/)
    assert.doesNotMatch(out, /Manage billing/)
  })

  it('a free organisation sees the upgrade action named after the offer, no portal link', () => {
    const out = render(free)
    assert.match(out, /Free plan/)
    assert.match(out, /30 GB ingest per month, 7-day retention/)
    assert.match(out, /Upgrade to Pro/)
    assert.doesNotMatch(out, /Manage billing/)
    assert.doesNotMatch(out, /€|\$/)
  })

  it('a pro organisation sees the manage action, its billing period and its plan copy, no upgrade link', () => {
    const out = render(pro)
    assert.match(out, /Pro plan · renews Nov 1, 2026/)
    assert.match(out, /100 GB ingest per month, 30-day retention/)
    assert.match(out, /Manage billing/)
    assert.doesNotMatch(out, /Upgrade to/)
  })

  it('a member who is not an owner sees the plan but no payment action', () => {
    const out = render({ ...free, owner: false })
    assert.match(out, /Only an owner manages billing/)
    assert.doesNotMatch(out, /Upgrade to/)
    assert.doesNotMatch(out, /Manage billing/)
  })

  it('disables the action button while its mutation is in flight', () => {
    assert.match(render(free, { upgrading: true }), /disabled=""/)
    assert.match(render(pro, { managing: true }), /disabled=""/)
  })
})
