// @ts-check
// nodejs-backend liveness checks. No browser, no auth — just HTTP. Covers the
// bare minimum: "the gateway is reachable and serving HTTP." Deeper authenticated
// API checks belong in nodejs-backend's smoke-autopilot script (run per-deploy).
import { test, expect } from '@playwright/test'

test.describe('nodejs-backend liveness', () => {
  test('gateway root responds (any non-5xx status)', async ({ request }) => {
    const res = await request.get('/', { failOnStatusCode: false })
    // Routes require JWT, so 401/403 is expected and counts as "alive".
    // What we want to rule out: connection refused, 5xx, HTML 502 from nginx.
    expect(res.status()).toBeLessThan(500)
  })

  test('responds with no crash on a junk path', async ({ request }) => {
    // An unmatched route should produce a clean 4xx (404 / 401), not blow up.
    const res = await request.get('/__definitely_not_a_route__', { failOnStatusCode: false })
    expect(res.status()).toBeLessThan(500)
  })
})
