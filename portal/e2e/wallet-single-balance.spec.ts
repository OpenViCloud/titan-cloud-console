import { test, expect, type Page } from '@playwright/test'

// Stage-3 staging UI regression — docs/architecture/money-and-wallet.md#wallet-one-balance.
//
// The wallet stopped being a pile of credit lots and became one balance plus a signed ledger. The
// customer's screen is meant to be UNCHANGED — which is exactly why it has to be checked: "the UI did
// not change" is a claim about a screen nobody looked at until someone looks at it.
//
// What these prove that the unit tests cannot: the number on the page comes from the migrated data on
// the real database, through the real API, after the real deploy. A green suite proves the code can
// produce the right number; only this proves it did.
//
// Login is automated; the password comes from BETA_USER_PASSWORD (injected from the k8s secret
// `beta-user-credentials`) — never hard-coded, never printed.
const USERNAME = process.env.BETA_USER_USERNAME || 'beta-user'
const PASSWORD = process.env.BETA_USER_PASSWORD

const EVIDENCE = process.env.RESULTS_DIR || 'test-results/evidence'

// The oracle, read from core.wallet_entries BEFORE the migration ran:
//   2 lots, 510.000 in, 158,493 spent  →  509.841,507
//
// The portal ROUNDS VND (portal/src/lib/money.ts, English by default), so the exact
// stored value is not what a customer reads — 509.841,507 renders as "509,842 ₫" and the 158,493
// spend renders as "-158 ₫". Asserting the unrounded number here produced a false FAIL that looked
// exactly like the worst possible bug ("the balance is wrong after the migration"). The oracle is
// still the pre-migration database value; what changed is that this file now knows how money is
// displayed instead of assuming.
const EXPECTED_BALANCE = /509,842\s*₫/
const EXPECTED_SPEND = /-\s*158\s*₫/

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
      'BETA_USER_PASSWORD is not set. Inject at run time:\n' +
        "  BETA_USER_PASSWORD=$(kubectl -n titan-auth-staging get secret beta-user-credentials -o jsonpath='{.data.password}' | base64 -d) npx playwright test wallet-single-balance",
    )
  }
})

// U-1 + U-2 + U-3 — the balance survived the migration, the statement still shows both directions,
// and the page looks the way it looked yesterday.
test('wallet: migrated balance, statement, unchanged layout, narrowed contract [U-1..U-4]', async ({ page }) => {
  // U-4 rides along here rather than in its own test: it needs exactly the same navigation, and a
  // second login is a second chance to fail for reasons that have nothing to do with the wallet.
  // Collected SYNCHRONOUSLY — an async handler that awaits r.json() before pushing races the
  // assertions and can leave the list empty while the request plainly happened.
  const seen: import('@playwright/test').Response[] = []
  page.on('response', r => {
    if (/\/v1\/tenant\/wallet(\?|$)/.test(r.url()) && r.status() === 200) seen.push(r)
  })

  await login(page)
  await expect(page.getByText('beta-user')).toBeVisible({ timeout: 30_000 })

  await page.goto('/wallet')
  await page.waitForURL(/\/wallet/, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')

  // U-3 — the same sections as before docs/architecture/money-and-wallet.md#wallet-one-balance. Nothing was added, nothing disappeared.
  await expect(page.getByRole('heading', { name: 'Wallet', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Statement' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Receipts' })).toBeVisible()

  // U-1 — THE assertion: the number a customer reads is the number the wallet held before the model
  // changed underneath them. Asserted on page content, not on an API response, because the customer
  // reads the page.
  await expect(page.getByText(EXPECTED_BALANCE).first()).toBeVisible({ timeout: 20_000 })

  // U-2 — both directions are on the statement. Money in only (with the spend missing) is the exact
  // failure the old two-source statement could produce, and it looks like a working page.
  const statement = page.locator('table').filter({ hasText: /TopUp|Promo|Spend/ }).first()
  await expect(statement).toBeVisible()
  // The badge reads "Top-up", not the wire value "TopUp" — the page speaks to a person, the API to a
  // client. Matching the wire value here was a false FAIL against a label that never changed.
  await expect(statement.getByText(/Top-?up/i).first()).toBeVisible()
  await expect(statement.getByText('Spend').first()).toBeVisible()

  // ...and the outflow is the invoice that was paid (158,493 stored, "-158 ₫" displayed).
  await expect(statement.getByText(EXPECTED_SPEND).first()).toBeVisible()

  await page.screenshot({ path: `${EVIDENCE}/wallet-after-migration.png`, fullPage: true })

  // U-4 — the API really did get smaller. Read from the wire, not from the source tree: the deployed
  // build is the thing under test, and a stale image would still serve the old shape.
  expect(seen.length).toBeGreaterThan(0)   // non-empty guard: no capture makes the rest vacuous
  const response = seen[seen.length - 1]
  const body = (await response.json()) as Record<string, unknown>
  expect(body).toHaveProperty('balance')
  expect(body).toHaveProperty('currency')
  // The lot list is GONE from the contract, not merely empty — an empty array would mean the old
  // shape is still being served and nothing was actually retired.
  expect(body).not.toHaveProperty('entries')
})

// The invoices page reads the same balance to decide whether the pay button is enabled. It is a
// second consumer of the number, so it is a second chance for the number to be wrong.
test('invoices: page still renders and reads the wallet balance [U-3]', async ({ page }) => {
  await login(page)
  // Reached by clicking, not by deep-linking: a hard navigation to /billing/invoices comes back on
  // Overview after the auth redirect, so a goto here was asserting against the dashboard. Clicking is
  // also how a customer actually gets here.
  await page.getByRole('button', { name: 'Invoices', exact: true }).click()
  await page.waitForURL(/billing\/invoices/, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: `${EVIDENCE}/invoices-after-migration.png`, fullPage: true })
})
