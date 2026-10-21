import { test, expect, type Page } from '@playwright/test'

// Stage-3 staging UI regression — docs/architecture/money-and-wallet.md#rate-value-object + docs/architecture/code-structure.md#tenant-typed-edge.
//
// What these prove that the 933 module tests cannot: the numbers on the page came out of the real
// database, through the real Rate/Money value converters, out of the real DTO boundary, after the
// real deploy. A green suite proves the code CAN produce the right number; only this proves it DID.
//
// Login is automated; the password comes from BETA_USER_PASSWORD (injected from the k8s secret
// `beta-user-credentials`) — never hard-coded, never printed. trace/video are off in the config.
const USERNAME = process.env.BETA_USER_USERNAME || 'beta-user'
const PASSWORD = process.env.BETA_USER_PASSWORD

const EVIDENCE = process.env.RESULTS_DIR || 'test-results/evidence'

// ── Oracles, read from the staging database BEFORE the browser opened ─────────
//
// core.wallets.available_amount   = 509841.5070000000
// core.invoices (2026-09)         = 158.4930000000, SettledByWallet
// Σ core.usage_records this month = 239.4870000000  (COMPUTE 107.592 + DISK 131.595 + SNAPSHOT 0.3)
// core.vm_offerings.price_per_hour= s 161.388 · m 311.256 · l 634.05 · xl 1268.1
//
// The portal ROUNDS VND (portal/src/lib/money.ts, English by default), so what a
// customer reads is not the stored value. Asserting the unrounded number is a false FAIL that looks
// exactly like "the migration lost money" — the trap this project has already paid for once.
const EXPECTED_WALLET = /509,842\s*₫/
const EXPECTED_MONTH_TOTAL = /239\s*₫/

// Prices are asserted UNROUNDED because they are read off the API response, not off the page — the
// customer portal never renders an offering price anywhere. This is the read path 16a/16b changed:
// numeric(18,10) column → Rate converter → `.PerUnit` at the DTO boundary → JSON.
const EXPECTED_PRICES: Record<string, number> = {
  s: 161.388,
  m: 311.256,
  l: 634.05,
  xl: 1268.1,
}

const PROBE_NETWORK = 'dddtest-net'

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

  // Landing on the portal origin is NOT being logged in. The OIDC callback arrives as
  // `/?state=…&code=…` and the SPA exchanges it afterwards; navigating during that window gets
  // bounced back to `/`, and the failure reads exactly like "the page has no heading".
  // The settle condition is CONTENT that only exists once the session is established.
  await expect(page.getByText(USERNAME).first()).toBeVisible({ timeout: 45_000 })
}

test.beforeAll(() => {
  if (!PASSWORD) {
    throw new Error(
      'BETA_USER_PASSWORD is not set. Inject at run time:\n' +
        "  BETA_USER_PASSWORD=$(kubectl -n titan-auth-staging get secret beta-user-credentials -o jsonpath='{.data.password}' | base64 -d) npx playwright test ddd-tactical-close",
    )
  }
})

// ── U1 + U2 + U4 — one login, three questions about money ─────────────────────
//
// Collected in one test on purpose: each extra login is an extra chance to fail for a reason that has
// nothing to do with the thing being measured.
test('U1/U2/U4 — overview and billing read real money through Money/Rate [ddd-tactical-close]', async ({ page }) => {
  // Responses are collected SYNCHRONOUSLY. An async handler that awaits r.json() before pushing
  // races the assertions and can leave the list empty while the request plainly happened.
  const offeringResponses: import('@playwright/test').Response[] = []
  const summaryResponses: import('@playwright/test').Response[] = []
  page.on('response', r => {
    if (/\/v1\/vm-offerings(\?|$)/.test(r.url()) && r.status() === 200) offeringResponses.push(r)
    if (/\/v1\/tenant\/billing\/summary(\?|$)/.test(r.url()) && r.status() === 200) summaryResponses.push(r)
  })

  await login(page)

  // U1 — the page shows CONTENT, not just a heading. A page reduced to a stub still passes a
  // heading-only assertion; that is the exact shape of BILL-01, and the reason S-16 exists.
  await expect(page.getByText(USERNAME).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

  // The wait condition is the VALUE, not the card. A KPI card renders while still loading, so
  // "the card exists" matches both loading and empty and cannot tell them apart.
  await expect(page.getByText(EXPECTED_MONTH_TOTAL).first()).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: `${EVIDENCE}/u1-overview-pass.png`, fullPage: true })

  // U4 — the same number on the page that owns it, plus the per-VM breakdown.
  await page.goto('/billing')
  await page.waitForURL(/\/billing/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible()
  await expect(page.getByText('Total this month')).toBeVisible()
  await expect(page.getByText(EXPECTED_MONTH_TOTAL).first()).toBeVisible({ timeout: 30_000 })

  // Nothing on the page is a broken number. `Money` reaching a DTO unconverted, or a converter
  // returning a struct where a decimal was expected, surfaces here as NaN/undefined/[object Object]
  // — and a page full of those still has every heading it is supposed to have.
  const body = (await page.locator('body').innerText()).toLowerCase()
  expect(body).not.toContain('nan')
  expect(body).not.toContain('undefined')
  expect(body).not.toContain('[object')
  await page.screenshot({ path: `${EVIDENCE}/u4-billing-pass.png`, fullPage: true })

  // U4 (contract half) — the summary total the API sent equals the database sum for the same month.
  // Asserted against the response, because the page rounds and rounding hides a small drift.
  expect(summaryResponses.length).toBeGreaterThan(0)
  const summary = await summaryResponses[summaryResponses.length - 1].json()
  expect(Number(summary.totalCost)).toBeCloseTo(239.487, 3)

  // U2 — offering prices, straight off the wire. The portal renders none of them, so the page could
  // not show a wrong one; what CAN go wrong is the read path through the widened column and the Rate
  // converter, and this is where that path is observable.
  await page.goto('/vms')
  await page.waitForURL(/\/vms/, { timeout: 20_000 })
  const createButton = page.getByRole('button', { name: /create (virtual machine|vm)/i }).first()
  if (await createButton.isVisible().catch(() => false)) await createButton.click().catch(() => {})
  await expect.poll(() => offeringResponses.length, { timeout: 30_000 }).toBeGreaterThan(0)

  const offerings = await offeringResponses[offeringResponses.length - 1].json()
  // Both sides non-empty before they are compared: two empty collections compare equal and report
  // success, which is how a read path that returned nothing passes a diff test.
  expect(Array.isArray(offerings)).toBe(true)
  expect(offerings.length).toBe(4)
  for (const [id, expected] of Object.entries(EXPECTED_PRICES)) {
    const row = offerings.find((o: { id: string }) => o.id === id)
    expect(row, `tier ${id} missing from /v1/vm-offerings`).toBeTruthy()
    // Exact, not rounded: the whole point of 16b is that this column now holds ten decimals.
    expect(Number(row.pricePerHour), `tier ${id}`).toBeCloseTo(expected, 10)
  }
  await page.screenshot({ path: `${EVIDENCE}/u2-vm-offerings-pass.png`, fullPage: true })
})

// ── U3 — the wallet balance is a Money now, and the customer must not notice ──
test('U3 — wallet balance survives the Money wiring [ddd-tactical-close]', async ({ page }) => {
  await login(page)
  await page.goto('/wallet')
  await page.waitForURL(/\/wallet/, { timeout: 20_000 })

  await expect(page.getByRole('heading', { name: 'Wallet', exact: true })).toBeVisible()
  // THE assertion: Wallet.AvailableAmount is the field where a converter mistake steals money
  // silently. The number here is the number the wallet held before the deploy.
  await expect(page.getByText(EXPECTED_WALLET).first()).toBeVisible({ timeout: 30_000 })

  const body = (await page.locator('body').innerText()).toLowerCase()
  expect(body).not.toContain('nan')
  expect(body).not.toContain('undefined')
  await page.screenshot({ path: `${EVIDENCE}/u3-wallet-pass.png`, fullPage: true })
})

// ── U6 — the VM list renders the state the API actually returned ─────────────
//
// ⚠️ HONEST SCOPE. Every VM on staging is `Destroyed`, and `VmRepository.ListByTenantAsync` filters
// `Status != Destroyed`, so the list is legitimately EMPTY. The precondition for "rows render with a
// concrete status" is therefore FALSE on this environment, and per the precondition rule that branch
// is INCONCLUSIVE here — not a pass, and not a fail. It is covered by useVms.test.ts (4 → 11 tests,
// on the pure functions the useEffect was replaced with).
//
// What IS measured, and is falsifiable both ways: the page agrees with the API. If the API returns
// rows and the page shows the empty state, this fails; if the API returns nothing and the page shows
// rows, this fails too.
test('U6 — VM list agrees with the API it read [ddd-tactical-close]', async ({ page }) => {
  const vmResponses: import('@playwright/test').Response[] = []
  page.on('response', r => {
    if (/\/v1\/tenant\/vms(\?|$)/.test(r.url()) && r.status() === 200) vmResponses.push(r)
  })

  await login(page)
  await page.goto('/vms')
  await page.waitForURL(/\/vms/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Virtual Machines', exact: true })).toBeVisible()

  await expect.poll(() => vmResponses.length, { timeout: 30_000 }).toBeGreaterThan(0)
  const vms = await vmResponses[vmResponses.length - 1].json()
  expect(Array.isArray(vms)).toBe(true)

  if (vms.length === 0) {
    // The empty state, asserted as CONTENT — not as "a table exists".
    await expect(page.getByText('No virtual machines')).toBeVisible({ timeout: 20_000 })
  } else {
    // If staging ever has a live VM again, this branch measures the real thing: every row carries a
    // concrete status, which is what pendingTarget returning undefined would break.
    const table = page.locator('table').first()
    await expect(table.getByText(String(vms[0].name)).first()).toBeVisible({ timeout: 30_000 })
    const statuses = await table.getByText(/Running|Stopped|Starting|Error|Expunging/).count()
    expect(statuses).toBeGreaterThanOrEqual(vms.length)
  }

  const body = (await page.locator('body').innerText()).toLowerCase()
  expect(body).not.toContain('undefined')
  expect(body).not.toContain('nan')
  await page.screenshot({ path: `${EVIDENCE}/u6-vm-list-pass.png`, fullPage: true })
})

// ── U5 — the rename dialog on the SECOND open (the bug US-PORTAL-01 fixed) ────
//
// The bug: an effect reset the field when the dialog opened, so the first render carried the
// PREVIOUS network's name. One network, or one open, cannot see it — the stale value and the correct
// value are the same string. It needs two DIFFERENT renamable networks.
//
// ⚠️ That precondition is IMPOSSIBLE on staging, and the reason is worth writing down: beta-user has
// `max_networks = 1`. Trying to create a second one returns 422 NETWORK_QUOTA_EXCEEDED — correctly.
// The stack trace of that refusal is, incidentally, the only LIVE evidence of docs/architecture/code-structure.md#tenant-typed-edge:
//
//   Tenant.Refuse → Tenant.EnsureCanCreateNetwork(activeNetworkCount)
//                 → Network.Create(Tenant tenant, Int32 activeNetworkCount, …)
//                 → NetworkService.CreateAsync
//
// The quota check now runs INSIDE the factory on the deployed pod. That is what US-DDD-13 set out to
// do, observed on the real system rather than in a test double.
//
// So this test asserts its precondition and reports INCONCLUSIVE when it cannot hold — not PASS.
// A test that quietly passes with one network is measuring nothing.
test('U5 — rename dialog shows the right name on the second open [ddd-tactical-close]', async ({ page }) => {
  await login(page)
  await page.goto('/networks')
  await page.waitForURL(/\/networks/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Networks', exact: true })).toBeVisible()

  const table = page.locator('table').first()
  await expect(table.getByText('paytest-net').first()).toBeVisible({ timeout: 30_000 })

  // Precondition, measured in THIS run: two rows whose Rename button is enabled.
  const rows = await table.locator('tbody tr').count()
  const renamable: number[] = []
  for (let i = 0; i < rows; i++) {
    const btn = table.locator('tbody tr').nth(i).getByRole('button', { name: 'Rename' })
    if ((await btn.count()) > 0 && (await btn.isEnabled().catch(() => false))) renamable.push(i)
  }

  if (renamable.length < 2) {
    test.skip(
      true,
      `INCONCLUSIVE: only ${renamable.length} renamable network(s). beta-user has max_networks = 1, ` +
        'so a second one cannot be created (422 NETWORK_QUOTA_EXCEEDED, correctly). The second-open ' +
        'regression is covered by NetworkListPage.test.tsx, which is mutation-verified against the ' +
        'reinstated useEffect.',
    )
    return
  }

  const nameOf = async (row: number) =>
    (await table.locator('tbody tr').nth(row).locator('td').first().innerText()).trim()

  const openRename = async (row: number) => {
    await table.locator('tbody tr').nth(row).getByRole('button', { name: 'Rename' }).click()
    await expect(page.getByRole('heading', { name: 'Rename network' })).toBeVisible()
    return page.locator('#network-name')
  }

  const [rowA, rowB] = renamable
  const nameA = await nameOf(rowA)
  const nameB = await nameOf(rowB)
  // The two names must differ, or "shows B not A" is unfalsifiable.
  expect(nameA).not.toBe(nameB)

  const fieldA = await openRename(rowA)
  await expect(fieldA).toHaveValue(nameA)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('heading', { name: 'Rename network' })).toBeHidden()

  // THIS is the assertion; on the old code it held nameA.
  const fieldB = await openRename(rowB)
  await expect(fieldB).toHaveValue(nameB)
  await page.screenshot({ path: `${EVIDENCE}/u5-rename-second-open-pass.png`, fullPage: true })
  await page.getByRole('button', { name: 'Cancel' }).click()
})

// ── Cleanup — remove only what this run created ───────────────────────────────
test('cleanup — delete the probe network [ddd-tactical-close]', async ({ page }) => {
  await login(page)
  await page.goto('/networks')
  await page.waitForURL(/\/networks/, { timeout: 20_000 })

  const table = page.locator('table').first()
  await expect(table.getByText('paytest-net').first()).toBeVisible({ timeout: 30_000 })

  const probe = table.locator('tbody tr').filter({ hasText: PROBE_NETWORK })
  if ((await probe.count()) === 0) {
    test.skip(true, `${PROBE_NETWORK} not present — nothing this run created is left behind`)
    return
  }

  await probe.first().getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('heading', { name: new RegExp(`Delete ${PROBE_NETWORK}\\?`) })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm' }).click()

  // Deleting is asynchronous; the row goes Deleting then Deleted. Either is cleaned up as far as the
  // tenant is concerned (the unique index is filtered on status <> 'Deleted').
  await expect(probe.first().getByText(/Deleting|Deleted/)).toBeVisible({ timeout: 45_000 })
  await page.screenshot({ path: `${EVIDENCE}/cleanup-network-deleted.png`, fullPage: true })
})
