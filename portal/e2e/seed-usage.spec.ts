import { test, request } from '@playwright/test'

// One-off seed (NOT a regression case): provision a VM for beta-user on staging so a COMPUTE usage
// tick accrues, enabling a credited invoice for the credit-line visual. Login is automated; the token
// is taken from the authenticated session and used against the API directly (no CORS, raw HTTP client).
const USERNAME = process.env.BETA_USER_USERNAME || 'beta-user'
const PASSWORD = process.env.BETA_USER_PASSWORD
const API = process.env.API_BASE_URL || 'https://api-titan-staging.openvicloud.com'

test('seed: provision a VM so beta-user accrues COMPUTE usage', async ({ page }) => {
  if (!PASSWORD) throw new Error('BETA_USER_PASSWORD not set')

  // ── automated login ──
  await page.goto('/')
  const signIn = page.getByRole('button', { name: /sign in|log ?in|đăng nhập/i }).first()
  if (await signIn.isVisible().catch(() => false)) await signIn.click().catch(() => {})
  const username = page.locator('#username, input[name="username"]').first()
  await username.waitFor({ state: 'visible', timeout: 45_000 })
  await username.fill(USERNAME)
  await page.locator('#password, input[name="password"]').first().fill(PASSWORD)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()
  await page.waitForURL(/portal-titan-staging\.openvicloud\.com/, { timeout: 45_000 })
  await page.waitForTimeout(2500)

  const token = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('oidc.user:'))
    return key ? JSON.parse(sessionStorage.getItem(key)!).access_token as string : null
  })
  if (!token) throw new Error('no access_token in localStorage after login')

  const api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } })
  const j = async (p: string) => (await api.get(p)).json()

  const zones = await j('/v1/zones')
  const templates = await j('/v1/templates')
  const offerings = await j('/v1/vm-offerings')
  console.log('ZONES', JSON.stringify(zones))
  console.log('TEMPLATES', JSON.stringify(templates))
  console.log('OFFERINGS', JSON.stringify(offerings))

  const zoneId = zones?.[0]?.id ?? zones?.[0]?.zoneId
  const tpl = (Array.isArray(templates) ? templates : []).find((t: any) => t.externalTemplateId || /synced/i.test(t.status || '')) ?? templates?.[0]
  const off = (Array.isArray(offerings) ? offerings : [])[0]
  console.log('PICK', JSON.stringify({ zoneId, templateId: tpl?.id, vmOfferingId: off?.id }))
  if (!zoneId || !tpl?.id || !off?.id) throw new Error('catalog missing zone/template/offering — see logs above')

  // reuse an Active network or create one
  let nets = await j('/v1/tenant/networks')
  let net = (Array.isArray(nets) ? nets : []).find((n: any) => n.status === 'Active')
  if (!net) {
    const res = await api.post('/v1/tenant/networks', { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { name: 'credtest-net', zoneId, cidr: '10.99.0.0/24' } })
    console.log('CREATE_NET', res.status(), await res.text())
    for (let i = 0; i < 30 && !net; i++) {
      await page.waitForTimeout(4000)
      nets = await j('/v1/tenant/networks')
      net = (Array.isArray(nets) ? nets : []).find((n: any) => n.name === 'credtest-net' && n.status === 'Active')
    }
  }
  if (!net) throw new Error('network did not reach Active')
  console.log('NET', net.id, net.status)

  // create the VM (idempotent — reuse if it already exists)
  let vm: any = (await j('/v1/tenant/vms') as any[]).find((v: any) => v.name === 'credtest-vm')
  if (!vm) {
    const vmRes = await api.post('/v1/tenant/vms', { headers: { 'Idempotency-Key': crypto.randomUUID() },
      data: { name: 'credtest-vm', networkId: net.id, zoneId, vmOfferingId: off.id, templateId: tpl.id, diskSizeGb: 10 },
    })
    console.log('CREATE_VM', vmRes.status(), await vmRes.text())
    for (let i = 0; i < 40 && vm?.status !== 'Running'; i++) {
      await page.waitForTimeout(4000)
      vm = (await j('/v1/tenant/vms') as any[]).find((v: any) => v.name === 'credtest-vm')
      console.log('VM_POLL', vm?.status)
      if (vm?.status === 'Error') throw new Error('VM Error: ' + JSON.stringify(vm))
    }
  }
  console.log('VM', vm?.id, vm?.status)

  // create a large Volume — DISK usage is billed at a non-zero flat rate (DiskPricePerGbPerHour), so
  // this guarantees usageSubtotal > 0 even if the compute offering has no pricing rule after the DB
  // rebuild. Big size so one 10-min tick rounds to a visible amount.
  const volOfferings = await j('/v1/volume-offerings')
  console.log('VOL_OFFERINGS', JSON.stringify(volOfferings))
  const volOff = (Array.isArray(volOfferings) ? volOfferings : [])[0]
  let vol: any = (await j('/v1/tenant/volumes') as any[]).find((v: any) => v.name === 'credtest-vol')
  if (!vol && volOff?.id) {
    const volRes = await api.post('/v1/tenant/volumes', { headers: { 'Idempotency-Key': crypto.randomUUID() },
      data: { name: 'credtest-vol', volumeOfferingId: volOff.id, zoneId, sizeGb: 500 },
    })
    console.log('CREATE_VOL', volRes.status(), await volRes.text())
    for (let i = 0; i < 30 && !['Available', 'Ready', 'Attached'].includes(vol?.status); i++) {
      await page.waitForTimeout(4000)
      vol = (await j('/v1/tenant/volumes') as any[]).find((v: any) => v.name === 'credtest-vol')
      console.log('VOL_POLL', vol?.status)
      if (vol?.status === 'Error') throw new Error('Volume Error: ' + JSON.stringify(vol))
    }
  }
  console.log('SEED_DONE vmId=', vm?.id, 'vmStatus=', vm?.status, 'volId=', vol?.id, 'volStatus=', vol?.status)
})
