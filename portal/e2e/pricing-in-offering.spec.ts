import { test, expect, type Page, type BrowserContext } from '@playwright/test'

// Stage-3 staging regression for docs/architecture/money-and-wallet.md#price-belongs-to-offering (regression-plan U-1…U-9): price now lives on the offering,
// and the admin edits it on the row that shows the product.
//
// Stage 2 already proved the BACKEND half against the live database (schema, prices, /healthz, the
// old endpoint returning 404). None of that says the screen renders the right number or that Save
// works, which is the only thing this file measures.
const ADMIN_URL = process.env.ADMIN_BASE_URL || 'https://admin-titan-staging.openvicloud.com'
const ADMIN_USER = process.env.ADMIN_TEST_USERNAME || 'admin-test'
const ADMIN_PASSWORD = process.env.ADMIN_TEST_PASSWORD

const EVIDENCE = process.env.RESULTS_DIR || 'test-results/evidence'

// The approved price table (Tôn Chủ 2026-08-09, VND per docs/architecture/money-and-wallet.md#money-is-long-vnd) as the rate renders in
// English, the default language: "." is the decimal separator, "," groups thousands. Written here as constants — the
// oracle must not come from the page being checked.
const APPROVED = {
  s: '161.388',
  m: '311.256',
  l: '634.05',
  xl: '1,268.1',
  volume: '1.57914',
}
const TEMP_PRICE = '400000'
const TEMP_RENDERED = '400,000'

test.beforeAll(() => {
  if (!ADMIN_PASSWORD) {
    throw new Error(
      'Missing ADMIN_TEST_PASSWORD. Inject it from the k8s secret at run time:\n' +
      '  ADMIN_TEST_PASSWORD=$(kubectl -n titan-auth-staging get secret admin-test-credentials ' +
      "-o jsonpath='{.data.password}' | base64 -d) npx playwright test")
  }
})

async function keycloakLogin(page: Page) {
  await page.goto(ADMIN_URL)
  const signIn = page.getByRole('button', { name: /sign in|log ?in|đăng nhập/i }).first()
  if (await signIn.isVisible().catch(() => false)) await signIn.click().catch(() => {})

  const username = page.locator('#username, input[name="username"]').first()
  await username.waitFor({ state: 'visible', timeout: 45_000 })
  await username.fill(ADMIN_USER)
  await page.locator('#password, input[name="password"]').first().fill(ADMIN_PASSWORD!)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()

  // Known trap (known-state): navigating before the SPA finishes booting keeps the URL but renders
  // the index route. Wait for something only the logged-in shell shows.
  await page.getByText(/admin-test|Tenants/i).first().waitFor({ state: 'visible', timeout: 45_000 })
}

async function adminPage(context: BrowserContext) {
  const page = await context.newPage()
  await keycloakLogin(page)
  return page
}

async function openCatalog(page: Page) {
  await page.goto(`${ADMIN_URL}/catalog`)
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible()
}

// ── U-1/U-2/U-3 — the product and its price on one row ─────────────────────

test('U-1/U-2/U-3 — catalog shows every tier beside its price, sub-đồng rates intact', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await adminPage(context)
  await openCatalog(page)

  // U-1 — the section exists at all.
  await expect(page.getByRole('heading', { name: 'Offerings' })).toBeVisible()

  // U-2 — each tier's price sits on the tier's own row. Asserting the RENDERED VALUE, not just the
  // heading: a section stubbed back to a title passes a heading-only check (BILL-01, admin Dashboard).
  for (const [id, price] of Object.entries(APPROVED)) {
    if (id === 'volume') continue
    await expect(page.getByTestId(`vm-offering-price-${id}`), `tier ${id} price`).toContainText(price)
  }
  await expect(page.getByTestId('vm-offering-m')).toContainText('Medium')

  // U-3 — a storage rate is 1.57914 ₫/GB/h. formatMoney rounds VND to whole đồng and would render it
  // as "2 ₫", making every future price change invisible. formatRate must be the one in play.
  const volumeCell = page.getByTestId('volume-offering-price-standard')
  await expect(volumeCell).toContainText(APPROVED.volume)
  await expect(volumeCell).not.toHaveText(/^\s*2\s*₫\s*$/)

  await page.screenshot({ path: `${EVIDENCE}/catalog-offerings-pass.png`, fullPage: true })
  await context.close()
})

// ── U-5/U-9 — the dialog guards and explains before it saves ───────────────

test('U-5/U-9 — dialog rejects a non-positive price in words, and previews the month', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await adminPage(context)
  await openCatalog(page)

  await page.getByRole('button', { name: /edit price for medium/i }).click()
  const input = page.getByLabel(/price \(₫ per hour\)/i)
  await expect(input).toBeVisible()

  // U-9 — admins decide prices in monthly terms; without this the screen asks them to multiply by 720.
  await input.fill('1000')
  await expect(page.getByText(/720,000\s*₫\/month/)).toBeVisible()

  // U-5 — the refusal has to be readable, not just a red border (a11y: never colour alone).
  await input.fill('0')
  await expect(page.getByRole('button', { name: /save price/i })).toBeDisabled()
  await expect(page.getByText(/enter a price greater than 0/i)).toBeVisible()

  await page.screenshot({ path: `${EVIDENCE}/edit-price-dialog-guard-pass.png`, fullPage: true })
  await context.close()
})

// ── U-4/U-6/U-8 — change the price, read the trail, put it back ────────────
//
// Path D (regression-plan): this edits a REAL selling price on staging, then restores the approved
// one. Staging has 0 VMs, so the window carries zero billing impact — and the audit table keeps both
// rows, which is append-only working as designed, not litter.
test('U-4/U-6/U-8 — price change lands without reload, is audited, and is restored', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await adminPage(context)
  await openCatalog(page)

  const priceCell = page.getByTestId('vm-offering-price-m')
  await expect(priceCell, 'precondition: m starts at the approved price').toContainText(APPROVED.m)

  // U-4 — save, and the table must show the new number without a page reload.
  await page.getByRole('button', { name: /edit price for medium/i }).click()
  await page.getByLabel(/price \(₫ per hour\)/i).fill(TEMP_PRICE)
  await page.getByRole('button', { name: /save price/i }).click()

  // Capture the observed state BEFORE asserting on it. A screenshot taken after a passing assertion
  // only ever documents success — the run that most needs a picture is the one that fails, and that
  // one never reaches the line below the assert.
  await page.waitForTimeout(2_000)
  await page.screenshot({ path: `${EVIDENCE}/price-change-attempt.png`, fullPage: true })

  await expect(priceCell).toContainText(TEMP_RENDERED, { timeout: 20_000 })

  // U-6 — the trail has to answer all four halves: who, when, which tier, from what to what. The last
  // two are why docs/architecture/money-and-wallet.md#price-belongs-to-offering widened admin_audit_log instead of writing "someone changed a price".
  await page.goto(`${ADMIN_URL}/audit-log`)
  await page.waitForLoadState('networkidle')
  const auditRow = page.getByRole('row').filter({ hasText: 'pricing.vm_offering.change' }).first()
  await expect(auditRow).toBeVisible({ timeout: 20_000 })
  await expect(auditRow, 'which tier').toContainText('vm_offering · m')
  await expect(auditRow, 'from what to what').toContainText('311.256000 -> 400000')
  // A price applies to every tenant, so there is no owning tenant. Printing the raw value would show
  // an all-zero GUID, which reads as a tenant that does not exist rather than the absence of one.
  await expect(auditRow, 'platform-scope, not a zero GUID').toContainText('Platform')
  await expect(auditRow).not.toContainText('00000000-0000')
  await page.screenshot({ path: `${EVIDENCE}/audit-price-change-pass.png`, fullPage: true })

  // U-8 — put the approved price back. In the same test as U-4 on purpose: a separate test could be
  // skipped or fail to start, leaving staging selling at a number nobody approved.
  await openCatalog(page)
  await page.getByRole('button', { name: /edit price for medium/i }).click()
  await page.getByLabel(/price \(₫ per hour\)/i).fill('311.256')
  await page.getByRole('button', { name: /save price/i }).click()
  await expect(priceCell, 'restored to the approved price').toContainText(APPROVED.m, { timeout: 20_000 })
  await page.screenshot({ path: `${EVIDENCE}/price-restored-pass.png`, fullPage: true })

  await context.close()
})

// ── U-7 — the old pricing page is gone, not hidden ─────────────────────────

test('U-7 — the standalone Pricing page and its nav entry no longer exist', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await adminPage(context)

  // The nav is a list of buttons (known-state trap (b): they are `button`, not `link`).
  const nav = page.locator('nav').first()
  await expect(nav).toBeVisible()
  await expect(nav.getByRole('button', { name: /^pricing$/i })).toHaveCount(0)

  // And the route itself renders nothing resembling the old rule-creation screen.
  await page.goto(`${ADMIN_URL}/pricing`)
  await page.waitForLoadState('networkidle')
  await expect(page.getByText(/create pricing rule/i)).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: /effective from/i })).toHaveCount(0)

  await page.screenshot({ path: `${EVIDENCE}/pricing-route-gone-pass.png`, fullPage: true })
  await context.close()
})
