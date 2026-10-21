import { test, expect, type Page } from '@playwright/test'

// Stage-3 staging UI regression — CQRS-2 / docs/architecture/http-contract.md#create-returns-id, admin side (2026-09-22).
//
// POST /v1/admin/topups/grant used to return the whole TopUpDto, and the admin hook mapped that
// response into a PromotionalCredit row. After docs/architecture/http-contract.md#create-returns-id it answers with `{ topUpId }` alone, so the
// new grant can only reach the screen through the history query being invalidated and refetched.
//
// A unit test cannot show this: it would stub both the mutation and the query. What is being
// measured here is that the DEPLOYED grant endpoint returns an id, the DEPLOYED history endpoint
// carries the row, and the page joins the two.
//
// Grant target is `admin-test` — deliberately NOT beta-user, whose 509.842 ₫ balance is the oracle
// other specs assert against. A grant is permanent (refund is manual, docs/architecture/money-and-wallet.md#credit-is-money), so known-state.md
// is updated after this run.
const ADMIN_HOST = process.env.ADMIN_BASE_URL || 'https://admin-titan-staging.openvicloud.com'
const USERNAME = process.env.ADMIN_TEST_USERNAME || 'admin-test'
const PASSWORD = process.env.ADMIN_TEST_PASSWORD
const EVIDENCE = process.env.RESULTS_DIR || 'test-results/evidence'

// A deliberately odd amount so the row that appears can only be THIS grant — a round number could
// match an older row and turn a broken refetch into a passing test.
const AMOUNT = '7331'
const AMOUNT_DISPLAY = /7,331\s*₫/
const REASON = 'CQRS-2 Stage 3 2026-09-22'

async function login(page: Page) {
  await page.goto(ADMIN_HOST + '/', { waitUntil: 'domcontentloaded' })
  const signIn = page.getByRole('button', { name: /sign in|log ?in|đăng nhập/i }).first()
  if (await signIn.isVisible().catch(() => false)) await signIn.click().catch(() => {})
  const username = page.locator('#username, input[name="username"]').first()
  await username.waitFor({ state: 'visible', timeout: 45_000 })
  await username.fill(USERNAME)
  await page.locator('#password, input[name="password"]').first().fill(PASSWORD!)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()
  await page.waitForURL(/admin-titan-staging\.openvicloud\.com/, { timeout: 45_000 })
  await page.getByRole('navigation').or(page.getByRole('heading').first()).first()
    .waitFor({ state: 'visible', timeout: 45_000 })
}

test.beforeAll(() => {
  if (!PASSWORD) {
    throw new Error(
      'ADMIN_TEST_PASSWORD is not set. Inject at run time:\n' +
      "  ADMIN_TEST_PASSWORD=$(kubectl -n titan-auth-staging get secret admin-test-credentials " +
      "-o jsonpath='{.data.password}' | base64 -d) npx playwright test",
    )
  }
})

test('U-4 an admin grant shows up in the history read back from the query', async ({ page }) => {
  await login(page)
  // Reach the page via the nav link the admin actually sees, not a deep link that assumes an SPA
  // rewrite — a deep link fails on routing, which reads exactly like the page being broken.
  const nav = page.getByRole('link', { name: /promotional credit/i }).first()
  await nav.waitFor({ state: 'visible', timeout: 30_000 })
  await nav.click()

  await expect(page.getByRole('heading', { name: /promotional credit/i })).toBeVisible()

  await page.getByLabel(/tenant/i).selectOption({ label: 'admin-test' })
  await page.getByLabel(/amount/i).fill(AMOUNT)
  await page.getByLabel(/reason/i).fill(REASON)
  await page.getByRole('button', { name: /grant credit/i }).click()

  // The row can only be here because the history query refetched — the mutation response no longer
  // carries anything to render.
  await expect(page.getByText(REASON)).toBeVisible({ timeout: 45_000 })
  await expect(page.getByText(AMOUNT_DISPLAY).first()).toBeVisible()

  await page.screenshot({ path: `${EVIDENCE}/u4-admin-grant-pass.png`, fullPage: true })
})
