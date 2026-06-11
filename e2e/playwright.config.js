// @ts-check
import { defineConfig, devices } from '@playwright/test'

// Hard-fail at config-load if a required URL is missing — we never want the
// suite to silently fall back to localhost when running in CI.
function requireEnv(name) {
  const v = process.env[name]
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. ` +
      `See e2e/README.md for the full list of E2E_* variables.`
    )
  }
  return v
}

const FRONTEND_URL = requireEnv('E2E_FRONTEND_URL')
const API_URL = requireEnv('E2E_API_URL')

export default defineConfig({
  testDir: './tests',
  // Total per-test budget. Login flows can be slow on a cold dev server.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,

  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github'], ['list']]
    : [['html'], ['list']],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // ---- setup project: log in once, persist storage state ----
    {
      name: 'setup-frontend',
      testDir: './tests/setup',
      testMatch: /frontend\.setup\.js$/,
      use: { baseURL: FRONTEND_URL },
    },

    // ---- test projects ----
    {
      name: 'frontend',
      dependencies: ['setup-frontend'],
      testDir: './tests/frontend',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: FRONTEND_URL,
        storageState: '.auth/frontend.json',
      },
    },
    {
      // API project — no browser, no storage state, just request fixture.
      name: 'api',
      testDir: './tests/api',
      use: { baseURL: API_URL },
    },
  ],
})
