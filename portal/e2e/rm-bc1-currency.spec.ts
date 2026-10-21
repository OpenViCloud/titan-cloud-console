import { test, expect, request } from '@playwright/test'

// RM-BC1 staging verification (S-3/S-4/S-5). Read-only: only GETs, nothing is created.
//
// What this proves: the DEPLOYED read path still serves a currency and does not throw. What it does
// NOT prove: that the currency comes from the constant rather than the rows — every row on staging
// is already VND, so both the old rule and the new one return VND. That distinction is owned by the
// mutation test in the unit suite, not by this.
//
// The password comes from BETA_USER_PASSWORD (injected from the k8s secret at run time); trace,
// video and screenshots are off by default in the config so it cannot land in an artifact.
const USERNAME = process.env.BETA_USER_USERNAME || 'beta-user'
const PASSWORD = process.env.BETA_USER_PASSWORD
const API = process.env.API_BASE_URL || 'https://api-titan-staging.openvicloud.com'
const BILLED_MONTH = process.env.BILL_MONTH || '2026-09'   // month that HAS usage
const EMPTY_MONTH = process.env.EMPTY_MONTH || '2026-01'   // month that has none

test('RM-BC1: deployed read path reports VND and survives an empty period', async ({ page }) => {
  if (!PASSWORD) throw new Error('BETA_USER_PASSWORD not set')

  await page.goto('/')
  const u = page.locator('#username, input[name="username"]').first()
  await u.waitFor({ state: 'visible', timeout: 45_000 })
  await u.fill(USERNAME)
  await page.locator('#password, input[name="password"]').first().fill(PASSWORD)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()
  await page.waitForURL(/portal-titan-staging\.openvicloud\.com/, { timeout: 45_000 })

  const token = await page.evaluate(async () => {
    for (let i = 0; i < 30; i++) {
      const key = Object.keys(sessionStorage).find(k => k.startsWith('oidc.user:'))
      if (key) return JSON.parse(sessionStorage.getItem(key)!).access_token as string
      await new Promise(r => setTimeout(r, 500))
    }
    return null
  })
  expect(token, 'access token from the SPA session').toBeTruthy()

  const api = await request.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  })

  // S-3 — billed month
  const sRes = await api.get(`/v1/tenant/billing/summary?month=${BILLED_MONTH}`)
  expect(sRes.status(), 'S-3 summary status').toBe(200)
  const summary = await sRes.json()
  console.log('S-3 SUMMARY', JSON.stringify(summary))
  expect(summary.currency, 'S-3 currency').toBe('VND')
  expect(summary.totalCost, 'S-3 has billable usage').toBeGreaterThan(0)

  // S-4 — invoices
  const iRes = await api.get('/v1/tenant/billing/invoices')
  expect(iRes.status(), 'S-4 invoices status').toBe(200)
  const invoices = await iRes.json()
  const list = Array.isArray(invoices) ? invoices : (invoices.items ?? invoices.invoices ?? [])
  console.log('S-4 INVOICES', JSON.stringify(list))
  expect(list.length, 'S-4 non-empty — an empty list would pass the currency check vacuously')
    .toBeGreaterThan(0)
  for (const inv of list) expect(inv.currency, `S-4 invoice ${inv.id} currency`).toBe('VND')

  // S-5 — empty period must not throw (this is the BILL-01 shape)
  const eRes = await api.get(`/v1/tenant/billing/summary?month=${EMPTY_MONTH}`)
  expect(eRes.status(), 'S-5 empty-period status').toBe(200)
  const empty = await eRes.json()
  console.log('S-5 EMPTY', JSON.stringify(empty))
  expect(empty.currency, 'S-5 currency on an empty period').toBe('VND')
  expect(empty.totalCost, 'S-5 total on an empty period').toBe(0)

  await page.screenshot({ path: 'e2e-out/rm-bc1-billing-pass.png', fullPage: true })
})
