// @ts-check
// Ad Studio — Ad Copy LLM chat journey.
//
// Sends one short prompt and asserts the streamed response completes
// cleanly. The exchange is over a websocket (`adCopyRequest` →
// `adCopyResponse` chunks), NOT HTTP — the api-monitor fixture cannot see
// it. Verification is therefore UI-state-based:
//   1. Typing indicator disappears (streaming done).
//   2. Action buttons (Copy / Regenerate / Read Aloud) appear (only render
//      once `conversation.complete === true`).
//   3. The "Could not generate ad copy" timeout error is NOT shown.
//   4. The bot message bubble has non-trivial text content.
//
// LLM cost: one prompt per nightly run, ~$0.01 — negligible.
import { test, expect } from '../../../fixtures/api-monitor.js'

// Keep the prompt deliberately small and English (regional-language
// detection would otherwise fire a toast that can occlude the input).
const PROMPT =
  'Write a single short CTA (under 10 words) for a yoga studio Facebook ad.'

test.describe('Ad Studio — Ad Copy', () => {
  // LLM streaming + 60s backend timeout; standard 60s budget isn't enough.
  test.slow()

  test('prompt round-trip: response streams in, no error', async ({ page }) => {
    await page.goto('/adstudio', { waitUntil: 'load' })

    // Authenticated shell rendered.
    await expect(
      page.getByRole('link', { name: /ad studio/i })
    ).toBeVisible({ timeout: 15_000 })

    // Make the Ad Copy tab active. If it's already active the click is a
    // no-op; `.first()` because the header may have more than one match.
    await page.getByRole('button', { name: /^ad copy$/i }).first().click()

    // Defensive reset — clear any stale conversation in this browser context.
    // The "New Chat" button only renders on /adstudio + Ad Copy tab.
    const newChat = page.getByRole('button', { name: /new chat/i })
    if (await newChat.count()) {
      await newChat.first().click()
    }

    // ============================================================
    // SEND PROMPT
    // ============================================================
    const input = page.locator('textarea[placeholder*="Bring your campaign"]')
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill(PROMPT)

    // The send button only renders once `prompt && !isListening` — id is
    // unique to the Ad Copy tab.
    await page.locator('button#tour_copy_prompt_by_mic').click()

    // ============================================================
    // CONFIRM PROMPT WAS SENT
    // ============================================================
    // Once the prompt fires, our text appears as a user bubble. Catching
    // this gives a clean error if the submit selector silently missed.
    const userBubble = page.locator('.flex.justify-end.gap-3').first()
    await expect(
      userBubble,
      'user prompt bubble did not appear — submit click may not have fired'
    ).toBeVisible({ timeout: 10_000 })

    // ============================================================
    // WAIT FOR COMPLETION
    // ============================================================
    // The `.chat_actions_container` div renders inside the bot message ONLY
    // when `conversation.complete === true` (see ChatInterface.jsx:177-204).
    // Those "buttons" are styled <span>s inside ShadcnTooltips, so we can't
    // target by role — the wrapper class is the stable signal.
    await expect(
      page.locator('.chat_actions_container').first()
    ).toBeVisible({ timeout: 75_000 })

    // ============================================================
    // ASSERTIONS
    // ============================================================
    // No timeout error.
    await expect(
      page.getByText(/could not generate ad copy/i)
    ).toHaveCount(0)

    // The typing-indicator dots should be gone now that complete=true.
    await expect(page.locator('.typing-indicator')).toHaveCount(0)

    // Bot message bubble has meaningful text. The first
    // `.flex.justify-start.gap-3` is the bot's response container.
    const botBubble = page.locator('.flex.justify-start.gap-3').first()
    await expect(botBubble).toBeVisible()
    const botText = (await botBubble.textContent()) ?? ''
    expect(
      botText.trim().length,
      `bot response should have non-trivial content, got: "${botText.trim().slice(0, 60)}…"`
    ).toBeGreaterThan(20)
  })
})
