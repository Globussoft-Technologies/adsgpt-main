// @ts-check
// Real-login setup. Walks the full aMember handshake:
//
//   1. POST credentials to aMember login form.
//   2. aMember authenticates, sets amember_login / amember_pass cookies on
//      .poweradspy.com, redirects to the app host.
//   3. React app loads. RunBackLog reads those aMember cookies, POSTs them
//      to /adsgpt/check-access/by-login-pass, receives a JWT, sets the
//      `access-token` cookie client-side.
//   4. AuthWrapper sees socket userData populate; sidebar renders.
//
// Because step 3 is CLIENT-SIDE and async, we cannot assert on the cookie
// the moment the URL flips to the app host — the handshake hasn't run yet.
// The reliable "auth completed" signal is the authenticated sidebar being
// visible. We assert on that, then verify the cookie as a sanity check.
import fs from 'node:fs'
import { test as setup } from '@playwright/test'

const STATE_PATH = '.auth/frontend.json'

setup('authenticate via aMember login form', async ({ page }) => {
  // Short-circuit if a valid session was already produced (e.g. by an upstream
  // CI job that uploaded .auth/ as an artifact). Saves us from re-logging-in
  // in every downstream job of a split workflow.
  if (fs.existsSync(STATE_PATH)) {
    setup.info().annotations.push({
      type: 'auth',
      description: `Reusing existing storage state at ${STATE_PATH}`,
    })
    return
  }

  const loginUrl = process.env.E2E_LOGIN_URL
  const username = process.env.E2E_LOGIN_USERNAME
  const password = process.env.E2E_LOGIN_PASSWORD
  if (!loginUrl || !username || !password) {
    throw new Error(
      'Set E2E_LOGIN_URL, E2E_LOGIN_USERNAME, and E2E_LOGIN_PASSWORD for a ' +
      'sandboxed test user. See e2e/README.md.'
    )
  }

  // ---- 1. Open the aMember login form ----
  await page.goto(loginUrl, { waitUntil: 'load' })

  // Wait for the form to actually be in the DOM before trying to fill.
  // aMember Pro's defaults are name="amember_login" / "amember_pass"; we keep
  // label/type fallbacks so a themed install still works.
  const userInput = page.locator(
    'input[name="amember_login"], input[name="login"], input[name="email"], input[type="email"]:visible, input[type="text"]:visible'
  ).first()
  await userInput.waitFor({ state: 'visible', timeout: 15_000 })

  const passInput = page.locator(
    'input[name="amember_pass"], input[name="password"], input[type="password"]'
  ).first()
  await passInput.waitFor({ state: 'visible', timeout: 15_000 })

  // ---- 2. Fill creds + submit ----
  await userInput.fill(username)
  await passInput.fill(password)

  const submit = page.locator(
    'button[type="submit"], input[type="submit"], form button:has-text("Log In"), form button:has-text("Sign in")'
  ).first()
  if (await submit.count()) {
    await submit.click()
  } else {
    await passInput.press('Enter')
  }

  // ---- 3. Wait for landing on the app host ----
  // playwright.config.js validates E2E_FRONTEND_URL is set before any test
  // runs, so this is guaranteed defined by the time we get here — the cast
  // is just to satisfy the type checker.
  const appHost = new URL(/** @type {string} */ (process.env.E2E_FRONTEND_URL)).host
  await page.waitForURL((url) => url.host === appHost, { timeout: 45_000 })

  // ---- 4. Wait for the React handshake to finish ----
  // The sidebar's "Ad Studio" link only renders once Redux state.socket.userData
  // is populated, which only happens after the access-token handshake succeeds.
  // This is our real "auth completed" gate.
  try {
    await page.getByRole('link', { name: /ad studio/i })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
  } catch (err) {
    // Dump diagnostic info before bailing so the run log tells us why.
    const cookies = await page.context().cookies()
    const cookieNames = cookies.map((c) => `${c.name}@${c.domain}`).sort()
    console.log('--- auth-failure diagnostics ---')
    console.log('final URL:', page.url())
    console.log('cookies:', cookieNames.join(', ') || '(none)')
    throw new Error(
      'Authenticated sidebar never appeared. The aMember login likely did ' +
      'not succeed — check the test user is active and the form selectors ' +
      'targeted the real input fields. Cookies present: ' +
      (cookieNames.join(', ') || '(none)') +
      '. Final URL: ' + page.url()
    )
  }

  // ---- 5. Sanity-check the cookie ----
  const cookies = await page.context().cookies()
  const access = cookies.find((c) => c.name === 'access-token')
  if (!access) {
    const cookieNames = cookies.map((c) => `${c.name}@${c.domain}`).sort()
    throw new Error(
      'Sidebar rendered but access-token cookie is missing — should be ' +
      'impossible. Cookies present: ' + (cookieNames.join(', ') || '(none)')
    )
  }

  await page.context().storageState({ path: STATE_PATH })
})
