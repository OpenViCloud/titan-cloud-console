import { test, expect, type Page } from '@playwright/test'

// Stage-3 staging API regression — CQRS-2 / docs/architecture/http-contract.md#create-returns-id (2026-09-22): the create endpoints answer with
// an id and nothing else, measured against the DEPLOYED API rather than the committed spec.
const USERNAME = process.env.BETA_USER_USERNAME || 'beta-user'
const PASSWORD = process.env.BETA_USER_PASSWORD
const API = process.env.API_BASE_URL || 'https://api-titan-staging.openvicloud.com'

async function login(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const signIn = page.getByRole('button', { name: /sign in|log ?in|đăng nhập/i }).first()
  if (await signIn.isVisible().catch(() => false)) await signIn.click().catch(() => {})
  const username = page.locator('#username, input[name="username"]').first()
  await username.waitFor({ state: 'visible', timeout: 45_000 })
  await username.fill(USERNAME)
  await page.locator('#password, input[name="password"]').first().fill(PASSWORD!)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()
  await page.waitForURL(/portal-titan-staging\.openvicloud\.com/, { timeout: 45_000 })
  await page.getByRole('navigation').or(page.getByRole('heading').first()).first()
    .waitFor({ state: 'visible', timeout: 45_000 })
}

async function tokenFrom(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    for (const store of [sessionStorage, localStorage]) {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i)!
        if (!k.startsWith('oidc.user:')) continue
        const v = JSON.parse(store.getItem(k) || '{}')
        if (v.access_token) return v.access_token as string
      }
    }
    return ''
  })
  expect(token, 'a bearer token must be readable from the session').not.toEqual('')
  return token
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error('BETA_USER_PASSWORD is not set — inject from the k8s secret.')
})

// A-4 — the network quota is full on this environment (max_networks=1, one Active network), so a
// create must be refused by the quota rather than succeed. This is the EXPECTED answer, not a
// defect: writing it down here is what stops a later run from filing it as one.
test('A-4 creating a network past the quota is refused, and the refusal is the quota rule', async ({ page, request }) => {
  await login(page)
  const headers = { Authorization: `Bearer ${await tokenFrom(page)}` }

  // Precondition asserted in the SAME measurement, immediately before the action: the environment
  // changes while you type, and a quota test on an env that is no longer full proves nothing.
  const list = await request.get(`${API}/v1/tenant/networks`, { headers })
  expect(list.status()).toBe(200)
  const active = (await list.json()).filter((n: { status: string }) => n.status !== 'Deleted')
  expect(active.length, 'network quota must be full for this case to mean anything').toBe(1)

  const res = await request.post(`${API}/v1/tenant/networks`, {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() }, data: { name: `cqrs2-quota-${Date.now()}`, zoneId: active[0].zoneId },
  })
  expect(res.status()).toBe(422)
  expect((await res.json()).code).toBe('NETWORK_QUOTA_EXCEEDED')
})

// A-5 — a create answers with the id alone AND the resource really exists afterwards. The second
// half matters: an endpoint that returns a plausible id without creating anything would satisfy a
// shape-only assertion.
test('A-5 creating a VM answers with just an id, and the VM is really there', async ({ page, request }) => {
  await login(page)
  const headers = { Authorization: `Bearer ${await tokenFrom(page)}` }

  const templates = await request.get(`${API}/v1/templates`, { headers })
  expect(templates.status()).toBe(200)
  const template = (await templates.json())[0]
  expect(template, 'catalog must have a template').toBeTruthy()

  const offerings = await request.get(`${API}/v1/vm-offerings`, { headers })
  const offering = (await offerings.json())[0]
  expect(offering, 'catalog must have an offering').toBeTruthy()

  const networks = await request.get(`${API}/v1/tenant/networks`, { headers })
  const network = (await networks.json()).find((n: { status: string }) => n.status === 'Active')
  expect(network, 'an Active network is required to place a VM').toBeTruthy()

  const name = `cqrs2-${Date.now()}`
  const res = await request.post(`${API}/v1/tenant/vms`, {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    data: {
      name, networkId: network.id, vmOfferingId: offering.id,
      templateId: template.id, zoneId: network.zoneId,
    },
  })
  expect(res.status()).toBe(202)

  // docs/architecture/http-contract.md#create-returns-id: exactly one key, and it is the identity.
  const body = await res.json()
  expect(Object.keys(body).sort(), 'create response carries only the id').toEqual(['vmId'])
  expect(body.vmId).toMatch(/^[0-9a-f-]{36}$/)

  // The id is not decoration — the VM it names must be readable back.
  const created = await request.get(`${API}/v1/tenant/vms/${body.vmId}`, { headers })
  expect(created.status(), 'the created VM must be readable').toBe(200)
  expect((await created.json()).name).toBe(name)

  // Cleanup: this run must not leave a billable VM behind. A VM cannot be deleted while it is still
  // Starting (422 VM_INVALID_STATUS is the rule, not a defect), so wait for it to settle first —
  // deleting on the first try would leave the VM running and the failure would read as a delete bug.
  let deleted = 0
  for (let i = 0; i < 30 && deleted === 0; i++) {
    const del = await request.delete(`${API}/v1/tenant/vms/${body.vmId}`, { headers })
    if (del.status() === 202 || del.status() === 204) { deleted = del.status(); break }
    expect(del.status(), 'delete is either accepted or refused by the state rule').toBe(422)
    await new Promise(r => setTimeout(r, 10_000))
  }
  expect(deleted, `VM ${body.vmId} must be cleaned up`).toBeGreaterThan(0)
})
