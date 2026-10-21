import { test, expect, type Page } from '@playwright/test'

// Stage-3 staging UI regression — docs/architecture/money-and-wallet.md#single-writer-outbox S7, ADMIN surface (2026-09-21).
//
// Why the admin table needs its own run, and why it is the heavier of the two: an admin settling
// from a tenant's wallet spends SOMEONE ELSE'S money (docs/architecture/money-and-wallet.md#human-confirmed-debit PAY-5). Before S7 this table left BOTH
// buttons live while a debit was in flight, so an admin could press "Settle from wallet" (202) and
// then "Mark paid" — and those two routes exist precisely to keep apart money that moved inside
// Titan from money that arrived by bank transfer. Pressing one over the other destroys the audit
// trail's ability to say who spent whose money.
//
// The admin table also has its own copy of the rule (a local `terminal()`, not lib/invoice's
// isPayable), so a fix to the tenant path proves nothing here.
const ADMIN_HOST = process.env.ADMIN_BASE_URL || 'https://admin-titan-staging.openvicloud.com'
const USERNAME = process.env.ADMIN_TEST_USERNAME || 'admin-test'
const PASSWORD = process.env.ADMIN_TEST_PASSWORD

const EVIDENCE = process.env.RESULTS_DIR || 'test-results/evidence'

// Seeded for this run: one New invoice, 3.000 ₫, period 2026-6, for tenant admin-test (whose wallet
// holds ~513.579 ₫ after the A-2 sweeper proof credited it).
const PERIOD = process.env.ADMIN_TEST_INVOICE_PERIOD || '2026-06'

async function login(page: Page) {
  // 'domcontentloaded': the staging edge is intermittently slow on secondary assets, and waiting on
  // every one of them turns a slow CDN into a false failure of the screen.
  await page.goto(ADMIN_HOST + '/', { waitUntil: 'domcontentloaded' })
  const signIn = page.getByRole('button', { name: /sign in|log ?in|đăng nhập/i }).first()
  if (await signIn.isVisible().catch(() => false)) await signIn.click().catch(() => {})

  const username = page.locator('#username, input[name="username"]').first()
  await username.waitFor({ state: 'visible', timeout: 45_000 })
  await username.fill(USERNAME)
  await page.locator('#password, input[name="password"]').first().fill(PASSWORD!)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()

  // Waiting for the URL alone only proves the OAuth redirect landed; the SPA still has to exchange
  // the code and mount. Wait for rendered chrome so the next navigation is reliable.
  await page.waitForURL(/admin-titan-staging\.openvicloud\.com/, { timeout: 45_000 })
  await page.getByRole('link').first().waitFor({ state: 'visible', timeout: 45_000 })
}

test.beforeAll(() => {
  if (!PASSWORD) {
    throw new Error(
      'ADMIN_TEST_PASSWORD is not set. Inject at run time:\n' +
        "  ADMIN_TEST_PASSWORD=$(kubectl -n titan-auth-staging get secret admin-test-credentials -o jsonpath='{.data.password}' | base64 -d) npx playwright test wallet-pending-ux-admin",
    )
  }
})

test('U-6/U-7 — settling from a tenant wallet takes BOTH buttons off the row', async ({ page }) => {
  await login(page)

  // Reach the page the way an admin does, via the nav link — not a deep link that assumes the SPA
  // rewrite is configured.
  const nav = page.getByRole('link', { name: /invoices/i }).first()
  await nav.waitFor({ state: 'visible', timeout: 30_000 })
  await nav.click()
  await expect(page.getByRole('heading', { name: /invoices/i })).toBeVisible({ timeout: 30_000 })

  // PRECONDITION asserted in the same measurement as the action: this invoice must be unpaid RIGHT
  // NOW, with both buttons available. A run that assumed it and found it already settled would
  // return a valid-looking result for a state that cannot test the rule at all.
  const row = page.locator('tr', { hasText: PERIOD }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row.getByText('New', { exact: true })).toBeVisible()

  const settle = row.getByRole('button', { name: /settle from wallet/i })
  const markPaid = row.getByRole('button', { name: /mark paid/i })
  await expect(settle).toBeEnabled()
  await expect(markPaid).toBeEnabled()
  await page.screenshot({ path: `${EVIDENCE}/u6-admin-before.png`, fullPage: true })

  await settle.click()

  // U-6 — the property that must hold at EVERY instant after acceptance, on both buttons.
  //
  // Not asserted as "the row says Processing": on this cluster the consumer applies the debit in
  // ~100ms (measured during the tenant run: created_at .564 → applied_at .664), so that state is
  // real but shorter than a click. Asserting it through the UI would be a race in the TEST, and
  // would make a fast system look broken. What matters is that neither route to charging this
  // invoice again is open — true whether the row currently reads Processing or already Settled.
  await expect(markPaid).toBeDisabled({ timeout: 20_000 })
  await expect(settle).toBeDisabled()
  await page.screenshot({ path: `${EVIDENCE}/u6-admin-both-disabled.png`, fullPage: true })

  // U-7 — it resolves on its own, without a reload.
  //
  // Scoped to the status cell's badge, not the whole row: /paid/i also matches the "Mark paid"
  // BUTTON, so a row-wide text match resolved to two elements and failed in strict mode. The button
  // being present is not evidence about the status — the badge is.
  await expect(row.locator('span', { hasText: /^settled$/i })).toBeVisible({ timeout: 45_000 })
  await expect(markPaid).toBeDisabled()
  await expect(settle).toBeDisabled()
  await page.screenshot({ path: `${EVIDENCE}/u7-admin-settled.png`, fullPage: true })
})
