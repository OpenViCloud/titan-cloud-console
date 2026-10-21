import { test, expect, type Page } from '@playwright/test'

// Stage-3 staging API regression — CQRS-2 / docs/architecture/http-contract.md#create-returns-id (2026-09-22).
//
// CQRS-2 folded six ownership helpers into ComputeOwnership and, doing so, fixed a real leak:
// VolumeService answered 403 for a volume belonging to another tenant while the five other helpers
// answered 404. A 403 confirms the resource EXISTS to someone who does not own it — bug class F4.
//
// Why this runs here and not in the unit suite: ComputeOwnershipTests drive the handlers through
// Moq. They prove the handler throws NotFoundException; they are SILENT about what the HTTP layer
// turns that into. Program.cs maps ForbiddenException -> 403 and NotFoundException -> 404, and it is
// the mapped status the customer actually sees. Only a real request over the wire measures that.
//
// It runs as a Playwright spec because the staging Keycloak client has direct access grants
// disabled (POST /token with grant_type=password -> 400 unauthorized_client, measured), so a browser
// login is the only way to hold a real token. The password comes from BETA_USER_PASSWORD.
const USERNAME = process.env.BETA_USER_USERNAME || 'beta-user'
const PASSWORD = process.env.BETA_USER_PASSWORD
const API = process.env.API_BASE_URL || 'https://api-titan-staging.openvicloud.com'

// A volume id that belongs to no one on this environment. A caller must not be able to tell this
// apart from a volume owned by someone else — that indistinguishability IS the fix.
const ABSENT_VOLUME = '00000000-0000-0000-0000-0000000000ff'

async function login(page: Page) {
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

// The SPA keeps the oidc user under a key built from issuer + client id; this is the same lookup
// api.ts does to attach the bearer token.
async function tokenFrom(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)!
      if (!k.startsWith('oidc.user:')) continue
      const v = JSON.parse(sessionStorage.getItem(k) || '{}')
      if (v.access_token) return v.access_token as string
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      if (!k.startsWith('oidc.user:')) continue
      const v = JSON.parse(localStorage.getItem(k) || '{}')
      if (v.access_token) return v.access_token as string
    }
    return ''
  })
  expect(token, 'a bearer token must be readable from the session').not.toEqual('')
  return token
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error('BETA_USER_PASSWORD is not set — inject from the k8s secret.')
})

test('A-1/A-2 a resource the caller does not own answers 404, never 403', async ({ page, request }) => {
  await login(page)
  const token = await tokenFrom(page)
  const headers = { Authorization: `Bearer ${token}` }

  // Positive control FIRST: the token works and the API is answering. Without this, every 404 below
  // could equally be "auth is broken" or "the host is wrong", and the test would pass for the wrong
  // reason — the empty-vs-empty false pass.
  const own = await request.get(`${API}/v1/tenant/volumes`, { headers })
  expect(own.status(), 'GET /volumes with a valid token').toBe(200)

  // A-1 — the leak itself, on the paths VolumeService used to serve. Each of these reached the
  // helper that threw ForbiddenException before the fold.
  for (const [method, path] of [
    ['DELETE', `/v1/tenant/volumes/${ABSENT_VOLUME}`],
    ['POST', `/v1/tenant/volumes/${ABSENT_VOLUME}/detach`],
  ] as const) {
    const res = await request.fetch(`${API}${path}`, { method, headers })
    expect(res.status(), `${method} ${path}`).toBe(404)
    expect(res.status(), `${method} ${path} must not be 403`).not.toBe(403)
    const body = await res.json().catch(() => ({}))
    expect(body.code, `${method} ${path} error code`).toBe('VOLUME_NOT_FOUND')
  }

  // A-2 — the same volume, reached through the snapshot path, must answer identically. Before the
  // fold these two disagreed about the same object: 403 one way, 404 the other.
  const viaVolume = await request.fetch(`${API}/v1/tenant/volumes/${ABSENT_VOLUME}`, {
    method: 'DELETE', headers,
  })
  const viaSnapshot = await request.get(
    `${API}/v1/tenant/volumes/${ABSENT_VOLUME}/snapshots`, { headers })
  expect(viaSnapshot.status(), 'snapshot path').toBe(viaVolume.status())
})
