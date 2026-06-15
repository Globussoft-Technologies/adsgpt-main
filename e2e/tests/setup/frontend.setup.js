// @ts-check
// Real-login setup: opens the aMember login page, fills credentials, submits,
// and follows the cross-domain redirect into the app. Replaces the earlier
// /dev-auth#t=<JWT> shortcut — slower but exercises the actual auth path.
//
// The login lives on a DIFFERENT host than the app (aMember at
// adsgpt-dev.poweradspy.com → app at adsgpt-staging.poweradspy.com). The
// `access-token` cookie bridges them via the shared parent domain
// (.poweradspy.com).
import { test as setup } from '@playwright/test'

const STATE_PATH = '.auth/frontend.json'

setup('authenticate via aMember login form', async ({ page }) => {
  const loginUrl = process.env.E2E_LOGIN_URL
  const username = process.env.E2E_LOGIN_USERNAME
  const password = process.env.E2E_LOGIN_PASSWORD
  if (!loginUrl || !username || !password) {
    throw new Error(
      'Set E2E_LOGIN_URL, E2E_LOGIN_USERNAME, and E2E_LOGIN_PASSWORD for a ' +
      'sandboxed test user. See e2e/README.md.'
    )
  }

  // 1) Open the aMember login form directly (NOT via app baseURL — this lives
  // on a different host).
  await page.goto(loginUrl, { waitUntil: 'load' })

  // 2) Fill the form. aMember Pro's defaults are name="amember_login" /
  // "amember_pass", but we try label-based selectors first so this still
  // works if the theme renames them.
  const userInput = page.locator(
    'input[name="amember_login"], input[name="login"], input[name="email"], input[type="email"], input[type="text"]'
  ).first()
  await userInput.fill(username)

  const passInput = page.locator(
    'input[name="amember_pass"], input[name="password"], input[type="password"]'
  ).first()
  await passInput.fill(password)

  // 3) Submit. Prefer a real button/input; fall back to pressing Enter.
  const submit = page.locator(
    'button[type="submit"], input[type="submit"], button:has-text("Log In"), button:has-text("Sign in")'
  ).first()
  if (await submit.count()) {
    await submit.click()
  } else {
    await passInput.press('Enter')
  }

  // 4) aMember authenticates and redirects to the app on another host. Wait
  // for the URL to leave the aMember host and land somewhere on the app's
  // origin. We can't rely on a specific path (the user's default landing
  // route varies — /adstudio, /autopilot, etc.).
  const appHost = new URL(process.env.E2E_FRONTEND_URL).host
  await page.waitForURL(
    (url) => url.host === appHost && !url.pathname.startsWith('/dev-auth'),
    { timeout: 45_000 }
  )

  // 5) Confirm the cross-domain cookie actually got written. If aMember
  // accepted creds but the cookie domain is wrong, this catches it cleanly.
  const cookies = await page.context().cookies()
  const access = cookies.find((c) => c.name === 'access-token')
  if (!access) {
    throw new Error(
      'access-token cookie not found after aMember login — check that the ' +
      'cookie domain (.poweradspy.com) matches the app host, and that the ' +
      'test user is active.'
    )
  }

  await page.context().storageState({ path: STATE_PATH })
})
