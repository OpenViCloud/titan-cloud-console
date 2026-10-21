import { test, expect, type Page } from '@playwright/test'

// Stage-3 staging UI regression — docs/architecture/money-and-wallet.md#single-writer-outbox S5+S6.
//
// S5 moved the wallet DEBIT out of the request and into the single-writer consumer, and changed
// POST /v1/tenant/billing/invoices/{id}/pay from 200 to 202. S6 added the sweeper that makes a
// non-persistent bus safe.
//
// The story is backend-only — no portal file changed. That is PRECISELY why this runs: "the customer's
// screen is unaffected" is a claim about a screen nobody has looked at since the contract underneath it
// changed. The portal's unit tests answer with MSW mocks, which will happily keep returning 200 forever.
//
// Login is automated; the password comes from BETA_USER_PASSWORD (injected from the k8s secret
// `beta-user-credentials`) — never hard-coded, never printed.
const USERNAME = process.env.BETA_USER_USERNAME || 'beta-user'
const PASSWORD = process.env.BETA_USER_PASSWORD

const EVIDENCE = process.env.RESULTS_DIR || 'test-results/evidence'

// Oracles read from the staging database BEFORE this run (regression-plan D-1..D-4):
//   available_amount = 509842, 3 ledger rows, SUM(amount) == balance, 0 outstanding commands.
//
// The portal ROUNDS VND, so what a customer reads is not the stored value verbatim — the lesson
// wallet-single-balance paid for with a false FAIL that looked like "the migration lost money".
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
        "  BETA_USER_PASSWORD=$(kubectl -n titan-auth-staging get secret beta-user-credentials -o jsonpath='{.data.password}' | base64 -d) npx playwright test wallet-debit-async-sweeper",
    )
  }
})

// U-1 + U-2 — the money is untouched by a slice that rewrote how money is written.
//
// S5 replaced the code path that debits a wallet. If it had got the ledger wrong, the balance on this
// page is where a customer would see it first. Asserted on the PAGE, not an API response, because the
// page is what the customer reads.
test('wallet: balance and statement unchanged after the debit path moved [U-1, U-2]', async ({ page }) => {
  await login(page)
  await expect(page.getByText('beta-user')).toBeVisible({ timeout: 30_000 })

  await page.goto('/wallet')
  await page.waitForURL(/\/wallet/, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('heading', { name: 'Wallet', exact: true })).toBeVisible()

  // U-1 — the number, matched as DISPLAYED. Waiting on real content, not on "a row exists": an empty
  // table renders rows too, so "first row present" passes while the page is still loading or empty.
  await expect(page.getByText(EXPECTED_BALANCE).first()).toBeVisible({ timeout: 20_000 })

  // U-2 — both directions still on the statement. Money-in-only, with the spend silently missing, is
  // the failure shape a rewritten ledger path can produce while still looking like a working page.
  const statement = page.locator('table').filter({ hasText: /TopUp|Promo|Spend/ }).first()
  await expect(statement).toBeVisible()
  await expect(statement.getByText(/Top-?up/i).first()).toBeVisible()
  await expect(statement.getByText('Spend').first()).toBeVisible()
  await expect(statement.getByText(EXPECTED_SPEND).first()).toBeVisible()

  await page.screenshot({ path: `${EVIDENCE}/wallet-after-s5-s6-pass.png`, fullPage: true })
})

// U-3 + U-4 — the invoices page, and what the new contract actually puts on the wire.
//
// U-4 is a DELIBERATE OBSERVATION, not a pass/fail of this slice. The portal has not been taught about
// 202 yet (S7), and Tôn Chủ accepted that when the cut was chosen. The point of looking is to record
// what S7 must fix, with evidence, instead of discovering it during S7.
test('invoices: page renders, and the new paymentState field is on the wire [U-3, U-4]', async ({ page }) => {
  // Collected SYNCHRONOUSLY. An async handler that awaits r.json() before pushing races the assertions
  // and can leave the list empty while the request plainly happened.
  const invoiceResponses: import('@playwright/test').Response[] = []
  page.on('response', r => {
    if (/\/v1\/tenant\/billing\/invoices(\?|$)/.test(r.url()) && r.status() === 200) invoiceResponses.push(r)
  })

  await login(page)

  // Reached by CLICKING, the way a customer gets here. A hard navigation to /billing/invoices lands
  // back on Overview after the auth redirect, which would assert against the dashboard instead.
  await page.getByRole('button', { name: 'Invoices', exact: true }).click()
  await page.waitForURL(/billing\/invoices/, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')

  // U-3 — the page still renders after the DTO grew a field. A serialization error here would be a
  // blank page or a 500, and no unit test watches the deployed build's JSON.
  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible({ timeout: 20_000 })

  await page.screenshot({ path: `${EVIDENCE}/invoices-after-s5-s6-pass.png`, fullPage: true })

  // U-4 — read the CONTRACT off the wire, not off the source tree: the deployed image is the thing
  // under test, and a stale one would still be serving the old shape.
  expect(invoiceResponses.length).toBeGreaterThan(0)   // non-empty guard: no capture makes this vacuous
  const body = (await invoiceResponses[invoiceResponses.length - 1].json()) as unknown

  const rows = Array.isArray(body) ? body : []
  // An empty invoice list is a legitimate state for this tenant, and it is NOT a failure — but it does
  // mean this assertion proved nothing, so say which of the two happened rather than passing quietly.
  if (rows.length === 0) {
    test.info().annotations.push({
      type: 'observation',
      description: 'U-4: tenant has no invoices on staging, so the paymentState field could not be observed on the wire. Not a failure — an unmeasured case.',
    })
    return
  }

  // The field exists on the deployed contract (null is a perfectly good value: it means nobody has
  // pressed pay on that invoice). What matters is that the KEY is served, because that is what S7 will
  // read to show a pending state.
  const first = rows[0] as Record<string, unknown>
  expect(Object.keys(first)).toContain('paymentState')
  test.info().annotations.push({
    type: 'observation',
    description: `U-4: paymentState served on the wire = ${JSON.stringify(first.paymentState)} (null means nobody has paid this invoice yet).`,
  })
})
