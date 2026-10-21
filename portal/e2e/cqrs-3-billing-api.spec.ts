import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

// Stage-3 staging API regression — CQRS-3 / docs/architecture/http-contract.md#commands-return-no-data (2026-09-23).
//
// Billing was split into 19 handlers. FastEndpoints builds an endpoint WITH its constructor
// dependencies on every request, so any answer at all — even a 404 or a 422 — proves the handler's
// DI graph resolves on the real host. That is what these cases lean on: every Billing route is hit
// once, and the command routes are hit through branches that WRITE NOTHING (absent invoice, already
// settled invoice, already confirmed top-up, over-cap grant, invalid amount). The three happy money
// paths run in the UI spec against seeded invoices.
//
// Secrets arrive as env vars injected from the k8s secret store at run time; none is printed.
const API = process.env.API_BASE_URL || 'https://api-titan-staging.openvicloud.com'
const PORTAL = process.env.PORTAL_BASE_URL || 'https://portal-titan-staging.openvicloud.com'
const ADMIN = process.env.ADMIN_BASE_URL || 'https://admin-titan-staging.openvicloud.com'
const need = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} is not set — inject it at run time`)
  return v
}

const SETTLED_INVOICE = '54d73318-55df-4457-ada3-185108339b06' // 2026-9, SettledByWallet
const ABSENT = '00000000-0000-0000-0000-0000000000ff'

async function login(page: Page, host: string, user: string, password: string) {
  await page.goto(host + '/', { waitUntil: 'domcontentloaded' })
  const signIn = page.getByRole('button', { name: /sign in|log ?in|đăng nhập/i }).first()
  if (await signIn.isVisible().catch(() => false)) await signIn.click().catch(() => {})
  const username = page.locator('#username, input[name="username"]').first()
  await username.waitFor({ state: 'visible', timeout: 45_000 })
  await username.fill(user)
  await page.locator('#password, input[name="password"]').first().fill(password)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()
  await page.waitForURL(new RegExp(new URL(host).host.replace(/\./g, '\\.')), { timeout: 45_000 })
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

async function expectCode(res: Awaited<ReturnType<APIRequestContext['get']>>, status: number, code?: string) {
  const body = await res.text()
  expect(res.status(), `${res.url()} → ${body.slice(0, 200)}`).toBe(status)
  if (code) expect(JSON.parse(body).code).toBe(code)
  return body
}

test('A-1..A-5 every Billing route answers on the real host; commands write nothing here', async ({ browser, request }) => {
  const tenantPage = await (await browser.newContext()).newPage()
  await login(tenantPage, PORTAL, process.env.BETA_USER_USERNAME || 'beta-user', need('BETA_USER_PASSWORD'))
  const tenant = { Authorization: `Bearer ${await tokenFrom(tenantPage)}` }

  const adminPage = await (await browser.newContext()).newPage()
  await login(adminPage, ADMIN, process.env.ADMIN_TEST_USERNAME || 'admin-test', need('ADMIN_TEST_PASSWORD'))
  const admin = { Authorization: `Bearer ${await tokenFrom(adminPage)}` }

  // ── A-1 tenant queries — real content, not just a 200 ─────────────────────────────────────
  const wallet = JSON.parse(await expectCode(await request.get(`${API}/v1/tenant/wallet`, { headers: tenant }), 200))
  expect(wallet.balance).toBe(Number(need('EXPECT_BETA_BALANCE')))
  expect(wallet.currency).toBe('VND')
  const statement = JSON.parse(await expectCode(await request.get(`${API}/v1/tenant/wallet/statement`, { headers: tenant }), 200))
  expect(statement.lines.length).toBe(Number(need('EXPECT_BETA_TXN')))
  expect(statement.closingBalance).toBe(wallet.balance)
  const topups = JSON.parse(await expectCode(await request.get(`${API}/v1/tenant/topups`, { headers: tenant }), 200))
  expect(topups.some((t: { id: string }) => t.id === need('CONFIRMED_TOPUP_ID'))).toBe(true)
  const invoices = JSON.parse(await expectCode(await request.get(`${API}/v1/tenant/billing/invoices`, { headers: tenant }), 200))
  expect(invoices.some((i: { id: string }) => i.id === SETTLED_INVOICE)).toBe(true)
  const detail = JSON.parse(await expectCode(await request.get(`${API}/v1/tenant/billing/invoices/${SETTLED_INVOICE}`, { headers: tenant }), 200))
  expect(detail.items.length).toBe(2)
  expect(detail.total).toBe(158)
  const summary = JSON.parse(await expectCode(await request.get(`${API}/v1/tenant/billing/summary?month=2026-09`, { headers: tenant }), 200))
  expect(summary.currency).toBe('VND')
  await expectCode(await request.get(`${API}/v1/tenant/vms/${need('DESTROYED_VM_ID')}/cost?month=2026-09`, { headers: tenant }), 200)

  // ── A-2 admin queries ───────────────────────────────────────────────────────────────────────
  const all = JSON.parse(await expectCode(await request.get(`${API}/v1/admin/invoices`, { headers: admin }), 200))
  expect(all.some((i: { id: string }) => i.id === SETTLED_INVOICE)).toBe(true)
  const recv = JSON.parse(await expectCode(await request.get(`${API}/v1/admin/billing/receivables`, { headers: admin }), 200))
  expect(recv.currency).toBe('VND')
  const adminTopups = JSON.parse(await expectCode(await request.get(`${API}/v1/admin/topups`, { headers: admin }), 200))
  expect(adminTopups.length).toBeGreaterThan(0)

  // ── A-3 commands through branches that write nothing ───────────────────────────────────────
  await expectCode(await request.post(`${API}/v1/tenant/billing/invoices/${ABSENT}/pay`, { headers: tenant }), 404, 'INVOICE_NOT_FOUND')
  await expectCode(await request.post(`${API}/v1/admin/invoices/${ABSENT}/settle-from-wallet`, { headers: admin }), 404, 'INVOICE_NOT_FOUND')
  await expectCode(await request.post(`${API}/v1/admin/invoices/${SETTLED_INVOICE}/settle-from-wallet`, { headers: admin }), 422, 'INVOICE_INVALID_STATE')
  await expectCode(await request.patch(`${API}/v1/admin/invoices/${SETTLED_INVOICE}/pay`, { headers: admin }), 422, 'INVOICE_ALREADY_PAID')
  // Confirmed already → the idempotent fast path: 202, empty body, nothing enqueued (DB checked outside).
  const confirm = await request.post(`${API}/v1/admin/topups/${need('CONFIRMED_TOPUP_ID')}/confirm`, { headers: admin, data: {} })
  expect(confirm.status()).toBe(202)
  expect(await confirm.text()).toBe('')
  await expectCode(await request.post(`${API}/v1/admin/topups/grant`,
    { headers: { ...admin, 'Idempotency-Key': crypto.randomUUID() }, data: { tenantId: need('BETA_TENANT_ID'), amount: 100_000_001, reason: 'CQRS-3 over-cap probe' } }),
    422, 'GRANT_AMOUNT_EXCEEDS_MAX')
  await expectCode(await request.post(`${API}/v1/tenant/topups`, { headers: { ...tenant, 'Idempotency-Key': crypto.randomUUID() }, data: { amount: 0 } }), 400, 'VALIDATION_ERROR')

  // ── A-4 internal routes ─────────────────────────────────────────────────────────────────────
  const internal = { 'X-Internal-Token': need('INTERNAL_TOKEN') }
  const run = JSON.parse(await expectCode(await request.post(`${API}/internal/billing/invoices/run`,
    { headers: internal, data: { year: 2020, month: 1 } }), 200))
  expect(run).toEqual({ generated: 0, skipped: 0 })
  // Staging carries no SePay key (control-plane-secrets has none) → 401 by design. The endpoint and
  // its handler are constructed before the key check, so this still proves the handler resolves.
  await expectCode(await request.post(`${API}/internal/payments/sepay/webhook`,
    { headers: { Authorization: 'Apikey probe' }, data: { id: 1, transferType: 'out', transferAmount: 1 } }), 401)
  // The tenant provision callback is gone (INCUS-2: a tenant has no provider account): the route answers 404.
  await expectCode(await request.patch(`${API}/internal/tenants/${ABSENT}/provision`,
    { headers: internal, data: { error: 'CQRS-3 regression probe' } }), 404)

  // ── A-5 docs/architecture/http-contract.md#commands-return-no-data: PATCH answers 204 with an empty body (values unchanged) ────────────────────
  for (const [path, data, headers] of [
    [`/v1/tenants/${need('BETA_TENANT_ID')}/quota`, { maxVms: 10, maxNetworks: 1 }, admin],
    [`/v1/tenants/${need('BETA_TENANT_ID')}/debt-ceiling`, { debtCeiling: 500000 }, admin],
    [`/v1/tenant/networks/${need('PAYTEST_NET_ID')}`, { name: 'paytest-net' }, tenant],
  ] as const) {
    const res = await request.patch(`${API}${path}`, { headers, data })
    expect(res.status(), `PATCH ${path}`).toBe(204)
    expect(await res.text(), `PATCH ${path} body`).toBe('')
  }
})
