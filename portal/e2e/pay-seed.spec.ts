import { test, request } from '@playwright/test'

// One-off SEED for the docs/architecture/money-and-wallet.md#human-confirmed-debit regression (NOT a regression case): after PAY-7 wiped billing, staging
// has no usage at all and its only VM is Destroyed, so there is nothing to invoice and nothing to pay.
// This provisions a VM + a large volume so a metering tick accrues a non-zero cost.
//
// Deliberately NOT reusing e2e/seed-usage.spec.ts: that one looks up the VM by NAME only, so the
// Destroyed `credtest-vm` already on staging matches and it silently reuses a dead VM — which accrues
// nothing. Here the lookup is by name AND live status.
//
// Login is automated; the password comes from BETA_USER_PASSWORD (injected from the k8s secret at run
// time) and never appears in an argument, a log line, or an artifact.
const USERNAME = process.env.BETA_USER_USERNAME || 'beta-user'
const PASSWORD = process.env.BETA_USER_PASSWORD
const API = process.env.API_BASE_URL || 'https://api-titan-staging.openvicloud.com'

const LIVE_VM = ['Starting', 'Running']
const LIVE_VOL = ['Creating', 'Available', 'Ready', 'Attached']

test('seed: provision a live VM + volume so beta-user accrues usage', async ({ page }) => {
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
    return key ? (JSON.parse(sessionStorage.getItem(key)!).access_token as string) : null
  })
  if (!token) throw new Error('no access_token in sessionStorage after login')
  console.log('LOGIN_OK token_len=', token.length)

  const api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } })
  const j = async (p: string) => (await api.get(p)).json()

  const zones = await j('/v1/zones')
  const templates = await j('/v1/templates')
  const offerings = await j('/v1/vm-offerings')
  const zoneId = zones?.[0]?.id ?? zones?.[0]?.zoneId
  const tpl = (Array.isArray(templates) ? templates : []).find((t: any) => t.externalTemplateId) ?? templates?.[0]
  const off = (Array.isArray(offerings) ? offerings : [])[0]
  console.log('PICK', JSON.stringify({ zoneId, templateId: tpl?.id, vmOfferingId: off?.id, price: off?.pricePerHour }))
  if (!zoneId || !tpl?.id || !off?.id) throw new Error('catalog missing zone/template/offering')

  let nets = await j('/v1/tenant/networks')
  let net = (Array.isArray(nets) ? nets : []).find((n: any) => n.status === 'Active')
  if (!net) {
    console.log('CREATE_NET', (await api.post('/v1/tenant/networks', { headers: { 'Idempotency-Key': crypto.randomUUID() },
      data: { name: 'paytest-net', zoneId, cidr: '10.98.0.0/24' },
    })).status())
    for (let i = 0; i < 30 && !net; i++) {
      await page.waitForTimeout(4000)
      nets = await j('/v1/tenant/networks')
      net = (Array.isArray(nets) ? nets : []).find((n: any) => n.name === 'paytest-net' && n.status === 'Active')
    }
  }
  if (!net) throw new Error('no Active network')
  console.log('NET', net.id, net.status)

  // Name AND live status — a Destroyed VM of the same name must NOT count as "already seeded".
  let vm: any = (await j('/v1/tenant/vms') as any[]).find((v: any) => v.name === 'paytest-vm' && LIVE_VM.includes(v.status))
  if (!vm) {
    const res = await api.post('/v1/tenant/vms', { headers: { 'Idempotency-Key': crypto.randomUUID() },
      data: { name: 'paytest-vm', networkId: net.id, zoneId, vmOfferingId: off.id, templateId: tpl.id, diskSizeGb: 10 },
    })
    console.log('CREATE_VM', res.status(), await res.text())
    for (let i = 0; i < 40 && vm?.status !== 'Running'; i++) {
      await page.waitForTimeout(4000)
      vm = (await j('/v1/tenant/vms') as any[]).find((v: any) => v.name === 'paytest-vm')
      if (vm?.status === 'Error') throw new Error('VM Error: ' + JSON.stringify(vm))
    }
  }
  console.log('VM', vm?.id, vm?.status)

  // A 500 GB volume: DISK is billed at a flat non-zero rate, so ONE tick is guaranteed to round to a
  // visible amount even if compute happens to price at 0.
  const volOff = ((await j('/v1/volume-offerings')) as any[])?.[0]
  let vol: any = (await j('/v1/tenant/volumes') as any[]).find((v: any) => v.name === 'paytest-vol' && LIVE_VOL.includes(v.status))
  if (!vol && volOff?.id) {
    const res = await api.post('/v1/tenant/volumes', { headers: { 'Idempotency-Key': crypto.randomUUID() },
      data: { name: 'paytest-vol', volumeOfferingId: volOff.id, zoneId, sizeGb: 500 },
    })
    console.log('CREATE_VOL', res.status(), await res.text())
    for (let i = 0; i < 30 && !['Available', 'Ready', 'Attached'].includes(vol?.status); i++) {
      await page.waitForTimeout(4000)
      vol = (await j('/v1/tenant/volumes') as any[]).find((v: any) => v.name === 'paytest-vol')
      if (vol?.status === 'Error') throw new Error('Volume Error: ' + JSON.stringify(vol))
    }
  }
  console.log('SEED_DONE vm=', vm?.id, vm?.status, 'vol=', vol?.id, vol?.status)
})
