import { test, expect, type Page, type Locator } from '@playwright/test'

// Stage-3 staging UI regression — CQRS-3 / docs/architecture/http-contract.md#commands-return-no-data (2026-09-23).
//
// The portal hooks stopped reading bodies that docs/architecture/http-contract.md#commands-return-no-data removed (pay/settle → 202, mark-paid/quota/
// debt-ceiling/rename → 204). These walk the screens a customer and an admin actually use, against
// three 1.000 ₫ invoices seeded for beta-user (Tôn Chủ approved): 2026-06 paid by the tenant,
// 2026-07 settled by an admin, 2026-08 marked paid by an admin. Money moves for real (−2.000 ₫).
//
// Rules this file follows (regression-test §Phase 3): wait for REAL content, assert what is DISPLAYED,
// and scope every locator to the row being acted on — a page-wide .first() matched a history row
// once (CQRS-2 U-1). The ~100ms Processing state is never asserted; only the settled end state is.
const PORTAL = process.env.PORTAL_BASE_URL || 'https://portal-titan-staging.openvicloud.com'
const ADMIN = process.env.ADMIN_BASE_URL || 'https://admin-titan-staging.openvicloud.com'
const EVIDENCE = process.env.RESULTS_DIR || 'test-results/evidence'
const need = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} is not set — inject it at run time`)
  return v
}

async function login(page: Page, host: string, user: string, password: string) {
  await page.goto(host + '/', { waitUntil: 'domcontentloaded' })
  const signIn = page.getByRole('button', { name: /sign in|log ?in|đăng nhập/i }).first()
  if (await signIn.isVisible().catch(() => false)) await signIn.click().catch(() => {})
  const username = page.locator('#username, input[name="username"]').first()
  await username.waitFor({ state: 'visible', timeout: 45_000 })
  await username.fill(user)
  await page.locator('#password, input[name="password"]').first().fill(password)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()
  await page.waitForURL(new RegExp(new URL(host).host.replace(/\./g, '\\.')), { timeout: 45_000 })
  await page.getByRole('navigation').or(page.getByRole('heading').first()).first()
    .waitFor({ state: 'visible', timeout: 45_000 })
}

// Reach a screen through the menu item a person clicks; a deep link can fail on SPA routing and that
// failure reads exactly like the page being broken. The tenant sidebar renders its items as buttons,
// the admin sidebar as links (measured on the first run) — accept either.
async function navTo(page: Page, name: RegExp) {
  const link = page.getByRole('link', { name }).or(page.getByRole('button', { name })).first()
  await link.waitFor({ state: 'visible', timeout: 30_000 })
  await link.click()
}

// By <tr>, not by role: a clickable invoice row is exposed as role=link (measured), so
// getByRole('row') finds nothing and reads exactly like the seeded invoices being missing.
const row = (page: Page, ...texts: (string | RegExp)[]): Locator => {
  let r = page.locator('tr')
  for (const t of texts) r = r.filter({ hasText: t })
  return r
}

test.describe.configure({ mode: 'serial' })

test('U-1 tenant pays an invoice from the wallet: accepted, then settled', async ({ page }) => {
  await login(page, PORTAL, 'beta-user', need('BETA_USER_PASSWORD'))
  await navTo(page, /^invoices$/i)
  const jun = row(page, 'Jun 2026')
  await expect(jun).toHaveCount(1)                         // real content: the seeded period is on screen
  await expect(jun).toContainText('1.000')
  await jun.getByRole('button', { name: /pay from wallet/i }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /^Pay 1,000/ }).click()
  await expect(dialog.getByText('Payment accepted — processing.')).toBeVisible()
  await page.screenshot({ path: `${EVIDENCE}/u1-tenant-pay-accepted-pass.png` })
  await dialog.getByRole('button', { name: 'Done' }).click()

  // End state, not the transient one: the list polls and the row turns Settled once the consumer applies.
  await expect(jun).toContainText(/Settled/, { timeout: 60_000 })
  await expect(jun.getByRole('button', { name: /pay from wallet/i })).toHaveCount(0)
  await page.screenshot({ path: `${EVIDENCE}/u1-tenant-pay-settled-pass.png` })
})

test('U-2/U-3 admin settles one invoice from the wallet and marks another paid', async ({ page }) => {
  await login(page, ADMIN, 'admin-test', need('ADMIN_TEST_PASSWORD'))
  await navTo(page, /^invoices$/i)

  const jul = row(page, 'beta-user', '2026-07')
  await expect(jul).toHaveCount(1)
  await jul.getByRole('button', { name: 'Settle from wallet' }).click()
  await expect(page.getByText('Invoice settled from the tenant wallet')).toBeVisible()
  await expect(jul.getByRole('button', { name: 'Settle from wallet' })).toBeDisabled({ timeout: 60_000 })
  await page.screenshot({ path: `${EVIDENCE}/u2-admin-settle-pass.png` })

  const aug = row(page, 'beta-user', '2026-08')
  await expect(aug).toHaveCount(1)
  await aug.getByRole('button', { name: 'Mark paid' }).click()
  await expect(page.getByText('Invoice marked paid')).toBeVisible()
  await expect(aug).toContainText(/Paid/, { timeout: 30_000 })
  await page.screenshot({ path: `${EVIDENCE}/u3-admin-mark-paid-pass.png` })
})

test('U-4/U-5 admin saves quota and debt ceiling (204) and the list still reads them', async ({ page }) => {
  await login(page, ADMIN, 'admin-test', need('ADMIN_TEST_PASSWORD'))
  await navTo(page, /^tenants$/i)
  const beta = row(page, 'beta-user')
  await expect(beta).toHaveCount(1)

  await beta.getByRole('button', { name: 'Edit quota' }).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Max VMs')).toHaveValue('10')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Quota updated')).toBeVisible()
  await expect(beta).toContainText('10')
  await page.screenshot({ path: `${EVIDENCE}/u4-admin-quota-pass.png` })

  await beta.getByRole('button', { name: 'Debt ceiling' }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Ceiling (VND)')).toHaveValue('500000')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Debt ceiling updated')).toBeVisible()
  await expect(beta).toContainText('500.000')
  await page.screenshot({ path: `${EVIDENCE}/u5-admin-debt-ceiling-pass.png` })
})

test('U-6 tenant renames a network (204) and the list shows it; then renames it back', async ({ page }) => {
  await login(page, PORTAL, 'beta-user', need('BETA_USER_PASSWORD'))
  await navTo(page, /^networks$/i)

  for (const [from, to, shot] of [['paytest-net', 'paytest-net-r3', 'u6-network-rename-pass'], ['paytest-net-r3', 'paytest-net', null]] as const) {
    // beta-user holds exactly one network (cap 1/1, measured), so its row is the only candidate.
    const r = row(page, from)
    await expect(r.first()).toBeVisible()
    await r.first().getByRole('button', { name: 'Rename' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name').fill(to)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Network renamed').first()).toBeVisible()
    await expect(page.getByRole('cell', { name: to, exact: true })).toBeVisible({ timeout: 30_000 })
    if (shot) await page.screenshot({ path: `${EVIDENCE}/${shot}.png` })
  }
})

test('U-7 wallet shows the balance after both payments, with Spend lines', async ({ page }) => {
  await login(page, PORTAL, 'beta-user', need('BETA_USER_PASSWORD'))
  await navTo(page, /^wallet$/i)
  await expect(page.getByText(need('EXPECT_BETA_BALANCE_DISPLAY')).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Spend/).first()).toBeVisible()
  await page.screenshot({ path: `${EVIDENCE}/u7-wallet-balance-pass.png` })
})
