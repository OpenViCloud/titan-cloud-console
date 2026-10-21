import { defineConfig, devices } from '@playwright/test'

// Staging UI regression (US-CR-03 credit → invoice). The login is automated; the beta-user password
// is read from BETA_USER_PASSWORD at runtime (inject from the k8s secret `beta-user-credentials`,
// never hard-code). trace/video are OFF so the credential can never land in an artifact — explicit
// screenshots (taken at safe points; password fields render masked) are the only captures.
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PORTAL_BASE_URL || 'https://portal-titan-staging.openvicloud.com',
    headless: true,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
