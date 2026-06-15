// @ts-check
// Authenticated smoke tour of the user-facing app, with API call monitoring.
// Inherits storage state from `setup-frontend`. Each test:
//   - navigates to a route
//   - asserts the authenticated shell rendered
//   - records every backend API call made (attached to the report)
//   - fails if any backend API call returned 5xx or never came back
import { test, expect } from '../../fixtures/api-monitor.js'

test.describe('frontend shell (authenticated)', () => {
  test('/ redirects away from /', async ({ page }) => {
    await page.goto('/')
    await page.waitForURL(
      (url) => url.pathname !== '/' && !url.pathname.startsWith('/dev-auth'),
      { timeout: 20_000 }
    )
  })

  // Each route below is checked for "mounts without render-crash" rather than
  // "URL ends exactly at this path" — the app may redirect users without
  // permission to that feature elsewhere (e.g. /adstudio → /autopilot). The
  // sidebar visibility check proves we're still on an authenticated shell.
  // The apiCalls fixture watches the backend; 5xx fails the test.
  const routes = [
    '/adstudio',
    '/adinsights',
    '/ad-library',
    '/brandiq',
    '/adfactory',
    '/ads-manager',
    '/meta-ads',
    '/autopilot',
    '/assistant',
    '/profile',
  ]

  for (const path of routes) {
    test(`${path} loads + API healthy`, async ({ page, apiCalls }) => {
      await page.goto(path, { waitUntil: 'load' })

      // Authenticated shell rendered.
      await expect(
        page.getByRole('link', { name: /ad studio/i })
      ).toBeVisible({ timeout: 15_000 })

      // Give in-flight XHRs a beat to finish so the monitor sees the full
      // burst that this page triggers on mount.
      await page.waitForTimeout(2_000)

      // Page didn't drop us back to /dev-auth and didn't render-crash.
      await expect(page).not.toHaveURL(/\/dev-auth/)
      await expect(page.getByText(/something went wrong/i)).toHaveCount(0)

      // Surface a per-route summary in the test output (also attached as JSON).
      const s = apiCalls.summary()
      console.log(
        `[${path}] api: total=${s.total} 2xx=${s['2xx']} 3xx=${s['3xx']} ` +
        `4xx=${s['4xx']} 5xx=${s['5xx']} fail=${s.fail}`
      )
      // The fixture will throw on 5xx/fail after the test body — this assert
      // gives a friendlier message in the spec itself.
      expect(apiCalls.errors(), 'no 5xx or failed API requests').toEqual([])
    })
  }
})

test.describe('frontend auth gate', () => {
  test('unauthenticated visit does not render the authenticated shell', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto('/adstudio', { waitUntil: 'load' })
    await expect(
      page.getByRole('link', { name: /ad studio/i })
    ).toBeHidden()
    await ctx.close()
  })
})
