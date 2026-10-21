import { test, request } from '@playwright/test'

// One-off cleanup for the seed resources (credtest-vm / credtest-vol / credtest-net) so they stop
// accruing usage. The generated invoice + the consumed credit stay (immutable) as evidence.
const USERNAME = process.env.BETA_USER_USERNAME || 'beta-user'
const PASSWORD = process.env.BETA_USER_PASSWORD
const API = process.env.API_BASE_URL || 'https://api-titan-staging.openvicloud.com'

test('cleanup: delete seed VM/volume/network', async ({ page }) => {
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
  const j = async (p: string) => (await api.get(p)).json()

  const vm = (await j('/v1/tenant/vms') as any[]).find((v: any) => v.name === 'credtest-vm')
  if (vm) { console.log('DEL_VM', (await api.delete(`/v1/tenant/vms/${vm.id}`)).status()) }
  const vol = (await j('/v1/tenant/volumes') as any[]).find((v: any) => v.name === 'credtest-vol')
  if (vol) { console.log('DEL_VOL', (await api.delete(`/v1/tenant/volumes/${vol.id}`)).status()) }
  // network delete may 422 while the VM is still tearing down (NETWORK_NOT_EMPTY) — retry a few times.
  const net = (await j('/v1/tenant/networks') as any[]).find((n: any) => n.name === 'credtest-net')
  if (net) {
    for (let i = 0; i < 12; i++) {
      const r = await api.delete(`/v1/tenant/networks/${net.id}`)
      console.log('DEL_NET_TRY', r.status())
      if (r.ok() || r.status() === 404) break
      await page.waitForTimeout(5000)
    }
  }
  console.log('CLEANUP_DONE')
})
