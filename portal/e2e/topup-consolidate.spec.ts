import { test, expect, type Page } from '@playwright/test'

// Stage-3 staging UI regression — US-TOPUP-CONSOLIDATE.
//
// The TopUp lifecycle is consolidated behind one TopUpService and the unified /topups routes
// (breaking: the old /v1/admin/promotional-credits + /v1/tenant/wallet/topups are 404). This proves,
// against the real deployed staging (admin portal + tenant portal + new backend), that the admin
// promo grant still works END TO END through the NEW route (admin portal hook now POSTs
// /v1/admin/topups/grant and GETs /v1/admin/topups?source=PromotionalCredit), and the credit reaches
// the tenant wallet. If the route hard-cut had broken the wiring, the grant would 404 and neither
// assertion below would pass.
//
// Login is automated; the password comes from ADMIN_TEST_PASSWORD (injected from the k8s secret
// `admin-test-credentials`) — never hard-coded, never printed. trace/video off (playwright.config.ts).
//
// GRANT TARGET IS `admin-test`. Amount is a small, DISTINCTIVE 12.345 ₫ with a unique reason so the
// assertions key on THIS run's row, never on absolute balance (admin-test already carries a 500.000 ₫
// promo from US-PROMO-01). Grant is permanent (docs/architecture/money-and-wallet.md#credit-is-money); known-state.md is updated after this run.

const ADMIN_HOST = process.env.ADMIN_BASE_URL || 'https://admin-titan-staging.openvicloud.com'
const PORTAL_HOST = process.env.PORTAL_BASE_URL || 'https://portal-titan-staging.openvicloud.com'
const USERNAME = process.env.ADMIN_TEST_USERNAME || 'admin-test'
const PASSWORD = process.env.ADMIN_TEST_PASSWORD
const TENANT_NAME = 'admin-test'
const AMOUNT = '12345'
const AMOUNT_DISPLAY = /12,345\s*₫/
const REASON = 'Stage3 TOPUP-CONSOLIDATE 2026-09-17'
const EVIDENCE = process.env.RESULTS_DIR || 'test-results/evidence'

async function login(page: Page, host: string) {
  await page.goto(host + '/')
  const signIn = page.getByRole('button', { name: /sign in|log ?in|đăng nhập/i }).first()
  if (await signIn.isVisible().catch(() => false)) await signIn.click().catch(() => {})

  const username = page.locator('#username, input[name="username"]').first()
  await username.waitFor({ state: 'visible', timeout: 45_000 })
  await username.fill(USERNAME)
  await page.locator('#password, input[name="password"]').first().fill(PASSWORD!)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()
  await page.waitForURL(new RegExp(host.replace(/^https?:\/\//, '').replace(/\./g, '\\.')), { timeout: 45_000 })
}

test.beforeAll(() => {
  if (!PASSWORD) {
    throw new Error(
      'ADMIN_TEST_PASSWORD is not set. Inject at run time:\n' +
        "  ADMIN_TEST_PASSWORD=$(kubectl -n titan-auth-staging get secret admin-test-credentials -o jsonpath='{.data.password}' | base64 -d) npx playwright test topup-consolidate",
    )
  }
})

// UI-1 — admin grants promo via the NEW /v1/admin/topups/grant route; it appears in grant history
// (served by GET /v1/admin/topups?source=PromotionalCredit). A 404 from the route hard-cut fails here.
test('admin grants promo via unified /topups route [UI-1]', async ({ page }) => {
  await login(page, ADMIN_HOST)

  const nav = page.getByRole('link', { name: /promotional credit/i }).first()
  await nav.waitFor({ state: 'visible', timeout: 30_000 })
  await nav.click()
  await expect(page.getByRole('heading', { name: /promotional credit/i })).toBeVisible()

  await page.getByLabel(/tenant/i).selectOption({ label: TENANT_NAME })
  await page.getByLabel(/amount/i).fill(AMOUNT)
  await page.getByLabel(/reason/i).fill(REASON)
  await page.getByRole('button', { name: /grant credit/i }).click()

  // The grant lands in the history table — assert on this run's unique reason + distinctive amount.
  await expect(page.getByText(REASON)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(AMOUNT_DISPLAY).first()).toBeVisible()

  await page.screenshot({ path: `${EVIDENCE}/topup-consolidate-admin-grant-pass.png`, fullPage: true })
})

// UI-2 — the granted credit shows in the tenant's wallet as a Promo statement line (the /wallet page
// and its statement route are unchanged; this proves the grant via the new route actually credited).
test('tenant wallet shows the granted credit as a Promo line [UI-2]', async ({ page }) => {
  await login(page, PORTAL_HOST)
  await page.waitForLoadState('networkidle')

  // Legal consent gate (docs/features/legal/design.md#consent-gate-per-user) — admin-test already accepted TOS (US-PROMO-01), but handle it if shown.
  const consent = page.getByRole('checkbox', { name: /đã đọc và đồng ý|read and agree/i }).first()
  if (await consent.isVisible().catch(() => false)) {
    await consent.check()
    await page.getByRole('button', { name: /đồng ý & tiếp tục|agree.*continue/i }).click()
    await page.waitForLoadState('networkidle')
  }

  await page.goto(PORTAL_HOST + '/wallet')
  await page.waitForURL(/\/wallet/, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: 'Wallet', exact: true })).toBeVisible({ timeout: 30_000 })

  // Wait for real content: this run's distinctive amount on a Promo line (not just the table shell).
  await expect(page.getByText('Promo').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(AMOUNT_DISPLAY).first()).toBeVisible({ timeout: 20_000 })

  await page.screenshot({ path: `${EVIDENCE}/topup-consolidate-tenant-wallet-pass.png`, fullPage: true })
})
