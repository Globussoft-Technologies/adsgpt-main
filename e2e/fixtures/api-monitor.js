// @ts-check
// A Playwright test fixture that subscribes to network events and watches
// every request made to the backend API host during a test. After each test:
//   - the full call log is attached to the HTML report as JSON
//   - if any response had status >= 500, the test fails with a summary of
//     the offending calls
//
// Usage:
//   import { test, expect } from '../../fixtures/api-monitor.js'
//   test('something', async ({ page, apiCalls }) => {
//     await page.goto('/somewhere')
//     // apiCalls is auto-collected; you can also inspect it mid-test.
//     expect(apiCalls.errors()).toHaveLength(0)
//   })
import { test as base, expect } from '@playwright/test'

function apiHostFromEnv() {
  const raw = process.env.E2E_API_URL
  if (!raw) throw new Error('E2E_API_URL is not set')
  return new URL(raw).host
}

export const test = base.extend({
  apiCalls: async ({ page }, use, testInfo) => {
    const apiHost = apiHostFromEnv()

    /** @type {Array<{method:string,url:string,status:number,ms:number,from:string}>} */
    const calls = []

    page.on('response', async (response) => {
      let host
      try {
        host = new URL(response.url()).host
      } catch {
        return
      }
      if (host !== apiHost) return
      const req = response.request()
      // request().timing() is only populated after the response is finished.
      let ms = 0
      try {
        const t = req.timing()
        ms = Math.round(t.responseEnd - t.requestStart)
      } catch {}
      calls.push({
        method: req.method(),
        url: new URL(response.url()).pathname + new URL(response.url()).search,
        status: response.status(),
        ms,
        from: page.url(),
      })
    })

    // Failed requests (DNS, refused connection, aborted) don't surface in
    // `response` — capture them too.
    page.on('requestfailed', (req) => {
      let host
      try {
        host = new URL(req.url()).host
      } catch {
        return
      }
      if (host !== apiHost) return
      calls.push({
        method: req.method(),
        url: new URL(req.url()).pathname,
        status: 0,
        ms: 0,
        from: page.url(),
      })
    })

    await use({
      all: () => calls.slice(),
      errors: () => calls.filter((c) => c.status === 0 || c.status >= 500),
      summary: () => {
        const buckets = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, fail: 0 }
        for (const c of calls) {
          if (c.status === 0) buckets.fail++
          else if (c.status < 300) buckets['2xx']++
          else if (c.status < 400) buckets['3xx']++
          else if (c.status < 500) buckets['4xx']++
          else buckets['5xx']++
        }
        return { total: calls.length, ...buckets }
      },
    })

    // Always attach the call log to the run report — useful even when green.
    await testInfo.attach('api-calls.json', {
      body: JSON.stringify({ host: apiHost, calls }, null, 2),
      contentType: 'application/json',
    })

    // Hard-fail if anything 5xx'd or never returned a response.
    const broken = calls.filter((c) => c.status === 0 || c.status >= 500)
    if (broken.length) {
      const lines = broken
        .map((c) => `  ${c.status || 'FAIL'}  ${c.method}  ${c.url}`)
        .join('\n')
      throw new Error(
        `${broken.length} API call(s) returned 5xx / failed during this test:\n${lines}`
      )
    }
  },
})

export { expect }
