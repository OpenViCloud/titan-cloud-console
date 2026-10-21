import { test, expect, request, type Page, type APIRequestContext, type Browser } from '@playwright/test'

// Stage-3 staging regression — debt ceiling is a REFERENCE field for the admin (Tôn Chủ 2026-09-04).
// Plan: cases A1–A4, B1–B3, C1–C5 of the iteration's regression plan.
//
// The assertion this file exists for is B2: a tenant whose debt ceiling is ZERO can still create a
// VM. Every other case here would pass on the old build too — only "the gate is dead" tells the two
// builds apart, and deleting the gate's source code is not evidence that the deployed image lost it.
//
// Keycloak has direct-grant DISABLED for both clients, so API calls borrow the browser session's
// access token out of sessionStorage — the same token the UI uses. Passwords come from env (injected
// from k8s secrets) and never enter a log or an artifact.
const ADMIN_URL = process.env.ADMIN_BASE_URL || 'https://admin-titan-staging.openvicloud.com'
const PORTAL_URL = process.env.PORTAL_BASE_URL || 'https://portal-titan-staging.openvicloud.com'
const API = process.env.API_BASE_URL || 'https://api-titan-staging.openvicloud.com'

const ADMIN_USER = process.env.ADMIN_TEST_USERNAME || 'admin-test'
const ADMIN_PASSWORD = process.env.ADMIN_TEST_PASSWORD
const BETA_USER = process.env.BETA_USER_USERNAME || 'beta-user'
const BETA_PASSWORD = process.env.BETA_USER_PASSWORD

// Inside the titan-regression runner screenshots go to RESULTS_DIR; the repo path is for a local run.
const EVIDENCE = process.env.RESULTS_DIR || 'test-results/evidence'

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  const missing = [!BETA_PASSWORD && 'BETA_USER_PASSWORD', !ADMIN_PASSWORD && 'ADMIN_TEST_PASSWORD'].filter(Boolean)
  if (missing.length) throw new Error(`Missing credentials: ${missing.join(', ')}`)
})

async function keycloakLogin(page: Page, base: string, user: string, password: string, ready: RegExp) {
  await page.goto(base)
  const signIn = page.getByRole('button', { name: /sign in|log ?in|đăng nhập/i }).first()
  if (await signIn.isVisible().catch(() => false)) await signIn.click().catch(() => {})
  const username = page.locator('#username, input[name="username"]').first()
  await username.waitFor({ state: 'visible', timeout: 45_000 })
  await username.fill(user)
  await page.locator('#password, input[name="password"]').first().fill(password)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()
  // Trap (a): the app must finish booting before any deep-link, or the router renders the dashboard
  // while the URL says otherwise.
  await page.getByText(ready).first().waitFor({ state: 'visible', timeout: 45_000 })
}

async function bearer(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('oidc.user:'))
    return key ? (JSON.parse(sessionStorage.getItem(key)!).access_token as string) : null
  })
  if (!token) throw new Error('no access_token in sessionStorage')
  return token
}

/// Always a FRESH context per call: reusing one created before a mutation returns the pre-mutation
/// response and produces a false FAIL (a harness defect that bit this repo on 2026-09-04).
async function apiAs(page: Page): Promise<APIRequestContext> {
  return request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${await bearer(page)}` } })
}

// Two separate browser contexts, not two tabs: the Keycloak SSO cookie is per-context, and sharing
// one makes the second portal silently reuse the first user (→ 403, which reads like a product bug).
async function loginCustomer(browser: Browser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await keycloakLogin(page, PORTAL_URL, BETA_USER, BETA_PASSWORD!, /beta-user/i)
  return { ctx, page }
}

async function loginAdmin(browser: Browser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await keycloakLogin(page, ADMIN_URL, ADMIN_USER, ADMIN_PASSWORD!, /tenants|admin/i)
  return { ctx, page }
}

type Invoice = { id: string; status: string; total: number }
type Tenant = { id: string; name: string; debtCeiling: number }

// ── A. the customer must not see the ceiling ─────────────────────────────────

test('A1+A2 — no tenant endpoint exposes the ceiling (negative, runs first)', async ({ browser }) => {
  const { ctx, page } = await loginCustomer(browser)
  const api = await apiAs(page)

  // A1: the endpoint that used to carry it is gone from the DEPLOYED image.
  const terms = await api.get('/v1/tenant/credit-terms')
  expect(terms.status(), 'GET /v1/tenant/credit-terms must be gone').toBe(404)

  // A2: and it did not reappear under another name on any surface the customer can read.
  const forbidden = /ceiling|creditlimit|remainingcredit|exposure/i
  for (const path of ['/v1/tenant/wallet', '/v1/tenant/billing/summary', '/v1/tenant/billing/invoices']) {
    const res = await api.get(path)
    expect(res.ok(), `${path} -> ${res.status()}`).toBeTruthy()
    expect(await res.text(), `${path} leaks a ceiling field`).not.toMatch(forbidden)
  }
  await api.dispose()
  await ctx.close()
})

test('A3+A4 — /wallet shows two cards, and Outstanding matches the invoice API', async ({ browser }) => {
  const { ctx, page } = await loginCustomer(browser)

  await page.getByRole('button', { name: /wallet/i }).first().click()   // trap (b): nav is a button
  await expect(page.getByText('Wallet balance')).toBeVisible()
  await expect(page.getByText('Outstanding')).toBeVisible()

  // The negative half — the third card and every label built from the ceiling.
  await expect(page.getByText(/available to spend/i)).toHaveCount(0)
  await expect(page.getByText(/credit remaining/i)).toHaveCount(0)
  await expect(page.getByText(/credit limit/i)).toHaveCount(0)
  await expect(page.getByText(/debt ceiling/i)).toHaveCount(0)
  await expect(page.getByText(/spending (limit|room)/i)).toHaveCount(0)

  // A4: oracle is the API, not another part of the same page. The value sits in the sibling <p> of
  // the label's wrapper — scrape the whole card and read the money line out of it.
  const api = await apiAs(page)
  const invoices: Invoice[] = await (await api.get('/v1/tenant/billing/invoices')).json()
  const owed = invoices.filter(i => i.status === 'New' || i.status === 'Overdue')
  const expected = Math.round(owed.reduce((s, i) => s + i.total, 0))

  // StatCard root is `rounded-xl border p-4`; scope to it so the scrape gets label AND value, not
  // the innermost div that holds only the label (that is what returned "Outstanding" alone).
  const card = page.locator('div.rounded-xl').filter({ has: page.getByText('Outstanding', { exact: true }) }).first()
  // Wait for the query to resolve rather than scraping mid-flight: the card renders "—" until the
  // invoice list arrives. If this times out it is NOT a harness race — it means the wallet page never
  // resolves what the customer owes, which is a product finding.
  await expect(card, 'Outstanding never resolved to a number').toContainText(/\d/, { timeout: 20_000 })
  const shown = (await card.innerText()).replace(/\s+/g, ' ')
  // Harness self-check: an empty scrape must FAIL, not silently match an expected 0 (empty-vs-empty
  // is how this comparison lies). Assert the card actually rendered a money value first.
  expect(shown, 'Outstanding card scraped empty — harness defect, not a product result').toMatch(/\d/)
  const digits = (t: string) => t.replace(/[^\d]/g, '')
  expect(digits(shown), `UI Outstanding card "${shown}" vs API sum ${expected}`)
    .toContain(digits(String(expected)))

  await page.screenshot({ path: `${EVIDENCE}/wallet-two-cards.png`, fullPage: true })
  await api.dispose()
  await ctx.close()
})

// ── B. AC-3: the gate is dead on the real environment ───────────────────────

test('B1+B2+B3 — ceiling 0 does NOT stop VM creation, then restore', async ({ browser }) => {
  // playwright.config.ts sets 90s per test. A VM's Starting→Running→Destroyed round trip needs far
  // more, and on 2026-09-04 the 90s cap killed this test INSIDE its own finally block: the ceiling
  // was left at 0 and a VM was left Running. A cleanup that can be cut off is not a cleanup.
  test.setTimeout(1_800_000)
  const admin = await loginAdmin(browser)
  const customer = await loginCustomer(browser)

  const adminApi = await apiAs(admin.page)
  const tenants: Tenant[] = await (await adminApi.get('/v1/tenants')).json()
  const beta = tenants.find(t => /beta/i.test(t.name))
  expect(beta, 'beta tenant must exist').toBeTruthy()

  // Restored to what it was, not to a constant: the tenant's number is data another run may have set.
  const originalCeiling = beta!.debtCeiling

  let vmId: string | null = null
  let networkId: string | null = null
  try {
    // B1 — drive the ceiling to the most hostile value there is. Inside the try, so a failure anywhere
    // after the PATCH still restores it.
    const patched = await adminApi.patch(`/v1/tenants/${beta!.id}/debt-ceiling`, { data: { debtCeiling: 0 } })
    expect(patched.status()).toBe(204)
    const afterPatch = await apiAs(admin.page)
    const reread: Tenant[] = await (await afterPatch.get('/v1/tenants')).json()
    expect(reread.find(t => t.id === beta!.id)!.debtCeiling).toBe(0)
    await afterPatch.dispose()

    // B2 — the whole point. On the previous build this returned 422 CREDIT_LIMIT_EXCEEDED.
    const custApi = await apiAs(customer.page)
    const zones = await (await custApi.get('/v1/zones')).json()
    const zoneId = (zones as { id: string }[])[0].id
    const networks = await (await custApi.get('/v1/tenant/networks')).json()
    let usable = (networks as { id: string; currentState: string }[]).find(n => n.currentState === 'Active')
    if (!usable) {
      // Staging is usually empty between runs; bring a network for the VM and take it away at the end.
      const net = await custApi.post('/v1/tenant/networks', {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        data: { name: `ceiltest-net-${Date.now().toString().slice(-6)}`, zoneId },
      })
      expect(net.status(), `POST /v1/tenant/networks -> ${net.status()}`).toBe(202)
      networkId = (await net.json()).networkId as string
      await expect
        .poll(async () => (await (await (await apiAs(customer.page)).get(`/v1/tenant/networks/${networkId}`)).json()).currentState,
              { timeout: 360_000, intervals: [5_000] })
        .toBe('Active')
      usable = { id: networkId, currentState: 'Active' }
    }
    const offerings = await (await custApi.get('/v1/vm-offerings')).json()
    const templates = await (await custApi.get('/v1/templates')).json()

    const created = await custApi.post('/v1/tenant/vms', { headers: { 'Idempotency-Key': crypto.randomUUID() },
      data: {
        // The create itself is what the gate used to refuse.
        name: `ceiltest-vm-${Date.now().toString().slice(-6)}`,
        networkId: usable!.id,
        vmOfferingId: (offerings as { id: string }[])[0].id,
        templateId: (templates as { id: string }[])[0].id,
        zoneId,
        diskSizeGb: null,
      },
    })
    const body = await created.text()
    expect(body, 'the deleted gate must not fire').not.toContain('CREDIT_LIMIT_EXCEEDED')
    expect(body).not.toContain('DEBT_CEILING_EXCEEDED')
    expect([200, 201, 202], `POST /v1/tenant/vms -> ${created.status()} ${body.slice(0, 200)}`).toContain(created.status())
    vmId = JSON.parse(body).id ?? JSON.parse(body).vmId
    expect(vmId, 'created VM must have an id').toBeTruthy()

    await custApi.dispose()
  } finally {
    // B3 — clean up whatever happened above, in both directions.
    //
    // This block LEAKED TWO RUNNING VMs on 2026-09-04: DELETE was fired immediately after create,
    // while the VM was still `Starting`, which is not a legal delete state (VM_INVALID_STATUS) — and
    // the `.catch(() => {})` swallowed the 422 so the run reported PASS with two VMs burning real
    // infrastructure. Two lessons encoded here: wait for a deletable state, and never swallow the
    // result of a cleanup call. A cleanup whose failure is invisible is not cleanup.
    // ORDER IS LOAD-BEARING: restore the ceiling first. It is one fast call, it is the state another
    // test reads, and putting it after the multi-minute VM wait is exactly what left beta-user at 0.
    const restoreFirst = await apiAs(admin.page)
    const back = await restoreFirst.patch(`/v1/tenants/${beta!.id}/debt-ceiling`, { data: { debtCeiling: originalCeiling } })
    expect(back.status()).toBe(204)
    const verifyCtx = await apiAs(admin.page)   // fresh context: read-after-write
    const verify: Tenant[] = await (await verifyCtx.get('/v1/tenants')).json()
    expect(verify.find(t => t.id === beta!.id)!.debtCeiling).toBe(originalCeiling)
    await verifyCtx.dispose()
    await restoreFirst.dispose()

    if (vmId) {
      const cleanup = await apiAs(customer.page)
      // Starting → Running is driven by the reconciler; delete is only legal once it lands.
      await expect
        .poll(async () => (await (await cleanup.get(`/v1/tenant/vms/${vmId}`)).json()).currentState,
              { timeout: 900_000, intervals: [10_000] })
        .toMatch(/Running|Error/)
      const del = await cleanup.delete(`/v1/tenant/vms/${vmId}`)
      expect([200, 202, 204], `cleanup DELETE ${vmId} -> ${del.status()} ${(await del.text()).slice(0, 200)}`)
        .toContain(del.status())
      // 202 means "accepted", not "gone" — the workflow does the work. Prove it actually left.
      await expect
        .poll(async () => (await (await cleanup.get(`/v1/tenant/vms/${vmId}`)).json()).currentState,
              { timeout: 300_000, intervals: [10_000] })
        .toBe('Destroyed')
      await cleanup.dispose()
    }
    if (networkId) {
      const netCleanup = await apiAs(customer.page)
      const delNet = await netCleanup.delete(`/v1/tenant/networks/${networkId}`)
      expect(delNet.status(), `cleanup DELETE network ${networkId} -> ${delNet.status()}`).toBe(202)
      await expect
        .poll(async () => (await (await (await apiAs(customer.page)).get(`/v1/tenant/networks/${networkId}`)).json()).currentState,
              { timeout: 360_000, intervals: [5_000] })
        .toBe('Deleted')
      await netCleanup.dispose()
    }
  }

  await adminApi.dispose()
  await admin.ctx.close()
  await customer.ctx.close()
})

// ── C. the admin can read it and change it ──────────────────────────────────

test('C1+C2+C3 — old route dead, auth enforced, receivables carries the ceiling', async ({ browser }) => {
  const { ctx, page } = await loginAdmin(browser)
  const api = await apiAs(page)
  const tenants: Tenant[] = await (await api.get('/v1/tenants')).json()

  // C1 (negative, first): the renamed route must not still answer under its old name.
  const old = await api.patch(`/v1/tenants/${tenants[0].id}/credit-limit`, { data: { creditLimit: 1 } })
  expect(old.status(), 'PATCH /credit-limit must be gone').toBe(404)

  // C2: no token → 401, not 404 (the route exists; the caller is not authorised).
  const anon = await request.newContext({ baseURL: API })
  const noAuth = await anon.patch(`/v1/tenants/${tenants[0].id}/debt-ceiling`, { data: { debtCeiling: 1 } })
  expect(noAuth.status()).toBe(401)
  await anon.dispose()

  // C3: the reason the field exists — month-end close reads it here.
  const ar = await api.get('/v1/admin/billing/receivables')
  expect(ar.ok()).toBeTruthy()
  const arBody = await ar.json()
  for (const row of arBody.perTenant as Record<string, unknown>[]) {
    expect(row).toHaveProperty('debtCeiling')
    expect(row).toHaveProperty('overCeiling')
  }
  await api.dispose()
  await ctx.close()
})

test('C4+C5 — Tenants column and dialog say what the field actually does', async ({ browser }) => {
  const { ctx, page } = await loginAdmin(browser)

  // Admin nav items are LINKS (the customer portal's are buttons — the two portals differ, and
  // assuming they match cost a run here). Landing page is Dashboard, so navigate explicitly.
  await page.getByRole('link', { name: 'Tenants' }).first().click()
  await expect(page.getByRole('columnheader', { name: 'Debt ceiling' })).toBeVisible()
  // No default marker: every tenant carries its own number now.
  await expect(page.getByText('default', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: `${EVIDENCE}/admin-tenants-debt-ceiling.png`, fullPage: true })

  await page.getByRole('button', { name: 'Debt ceiling' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel(/ceiling \(vnd\)/i)).not.toHaveValue('')
  // The copy must not promise enforcement the build no longer performs.
  await expect(dialog.getByText(/blocked|blocks them|suspend/i)).toHaveCount(0)
  await expect(dialog.getByText(/does not block them from creating resources/i)).toBeVisible()
  await page.screenshot({ path: `${EVIDENCE}/admin-debt-ceiling-dialog.png`, fullPage: true })

  await ctx.close()
})
