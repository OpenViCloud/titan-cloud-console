import { test, expect, type Page } from '@playwright/test'

// Stage-3 staging UI regression — legal click-wrap consent:
// public /legal/terms page (anon), the consent gate for a signed-in user who has not accepted, accepting
// it, and the footer link. Login is automated; the password comes from BETA_USER_PASSWORD (injected from
// the k8s secret `beta-user-credentials`) — never hard-coded or hand-entered.
const USERNAME = process.env.BETA_USER_USERNAME || 'beta-user'
const PASSWORD = process.env.BETA_USER_PASSWORD

const EVIDENCE = process.env.RESULTS_DIR || 'test-results/evidence'

// Logs in and returns on the portal origin. Does NOT assert the app is reached — after this feature a
// not-yet-accepted user lands on the consent gate, not the dashboard.
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
        "  BETA_USER_PASSWORD=$(kubectl -n titan-auth-staging get secret beta-user-credentials -o jsonpath='{.data.password}' | base64 -d) npx playwright test legal-consent",
    )
  }
})

// U1 — the public legal document is readable WITHOUT logging in.
test('U1: /legal/terms renders anonymously with title + version [US-LEGAL-03]', async ({ page }) => {
  await page.goto('/legal/terms')

  const article = page.getByTestId('legal-terms')
  await expect(article).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible()
  await expect(page.getByTestId('legal-version')).toContainText('v0-placeholder')

  await page.screenshot({ path: `${EVIDENCE}/legal-terms-anon-pass.png`, fullPage: true })
})

// U2 + U3 — a signed-in user who has not accepted is gated; ticking + confirming clears the gate.
test('U2+U3: consent gate appears then accepting reaches the app [US-LEGAL-01]', async ({ page }) => {
  await login(page)

  // U2 — the gate is shown, not the app. Checkbox unticked, confirm disabled (AC1/AC2).
  const gate = page.getByTestId('consent-gate')
  await expect(gate).toBeVisible({ timeout: 30_000 })
  const checkbox = page.getByTestId('consent-checkbox')
  await expect(checkbox).not.toBeChecked()
  await expect(page.getByTestId('consent-accept')).toBeDisabled()
  await page.screenshot({ path: `${EVIDENCE}/consent-gate-pass.png`, fullPage: true })

  // U3 — tick enables confirm; confirming records acceptance and the gate clears (AC3).
  await checkbox.check()
  await expect(page.getByTestId('consent-accept')).toBeEnabled()
  await page.getByTestId('consent-accept').click()

  await expect(gate).toBeHidden({ timeout: 30_000 })
  await expect(page.getByText('beta-user')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: `${EVIDENCE}/consent-accept-pass.png`, fullPage: true })
})

// U4 — the footer links to the public terms page (runs after U3, so beta-user is no longer gated).
test('U4: footer links to the terms page [US-LEGAL-03]', async ({ page }) => {
  await login(page)
  await expect(page.getByText('beta-user')).toBeVisible({ timeout: 30_000 })

  const link = page.getByRole('link', { name: 'Terms of Service' })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', '/legal/terms')
  await expect(link).toHaveAttribute('target', '_blank')

  await page.screenshot({ path: `${EVIDENCE}/footer-legal-link-pass.png`, fullPage: true })
})
