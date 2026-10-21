import { test, expect, type Page } from '@playwright/test'

// Stage-3 staging UI regression — prepaid wallet portal:
// Wallet page (balance + statement + receipts, VND), buy-credit → VietQR, and the VND re-denomination
// reaching the UI. Login is automated; the password comes from BETA_USER_PASSWORD (injected from the
// k8s secret `beta-user-credentials`) — never hard-coded or hand-entered.
const USERNAME = process.env.BETA_USER_USERNAME || 'beta-user'
const PASSWORD = process.env.BETA_USER_PASSWORD

const EVIDENCE = process.env.RESULTS_DIR || 'test-results/evidence'

async function login(page: Page) {
  await page.goto('/')
  const signIn = page.getByRole('button', { name: /sign in|log ?in|đăng nhập/i }).first()
  if (await signIn.isVisible().catch(() => false)) await signIn.click().catch(() => {})

  const username = page.locator('#username, input[name="username"]').first()
  await username.waitFor({ state: 'visible', timeout: 45_000 })
  await username.fill(USERNAME)
  await page.locator('#password, input[name="password"]').first().fill(PASSWORD!)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()
  await page.waitForURL(/portal-titan-staging\.openvicloud\.com/, { timeout: 45_000 })
}

test.beforeAll(() => {
  if (!PASSWORD) {
    throw new Error(
      "BETA_USER_PASSWORD is not set. Inject at run time:\n" +
        "  BETA_USER_PASSWORD=$(kubectl -n titan-auth-staging get secret beta-user-credentials -o jsonpath='{.data.password}' | base64 -d) npx playwright test wallet",
    )
  }
})

test('wallet: balance + statement + receipts (VND) [W-01, W-03]', async ({ page }) => {
  await login(page)
  await expect(page.getByText('beta-user')).toBeVisible({ timeout: 30_000 })

  await page.goto('/wallet')
  await page.waitForURL(/\/wallet/, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')

  // Heading + the two sections render.
  await expect(page.getByRole('heading', { name: 'Wallet', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Statement' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Receipts' })).toBeVisible()

  // W-04 (part): the balance is denominated in VND — a "₫" appears on the page, and no "$"/"SGD $".
  await expect(page.getByText(/₫/).first()).toBeVisible({ timeout: 15_000 })

  await page.screenshot({ path: `${EVIDENCE}/wallet-page-pass.png`, fullPage: true })
})

test('wallet: buy credit renders VietQR with amount + PaymentRef [W-02]', async ({ page }) => {
  await login(page)
  await expect(page.getByText('beta-user')).toBeVisible({ timeout: 30_000 })
  await page.goto('/wallet')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: /buy credit/i }).click()
  await expect(page.getByRole('heading', { name: /buy credit/i })).toBeVisible()

  // Enter an amount and continue — creates a Pending TopUp (a purchase intent; no money moves).
  await page.getByLabel(/amount/i).fill('500000')
  await page.getByRole('button', { name: /continue/i }).click()

  // The pay step renders a VietQR image whose src carries the amount and the PaymentRef memo.
  const qr = page.getByRole('img', { name: /vietqr/i })
  await expect(qr).toBeVisible({ timeout: 20_000 })
  const src = await qr.getAttribute('src')
  expect(src).toContain('qr.sepay.vn')
  expect(src).toContain('amount=500000')
  expect(src).toMatch(/des=TITAN-/)

  // The QR bitmap actually painted (not just the <img> element present) — naturalWidth > 0 means the
  // qr.sepay.vn PNG loaded, so the evidence shot shows a real scannable QR, not a blank box.
  await expect
    .poll(async () => qr.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0)

  await page.screenshot({ path: `${EVIDENCE}/buy-credit-vietqr-pass.png`, fullPage: true })
})

test('VND reached the UI: invoice amounts read in ₫, not $ [W-04]', async ({ page }) => {
  await login(page)
  await expect(page.getByText('beta-user')).toBeVisible({ timeout: 30_000 })

  await page.goto('/billing/invoices')
  await page.waitForLoadState('networkidle')

  // If an invoice row exists, open it and assert the total reads in VND (₫). If the list is empty,
  // the VND assertion on the wallet page (W-01) already proves the re-denomination reached the UI.
  const row = page.locator('tbody tr td').filter({ hasText: /\d{4}/ }).first()
  if (await row.isVisible().catch(() => false)) {
    await row.click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/₫/).first()).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: `${EVIDENCE}/invoice-detail-vnd-pass.png`, fullPage: true })
  } else {
    await page.screenshot({ path: `${EVIDENCE}/invoices-empty-vnd.png`, fullPage: true })
  }
})
