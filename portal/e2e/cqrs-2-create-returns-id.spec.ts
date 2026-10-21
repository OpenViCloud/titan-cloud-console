import { test, expect, type Page } from '@playwright/test'

// Stage-3 staging UI regression — CQRS-2 / docs/architecture/http-contract.md#create-returns-id (2026-09-22).
//
// What changed: every create endpoint now answers with the identity it just minted and nothing
// else. Two of those creates sit on the money path, and one of them is why this spec exists.
//
// POST /v1/tenant/topups used to hand back the whole TopUp, and WalletPage drew the VietQR straight
// from that response. The QR carries `des=<paymentRef>` — the memo SePay matches an incoming bank
// transfer by. The portal knows the amount (it just typed it) but CANNOT derive paymentRef; the
// server mints it. So after docs/architecture/http-contract.md#create-returns-id the page has to read the top-up back from GET /v1/tenant/topups,
// and there is a beat where it has an id and no memo yet.
//
// Why this cannot be a unit test: the portal's own suite hands itself a stubbed list and checks the
// component branches. It cannot show that the DEPLOYED API answers with just an id, that the list
// endpoint carries paymentRef, or that the two line up for the same top-up. A green unit suite sits
// on top of all three of those failing.
//
// Login is automated; the password comes from BETA_USER_PASSWORD (injected from the k8s secret) —
// never hard-coded, never printed.
const USERNAME = process.env.BETA_USER_USERNAME || 'beta-user'
const PASSWORD = process.env.BETA_USER_PASSWORD

const EVIDENCE = process.env.RESULTS_DIR || 'test-results/evidence'

// Measured from the staging DB immediately before this run (regression-plan §Precondition).
// Stored as 509842 (long VND, docs/architecture/money-and-wallet.md#money-is-long-vnd); the portal renders it grouped with a ₫ suffix — assert the
// way it DISPLAYS, not the way it is stored.
const WALLET_BALANCE = /509,842\s*₫/

// A deliberately odd amount: it is not one of the QUICK_AMOUNTS buttons, so seeing it echoed back
// proves the value travelled through the create and the read-back rather than matching a constant
// that was already on the screen.
const TOPUP_AMOUNT = 137000
const TOPUP_AMOUNT_DISPLAY = /137,000\s*₫/

async function login(page: Page) {
  // 'domcontentloaded' not 'load': the staging edge is intermittently slow on secondary assets,
  // and waiting for every one of them turns a slow CDN into a false failure of the screen.
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const signIn = page.getByRole('button', { name: /sign in|log ?in|đăng nhập/i }).first()
  if (await signIn.isVisible().catch(() => false)) await signIn.click().catch(() => {})

  const username = page.locator('#username, input[name="username"]').first()
  await username.waitFor({ state: 'visible', timeout: 45_000 })
  await username.fill(USERNAME)
  await page.locator('#password, input[name="password"]').first().fill(PASSWORD!)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()
  await page.waitForURL(/portal-titan-staging\.openvicloud\.com/, { timeout: 45_000 })
  await page.getByRole('navigation').or(page.getByRole('heading').first()).first()
    .waitFor({ state: 'visible', timeout: 45_000 })
}

test.beforeAll(() => {
  if (!PASSWORD) {
    throw new Error(
      'BETA_USER_PASSWORD is not set. Inject at run time:\n' +
      "  BETA_USER_PASSWORD=$(kubectl -n titan-auth-staging get secret beta-user-credentials " +
      "-o jsonpath='{.data.password}' | base64 -d) npx playwright test",
    )
  }
})

// U-3 — the wallet page shows REAL content, not just a heading. A page reduced to a stub still
// passes a heading-only assertion; the balance is what proves the data arrived.
test('U-3 wallet shows the real balance', async ({ page }) => {
  await login(page)
  await page.goto('/wallet', { waitUntil: 'domcontentloaded' })

  await expect(page.getByText(WALLET_BALANCE).first()).toBeVisible({ timeout: 45_000 })
  await page.screenshot({ path: `${EVIDENCE}/u3-wallet-balance-pass.png`, fullPage: true })
})

// U-1 — THE gate of this iteration. After docs/architecture/http-contract.md#create-returns-id the create hands back only an id, so everything
// the QR needs has to come from the read-back. If the memo were missing the code would still look
// scannable, and a customer's transfer would arrive with nothing to match it to.
test('U-1 buying credit renders a QR carrying the real payment reference', async ({ page }) => {
  await login(page)
  await page.goto('/wallet', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText(WALLET_BALANCE).first()).toBeVisible({ timeout: 45_000 })

  await page.getByRole('button', { name: /buy credit/i }).first().click()
  await page.getByLabel(/amount/i).fill(String(TOPUP_AMOUNT))
  await page.getByRole('button', { name: /continue/i }).click()

  // Scope to the dialog. The wallet page ALSO lists past top-ups, each carrying its own TITAN-…
  // reference, so a page-wide `.first()` match reads a confirmed top-up from weeks ago and compares
  // it against the QR of the one just created — two different, both-correct values, which reads
  // exactly like the QR pointing at the wrong top-up.
  const dialog = page.getByRole('dialog')
  // Wait for a value that can only exist once the read-back landed — a payment reference. Waiting
  // for "the dialog has some element" would match the loading state just as well.
  const memo = dialog.getByText(/TITAN-[A-Z0-9]+/).first()
  await memo.waitFor({ state: 'visible', timeout: 45_000 })
  const memoText = (await memo.textContent())?.match(/TITAN-[A-Z0-9]+/)?.[0]
  expect(memoText, 'a payment reference must be shown').toBeTruthy()

  // The QR must carry BOTH the amount and that same reference. des= is what SePay matches on, so an
  // empty or mismatched memo is the failure this whole change is about.
  const img = dialog.getByRole('img').first()
  await expect(img).toBeVisible({ timeout: 20_000 })
  const src = await img.getAttribute('src')
  expect(src, 'QR src').toContain(`amount=${TOPUP_AMOUNT}`)
  expect(src, 'QR src carries the minted reference').toContain(`des=${memoText}`)

  // And the amount the customer is told to transfer is the one they typed.
  await expect(dialog.getByText(TOPUP_AMOUNT_DISPLAY).first()).toBeVisible()

  await page.screenshot({ path: `${EVIDENCE}/u1-wallet-qr-pass.png`, fullPage: true })
})

// U-5 — the pages that sit on the sixteen new handlers still render real rows, not just headings.
// This is the cheap breadth check behind the two money-path tests above.
test('U-5 compute pages render through the new handlers', async ({ page }) => {
  await login(page)

  for (const [path, heading] of [
    ['/vms', /virtual machines|vms/i],
    ['/volumes', /volumes/i],
    ['/networks', /networks/i],
  ] as const) {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: heading }).first())
      .toBeVisible({ timeout: 45_000 })
    // The network list is the one with known content on this env (paytest-net), so it is the only
    // one where an empty table would be a finding rather than the expected state.
    if (path === '/networks') {
      await expect(page.getByText(/paytest-net/).first()).toBeVisible({ timeout: 30_000 })
    }
    expect(errors, `console errors on ${path}`).toEqual([])
    await page.screenshot({ path: `${EVIDENCE}/u5-${path.slice(1)}-pass.png`, fullPage: true })
  }
})
