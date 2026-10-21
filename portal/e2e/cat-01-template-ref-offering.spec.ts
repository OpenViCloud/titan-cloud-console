import { test, expect, request, type Page, type Browser } from '@playwright/test'

// Stage-3 staging regression for CAT-01 / docs/features/catalog/design.md#template-borrows-sizing — VmTemplate borrows its sizing from VmOffering.
// Plan: cases U1–U6 of the iteration's regression plan.
//
// Two things this file proves that no unit test can:
//   (1) SEC-KS-1 — the admin-test password rotation actually reached Keycloak. The OLD password
//       must be REJECTED. A new value in the k8s secret proves only that terraform ran; Keycloak
//       is a different system and config-cli's log does not say it set the password.
//   (2) The DEPLOYED image serves the new template shape. Deleting fields from a DTO in source is
//       not evidence about the running container.
//
// Keycloak has direct-grant DISABLED for both clients, so API calls borrow the browser session's
// access token out of sessionStorage. Passwords come from env (injected from k8s secrets / git
// history for the dead one) and never enter a log or an artifact — trace/video/screenshot are off
// by default in playwright.config.ts and the password field renders masked.
const ADMIN_URL = process.env.ADMIN_BASE_URL || 'https://admin-titan-staging.openvicloud.com'
const PORTAL_URL = process.env.PORTAL_BASE_URL || 'https://portal-titan-staging.openvicloud.com'
const API = process.env.API_BASE_URL || 'https://api-titan-staging.openvicloud.com'

const ADMIN_USER = process.env.ADMIN_TEST_USERNAME || 'admin-test'
const ADMIN_PASSWORD = process.env.ADMIN_TEST_PASSWORD
const ADMIN_OLD_PASSWORD = process.env.ADMIN_TEST_OLD_PASSWORD
const BETA_USER = process.env.BETA_USER_USERNAME || 'beta-user'
const BETA_PASSWORD = process.env.BETA_USER_PASSWORD

const EVIDENCE = process.env.RESULTS_DIR || 'test-results/evidence'

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  const missing = [
    !ADMIN_PASSWORD && 'ADMIN_TEST_PASSWORD',
    !ADMIN_OLD_PASSWORD && 'ADMIN_TEST_OLD_PASSWORD',
    !BETA_PASSWORD && 'BETA_USER_PASSWORD',
  ].filter(Boolean)
  if (missing.length) throw new Error(`Missing credentials: ${missing.join(', ')}`)
  if (ADMIN_PASSWORD === ADMIN_OLD_PASSWORD) {
    throw new Error('old and new admin passwords are identical — U1 would be vacuous')
  }
})

async function submitKeycloak(page: Page, base: string, user: string, password: string) {
  await page.goto(base)
  const signIn = page.getByRole('button', { name: /sign in|log ?in|đăng nhập/i }).first()
  if (await signIn.isVisible().catch(() => false)) await signIn.click().catch(() => {})
  const username = page.locator('#username, input[name="username"]').first()
  await username.waitFor({ state: 'visible', timeout: 45_000 })
  await username.fill(user)
  await page.locator('#password, input[name="password"]').first().fill(password)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()
}

async function login(page: Page, base: string, user: string, password: string, ready: RegExp) {
  await submitKeycloak(page, base, user, password)
  // Wait for real content, not just "some element exists" — the app must finish booting.
  await page.getByText(ready).first().waitFor({ state: 'visible', timeout: 45_000 })
}

async function bearer(page: Page): Promise<string> {
  const token = await page.evaluate(async () => {
    for (let i = 0; i < 30; i++) {
      const key = Object.keys(sessionStorage).find(k => k.startsWith('oidc.user:'))
      if (key) return JSON.parse(sessionStorage.getItem(key)!).access_token as string
      await new Promise(r => setTimeout(r, 500))
    }
    return null
  })
  if (!token) throw new Error('no access_token in sessionStorage')
  return token
}

// A fresh browser context per login: the Keycloak SSO cookie is per-context, and sharing one makes
// the second portal silently reuse the first user (reads like a 403 product bug).
async function loginAs(browser: Browser, base: string, user: string, pw: string, ready: RegExp) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await login(page, base, user, pw, ready)
  return { ctx, page }
}

// ── U1 — SEC-KS-1 negative: the leaked password must be dead ─────────────────

test('U1 — the OLD admin-test password is REJECTED by Keycloak', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  await submitKeycloak(page, ADMIN_URL, ADMIN_USER, ADMIN_OLD_PASSWORD!)

  // Keycloak's own error, on Keycloak's own host. Asserting the error text alone would also pass on
  // a page that never loaded, so the host is asserted too.
  const error = page.locator('#input-error, .alert-error, [id*="input-error"]').first()
  await expect(error, 'Keycloak must reject the rotated-away password').toBeVisible({ timeout: 45_000 })
  await expect(page).toHaveURL(/auth-titan-staging\.openvicloud\.com/)

  // And it must NOT have reached the admin app.
  await expect(page.getByText(/dashboard/i)).toHaveCount(0)

  await page.screenshot({ path: `${EVIDENCE}/u1-old-password-rejected-pass.png`, fullPage: true })
  await ctx.close()
})

// ── U2/U3/U4 — admin catalog on the deployed image ──────────────────────────

test('U2+U3+U4 — new password works; catalog shows a spelled-out Size and exactly 3 templates',
  async ({ browser }) => {
    // U2 — the positive half of SEC-KS-1.
    const { ctx, page } = await loginAs(browser, ADMIN_URL, ADMIN_USER, ADMIN_PASSWORD!, /dashboard|tenants/i)
    await page.screenshot({ path: `${EVIDENCE}/u2-new-password-login-pass.png`, fullPage: true })

    // Admin nav items are links (the customer portal's are buttons) and the landing page is the
    // Dashboard, so the Catalog has to be navigated to explicitly.
    await page.getByRole('link', { name: /catalog/i }).first().click()

    // Wait for a value that only exists once the data has arrived. An empty-state row is still a
    // <tr>, so "the table has a first row" cannot tell loading from empty.
    await expect(page.getByText('Ubuntu-22.04-Standard')).toBeVisible({ timeout: 45_000 })

    const templates = page.locator('table').first()

    // U3 — the Size column, spelled out. The tier id "m" alone would be a pass here and useless to
    // an operator, so the assertion is on the resolved text.
    await expect(templates.getByRole('columnheader', { name: 'Size' })).toBeVisible()
    await expect(templates.getByText('Medium — 2 vCPU · 4 GB')).toBeVisible()
    await expect(templates.getByText(/Large — 4 vCPU · 8 GB/).first()).toBeVisible()

    // The negative half: the two numeric columns are gone. Without this, adding Size while keeping
    // the old columns would pass.
    await expect(templates.getByRole('columnheader', { name: 'CPU / vCPU' })).toHaveCount(0)
    await expect(templates.getByRole('columnheader', { name: /Memory \(MB\)/ })).toHaveCount(0)

    // U4 — exactly three rows, and the two deleted seeds are absent.
    await expect(templates.locator('tbody tr')).toHaveCount(3)
    await expect(page.getByText('Ubuntu-20.04-Web')).toHaveCount(0)
    await expect(page.getByText('Debian-11-Minimal')).toHaveCount(0)

    await page.screenshot({ path: `${EVIDENCE}/u3-u4-admin-catalog-size-column-pass.png`, fullPage: true })
    await ctx.close()
  })

// ── U5 — the public contract as the deployed image serves it ────────────────

test('U5 — GET /v1/templates drops the sizing fields and does not publish the tier', async ({ browser }) => {
  const { ctx, page } = await loginAs(browser, PORTAL_URL, BETA_USER, BETA_PASSWORD!, /beta-user/i)
  const api = await request.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${await bearer(page)}` },
  })

  const res = await api.get('/v1/templates')
  expect(res.status(), 'GET /v1/templates').toBe(200)
  const list = await res.json()

  // Non-empty first: an empty array satisfies every key assertion below vacuously.
  expect(Array.isArray(list) && list.length, 'templates must be non-empty').toBeGreaterThan(0)
  // Three seeds, but customers are offered only the listed one (docs/features/catalog/design.md#template-listed).
  expect(list.length, 'docs/features/catalog/design.md#template-listed offers Ubuntu only').toBe(1)

  for (const t of list) {
    expect(Object.keys(t).sort(), `keys of template ${t.name}`)
      .toEqual(['description', 'diskGb', 'id', 'name', 'os'])
  }

  await api.dispose()
  await page.screenshot({ path: `${EVIDENCE}/u5-customer-portal-loaded-pass.png`, fullPage: true })
  await ctx.close()
})

// ── U6 — the customer still picks OS and size independently ─────────────────

test('U6 — Create VM keeps Template and Size as two independent choices', async ({ browser }) => {
  const { ctx, page } = await loginAs(browser, PORTAL_URL, BETA_USER, BETA_PASSWORD!, /beta-user/i)

  // Customer portal nav items are buttons, and the label is "Virtual Machines" — not "VMs".
  // Guessing it cost one run: the first attempt matched nothing and timed out, which looks exactly
  // like a broken page until you read the nav source (MainLayout.tsx:31).
  await page.getByRole('button', { name: 'Virtual Machines' }).first().click()
  await page.getByRole('button', { name: 'Create VM' }).first().click()

  // label and select are siblings inside the field wrapper.
  const templateSelect = page.locator('label:text-is("Template") + select')
  const sizeSelect = page.locator('label:text-is("Size") + select')
  await expect(templateSelect).toBeVisible({ timeout: 30_000 })
  await expect(sizeSelect).toBeVisible()

  // Each select carries one placeholder option plus the real ones.
  await expect(templateSelect.locator('option'), '1 listed template + placeholder').toHaveCount(2)
  await expect(sizeSelect.locator('option'), '4 tiers + placeholder').toHaveCount(5)

  // The size options still spell out what the customer is buying — and they come from the offering
  // catalog, not from whatever tier a template happens to point at.
  await expect(sizeSelect.locator('option', { hasText: /Small — 1 vCPU · 2 GB/ })).toHaveCount(1)
  await expect(sizeSelect.locator('option', { hasText: /Extra Large — 8 vCPU · 16 GB/ })).toHaveCount(1)

  // Choosing a template must NOT constrain the size list (docs/features/catalog/design.md#template-borrows-sizing: the FK is a base, not a limit).
  await templateSelect.selectOption({ index: 1 })
  await expect(sizeSelect.locator('option'), 'size list unchanged by template choice').toHaveCount(5)

  await page.screenshot({ path: `${EVIDENCE}/u6-create-vm-two-choices-pass.png`, fullPage: true })
  // Deliberately NOT clicking Create — provisioning a VM is billable.
  await ctx.close()
})
