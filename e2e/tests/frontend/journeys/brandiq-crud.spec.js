// @ts-check
// BrandIQ CRUD journey.
//
// Creates a uniquely-named brand, asserts it appears in the grid, updates
// its description, asserts the update is visible, then deletes it and
// asserts the card is gone. The full backend round-trip is monitored by
// the api-monitor fixture — any 5xx during the journey fails the test.
//
// Each run uses a name like `e2e-test-<runId>` so leftover data from a
// failed mid-flow run is easy to identify and manually purge.
import path from 'node:path'
import { test, expect } from '../../../fixtures/api-monitor.js'

// Resolved at run time relative to the e2e/ directory (npm test's cwd).
const LOGO_PATH = path.resolve(process.cwd(), 'fixtures/assets/test-logo.png')

const RUN_ID = process.env.GITHUB_RUN_ID || `local-${Date.now()}`
const BRAND_NAME = `e2e-test-${RUN_ID}`
const INITIAL_DESC = `Created by E2E nightly run ${RUN_ID}. Test data — safe to delete.`
const UPDATED_DESC = `Updated by E2E nightly run ${RUN_ID}. Test data — safe to delete.`

test.describe('BrandIQ CRUD', () => {
  // File upload + 3-step modal + grid re-render + delete confirmation chain
  // can take longer than the default 60s test budget on a cold dev server.
  test.slow()

  test('create → read → update → delete a brand', async ({ page, apiCalls }) => {
    await page.goto('/brandiq', { waitUntil: 'load' })

    // Sidebar = authenticated shell is rendered.
    await expect(
      page.getByRole('link', { name: /ad studio/i })
    ).toBeVisible({ timeout: 15_000 })

    // ========================================================
    // CREATE
    // ========================================================
    // The "Add Brand" button appears in both the empty-state and populated
    // grid views; `.first()` picks whichever is on screen.
    await page.getByRole('button', { name: /add brand/i }).first().click()

    // Step 0 — skip the optional website-analysis branch.
    await page.getByRole('button', { name: /manual setup/i }).click()

    // Step 1 — brand identity.
    await page.getByPlaceholder('Brand name').fill(BRAND_NAME)
    await page.getByPlaceholder(/describe your brand/i).fill(INITIAL_DESC)

    // Logo upload. The styled drop-zone hides an <input type="file">; first
    // file input in the modal is the logo input (product image follows).
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(LOGO_PATH)

    // Advance to Step 2.
    await page.getByRole('button', { name: /^next$|continue/i }).click()

    // Step 2 — digital presence; only website URL is required.
    await page.getByPlaceholder('https://example.com').fill('https://example.com')

    // Submit — Step-2's primary action on create is labelled "Add Brand".
    // Use `.last()` to pick the modal's submit, not the original opener.
    await page.getByRole('button', { name: /add brand/i }).last().click()

    // Locate the new card. Multiple cards share `id="tour_brand_individual_card"`
    // (id reused as a tour anchor, not unique), so filter by the unique name.
    const card = page
      .locator('#tour_brand_individual_card')
      .filter({ hasText: BRAND_NAME })

    await expect(card).toBeVisible({ timeout: 20_000 })

    // ========================================================
    // READ
    // ========================================================
    // Description on the card is truncated to ~150 chars; assert a prefix.
    await expect(card).toContainText(INITIAL_DESC.slice(0, 40))

    // ========================================================
    // UPDATE
    // ========================================================
    await card.locator('#tour_edit_brand').click()

    // The edit modal opens on Step 1 and asynchronously pulls the existing
    // brand's logo + product images to pre-populate the file fields. While
    // those are in-flight, "Loading brand images..." / "Loading product
    // images..." spinners show and the Next button stays disabled. Wait for
    // BOTH to finish before doing anything else.
    await expect(page.getByText(/loading brand images/i))
      .toBeHidden({ timeout: 30_000 })
    await expect(page.getByText(/loading product images/i))
      .toBeHidden({ timeout: 30_000 })

    // Re-attach a logo file so Form state has a real File object regardless
    // of whether the loaded-from-URL pre-fill produced one.
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(LOGO_PATH)

    // Change the description on Step 1.
    const descField = page.getByPlaceholder(/describe your brand/i)
    await descField.fill(UPDATED_DESC)

    // Advance to Step 2 — explicitly wait for Next to be enabled first, so
    // we don't race the form's debounced validation.
    const nextBtn = page.getByRole('button', { name: /^next$|continue/i })
    await expect(nextBtn).toBeEnabled({ timeout: 10_000 })
    await nextBtn.click()

    // Step-2 primary on edit is "Save" (not "Add Brand").
    await page.getByRole('button', { name: /^save$|^update$/i }).click()

    // Card should now show the updated description.
    await expect(card).toContainText(UPDATED_DESC.slice(0, 40), {
      timeout: 15_000,
    })

    // ========================================================
    // DELETE
    // ========================================================
    await card.locator('#tour_delete_brand').click()

    // Confirmation dialog — the red "Delete" button. `.last()` because the
    // card itself also has a (now-hidden) delete icon called "Delete".
    await page.getByRole('button', { name: /^delete$/i }).last().click()

    // Card must be gone from the grid.
    await expect(card).toHaveCount(0, { timeout: 15_000 })

    // Per-test API call summary (full log already attached as JSON).
    const s = apiCalls.summary()
    console.log(
      `[brandiq-crud] api: total=${s.total} 2xx=${s['2xx']} 3xx=${s['3xx']} ` +
      `4xx=${s['4xx']} 5xx=${s['5xx']} fail=${s.fail}`
    )
    // api-monitor fails the test automatically on any 5xx/network fail.
  })
})
