import { test, request } from '@playwright/test'

// Read-only: after a usage tick, confirm beta-user has billable usage in the current period so a
// generated invoice will carry cost (and therefore an applied Credit line).
const USERNAME = process.env.BETA_USER_USERNAME || 'beta-user'
const PASSWORD = process.env.BETA_USER_PASSWORD
const API = process.env.API_BASE_URL || 'https://api-titan-staging.openvicloud.com'
const MONTH = process.env.BILL_MONTH || '2026-08'

test('check: beta-user usage in period', async ({ page }) => {
  if (!PASSWORD) throw new Error('BETA_USER_PASSWORD not set')
  await page.goto('/')
  const signIn = page.getByRole('button', { name: /sign in|log ?in|đăng nhập/i }).first()
  if (await signIn.isVisible().catch(() => false)) await signIn.click().catch(() => {})
  const u = page.locator('#username, input[name="username"]').first()
  await u.waitFor({ state: 'visible', timeout: 45_000 })
  await u.fill(USERNAME)
  await page.locator('#password, input[name="password"]').first().fill(PASSWORD)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()
  await page.waitForURL(/portal-titan-staging\.openvicloud\.com/, { timeout: 45_000 })
  await page.waitForTimeout(2500)

  const token = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('oidc.user:'))
    return key ? JSON.parse(sessionStorage.getItem(key)!).access_token as string : null
  })
  const api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } })
  const summary = await (await api.get(`/v1/tenant/billing/summary?month=${MONTH}`)).json()
  console.log('SUMMARY', JSON.stringify(summary))
})
