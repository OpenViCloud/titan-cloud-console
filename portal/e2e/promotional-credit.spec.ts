import { test, expect, type Page } from '@playwright/test'

// Stage-3 staging UI regression — US-PROMO-01.
//
// The admin now GRANTS promotional credit directly (no tenant request / approval queue). This proves,
// against the real deployed staging (admin portal + tenant portal + real backend + migrated DB), that:
//   UI-1 — an admin grants credit to a tenant and sees it in the grant history, and
//   UI-2 — that tenant's wallet shows the credit as a `Promo` statement line with the new balance.
//
// Login is automated; the password comes from ADMIN_TEST_PASSWORD (injected from the k8s secret
// `admin-test-credentials`) — never hard-coded, never printed. trace/video/screenshot-on-action are
// off (playwright.config.ts) so the credential cannot land in an artifact; explicit screenshots are
// taken at safe observation points (password fields render masked).
//
// GRANT TARGET IS `admin-test` (balance 0, no committed spec pins it) — deliberately NOT beta-user,
// whose 509.842 ₫ oracle wallet-single-balance.spec.ts asserts. Grant is permanent (refund is manual,
// docs/architecture/money-and-wallet.md#credit-is-money); known-state.md is updated after this run.

const ADMIN_HOST = process.env.ADMIN_BASE_URL || 'https://admin-titan-staging.openvicloud.com'
const PORTAL_HOST = process.env.PORTAL_BASE_URL || 'https://portal-titan-staging.openvicloud.com'
const USERNAME = process.env.ADMIN_TEST_USERNAME || 'admin-test'
const PASSWORD = process.env.ADMIN_TEST_PASSWORD
const TENANT_NAME = 'admin-test'
const AMOUNT = '500000'
const REASON = 'Stage 3 regression 2026-09-15'
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
        "  ADMIN_TEST_PASSWORD=$(kubectl -n titan-auth-staging get secret admin-test-credentials -o jsonpath='{.data.password}' | base64 -d) npx playwright test promotional-credit",
    )
  }
})

// UI-1 — admin grants promotional credit and it appears in the grant history.
test('admin grants promotional credit to a tenant [UI-1]', async ({ page }) => {
  await login(page, ADMIN_HOST)

  // Reach the page via the nav link the admin actually sees (not a deep-link that assumes SPA rewrite).
  const nav = page.getByRole('link', { name: /promotional credit/i }).first()
  await nav.waitFor({ state: 'visible', timeout: 30_000 })
  await nav.click()

  await expect(page.getByRole('heading', { name: /promotional credit/i })).toBeVisible()

  // Grant form: pick the tenant, enter amount + reason, submit.
  await page.getByLabel(/tenant/i).selectOption({ label: TENANT_NAME })
  await page.getByLabel(/amount/i).fill(AMOUNT)
  await page.getByLabel(/reason/i).fill(REASON)
  await page.getByRole('button', { name: /grant credit/i }).click()

  // The grant lands in the history table — assert on the reason (unique to this row) and the amount.
  await expect(page.getByText(REASON)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/500,000\s*₫/).first()).toBeVisible()

  await page.screenshot({ path: `${EVIDENCE}/promo-admin-grant-pass.png`, fullPage: true })
})

// UI-2 — the granted credit shows in the tenant's wallet as a Promo statement line.
test('tenant wallet shows the granted credit as a Promo line [UI-2]', async ({ page }) => {
  await login(page, PORTAL_HOST)
  await page.waitForLoadState('networkidle')   // let the OAuth code exchange settle before a full nav

  // Legal consent gate (docs/features/legal/design.md#consent-gate-per-user, click-wrap TOS) — admin-test has not accepted TOS on the tenant
  // portal, and the wallet sits behind it. Tôn Chủ approved accepting the (placeholder) staging TOS
  // for this test account so the wallet is reachable.
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

  // Wait for real content (a Promo badge), not just the table shell.
  await expect(page.getByText('Promo').first()).toBeVisible({ timeout: 30_000 })
  // Balance reflects the grant (admin-test started at 0).
  await expect(page.getByText(/500,000\s*₫/).first()).toBeVisible()

  await page.screenshot({ path: `${EVIDENCE}/promo-tenant-wallet-pass.png`, fullPage: true })
})
