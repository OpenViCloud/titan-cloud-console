import { test, expect, request, type Page } from '@playwright/test'
test.setTimeout(600_000)
const PORTAL_URL = 'https://portal-titan-staging.openvicloud.com'
const ADMIN_URL = 'https://admin-titan-staging.openvicloud.com'
const API = 'https://api-titan-staging.openvicloud.com'
async function login(page: Page, base: string, user: string, pw: string, ready: RegExp) {
  await page.goto(base)
  const si = page.getByRole('button', { name: /sign in|log ?in/i }).first()
  if (await si.isVisible().catch(() => false)) await si.click().catch(() => {})
  const u = page.locator('#username, input[name="username"]').first()
  await u.waitFor({ state: 'visible', timeout: 45_000 })
  await u.fill(user); await page.locator('#password, input[name="password"]').first().fill(pw)
  await page.locator('#kc-login, button[type="submit"]').first().click()
  await page.getByText(ready).first().waitFor({ state: 'visible', timeout: 45_000 })
}
async function api(page: Page) {
  const t = await page.evaluate(() => {
    const k = Object.keys(sessionStorage).find(x => x.startsWith('oidc.user:'))
    return k ? JSON.parse(sessionStorage.getItem(k)!).access_token as string : null
  })
  return request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${t}` } })
}
test('repair staging: restore ceiling FIRST, then expunge leaked VMs', async ({ browser }) => {
  // 1. CHEAP + IMPORTANT first. Doing this after the slow VM wait is exactly how it got skipped.
  const actx = await browser.newContext(); const apage = await actx.newPage()
  await login(apage, ADMIN_URL, 'admin-test', process.env.ADMIN_TEST_PASSWORD!, /tenants|dashboard/i)
  const aapi = await api(apage)
  const tenants = await (await aapi.get('/v1/tenants')).json() as { id: string; name: string; debtCeiling: number }[]
  const beta = tenants.find(t => /beta/i.test(t.name))!
  const r = await aapi.patch(`/v1/tenants/${beta.id}/debt-ceiling`, { data: { debtCeiling: 500000 } })
  expect(r.status()).toBe(200)
  const fresh = await api(apage)
  const after = await (await fresh.get('/v1/tenants')).json() as { id: string; debtCeiling: number }[]
  expect(after.find(t => t.id === beta.id)!.debtCeiling).toBe(500000)
  console.log('ceiling restored -> 500000')
  await fresh.dispose(); await aapi.dispose(); await actx.close()

  // 2. Then the slow part.
  const cctx = await browser.newContext(); const cpage = await cctx.newPage()
  await login(cpage, PORTAL_URL, 'beta-user', process.env.BETA_USER_PASSWORD!, /beta-user/i)
  const capi = await api(cpage)
  const vms = await (await capi.get('/v1/tenant/vms')).json() as { id: string; name: string; status: string }[]
  const leaked = vms.filter(v => v.name.startsWith('ceiltest-') && v.status !== 'Destroyed')
  console.log('leaked:', leaked.map(v => `${v.name}=${v.status}`).join(', ') || 'none')
  for (const v of leaked) {
    await expect.poll(async () => (await (await capi.get(`/v1/tenant/vms/${v.id}`)).json()).status,
      { timeout: 240_000, intervals: [5_000] }).toMatch(/Running|Error/)
    const d = await capi.delete(`/v1/tenant/vms/${v.id}`)
    expect([200, 202, 204]).toContain(d.status())
    await expect.poll(async () => (await (await capi.get(`/v1/tenant/vms/${v.id}`)).json()).status,
      { timeout: 300_000, intervals: [10_000] }).toMatch(/Destroyed/)
    console.log(`${v.name} -> Destroyed`)
  }
  await capi.dispose(); await cctx.close()
})
