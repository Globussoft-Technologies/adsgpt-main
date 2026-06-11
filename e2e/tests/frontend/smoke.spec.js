// @ts-check
// Authenticated smoke tour of the user-facing app. Inherits storage state from
// `setup-frontend`.
import { test, expect } from '@playwright/test'

test.describe('frontend shell (authenticated)', () => {
  test('/ redirects away from /', async ({ page }) => {
    // The default landing route varies per user (e.g. /adstudio vs /autopilot).
    // We only care that the app *does* redirect — not where to.
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
    test(`${path} loads`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'load' })
      // Authenticated shell rendered: the sidebar is the app-wide nav and is
      // only present once auth resolves. Far more reliable than networkidle,
      // which never settles on pages with long-polling / sockets.
      await expect(
        page.getByRole('link', { name: /ad studio/i })
      ).toBeVisible({ timeout: 15_000 })
      // Still on an authenticated route and the page did not render-crash.
      await expect(page).not.toHaveURL(/\/dev-auth/)
      await expect(page.getByText(/something went wrong/i)).toHaveCount(0)
    })
  }
})

test.describe('frontend auth gate', () => {
  test('unauthenticated visit does not render the authenticated shell', async ({ browser }) => {
    // Fresh context — no cookies, no storage.
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto('/adstudio', { waitUntil: 'load' })
    // We don't care whether the app redirects to aMember, stays put, or shows
    // a loading spinner — what matters is that the authenticated nav (the
    // sidebar "Ad Studio" link) does NOT render for an unauthenticated user.
    // Allow up to expect.timeout for any client-side auth check to complete.
    await expect(
      page.getByRole('link', { name: /ad studio/i })
    ).toBeHidden()
    await ctx.close()
  })
})
