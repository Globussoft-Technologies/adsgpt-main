// @ts-check
// react-frontend has no login form — auth is delegated to aMember. The
// `/dev-auth#t=<JWT>` route reads the token from the URL fragment and writes
// the `access-token` cookie. We use that path here with a pre-minted test JWT
// stored in E2E_FRONTEND_JWT.
import { test as setup } from '@playwright/test'

const STATE_PATH = '.auth/frontend.json'

setup('authenticate frontend via /dev-auth', async ({ page }) => {
  const jwt = process.env.E2E_FRONTEND_JWT
  if (!jwt) {
    throw new Error(
      'Set E2E_FRONTEND_JWT to a long-lived test-user JWT. ' +
      'Mint one with nodejs-backend\'s system-token tool against the test user.'
    )
  }

  // The fragment (#t=...) is read client-side by DevAuthPage. We have to load
  // /dev-auth with the fragment intact, let it write the cookie, then let it
  // redirect us off /dev-auth.
  await page.goto(`/dev-auth#t=${encodeURIComponent(jwt)}`)

  // DevAuthPage redirects to whatever the user's default route is (varies by
  // permissions/onboarding — e.g. /adstudio, /autopilot). We don't hardcode
  // the destination; we just wait until we're no longer sitting on /dev-auth.
  await page.waitForURL(
    (url) => !url.pathname.startsWith('/dev-auth'),
    { timeout: 20_000 }
  )

  // Confirm the cookie actually got written (cookie name from getCookies.js).
  const cookies = await page.context().cookies()
  const access = cookies.find((c) => c.name === 'access-token')
  if (!access) {
    throw new Error('access-token cookie was not set after /dev-auth — JWT rejected?')
  }

  await page.context().storageState({ path: STATE_PATH })
})
