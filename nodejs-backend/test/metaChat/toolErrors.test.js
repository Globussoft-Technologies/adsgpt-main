/**
 * Failure reasons reaching the UI.
 *
 * A failed tool call used to be sent to the browser as `{ name }` only —
 * identical to a successful one. Observed 2026-09-15: the model retried a
 * failing ads_create_ad_set four times and the user saw four indistinguishable
 * "Worked for Ns" pills, with no way to tell that anything had failed or why it
 * kept trying.
 *
 * Neither MCP server throws on failure, and the three shapes below are all real
 * payloads captured from live calls.
 */
const assert = require("assert");
const { toolErrorSummary } = require("../../services/metaChat/toolErrors");

// ── official: a JSON envelope inside a text block ───────────────────────────
{
  const internal = toolErrorSummary({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error_category: "INTERNAL",
          error_message: "An internal error occurred. Please try again later.",
          error_code: null,
          error_subcode: null,
          is_retryable: true,
        }),
      },
    ],
  });
  assert.ok(internal, "an official failure must produce a reason");
  assert.ok(/INTERNAL/.test(internal), "the category is worth showing — it is all we get here");
  assert.ok(/internal error occurred/i.test(internal));

  const validation = toolErrorSummary({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error_category: "VALIDATION",
          error_message:
            "Optimization for Ad Delivery Selections Must Be the Same: The same optimization for ad delivery selection is required if the campaign bid strategy is lowest cost.",
        }),
      },
    ],
  });
  assert.ok(/VALIDATION/.test(validation));
  assert.ok(/Optimization for Ad Delivery/.test(validation));
}

// ── bridge-injected, when the call threw outright ───────────────────────────
{
  const thrown = toolErrorSummary({
    error: "MCP error -32602: Invalid parameter (subcode: 1815857) — Bid amount required",
  });
  assert.ok(/1815857/.test(thrown), "the subcode is the most useful part — keep it");
}

// ── fork: a human sentence ──────────────────────────────────────────────────
{
  assert.ok(
    /Bid amount required/.test(
      toolErrorSummary({
        content: [{ type: "text", text: "Error: Bid amount required for bid strategy provided" }],
      }),
    ),
  );
  for (const prose of ["Failed to create ad set.", "Could not find that campaign.", "Unable to reach Meta."]) {
    assert.ok(toolErrorSummary({ content: [{ type: "text", text: prose }] }), prose);
  }
}

// ── successes must stay silent ──────────────────────────────────────────────
{
  assert.strictEqual(
    toolErrorSummary({ content: [{ type: "text", text: "Ad set created successfully! ID: 123" }] }),
    null,
  );
  assert.strictEqual(
    toolErrorSummary({ content: [{ type: "text", text: JSON.stringify({ ad_set_id: "123", status: "PAUSED" }) }] }),
    null,
    "a JSON payload with no error_message is a success, whatever it contains",
  );
  // The trap this guards: real ad objects are named by users.
  assert.strictEqual(
    toolErrorSummary({ content: [{ type: "text", text: "Campaign: Error Analysis Q4" }] }),
    null,
    "a campaign named 'Error Analysis' must not read as a failed call",
  );
  assert.strictEqual(
    toolErrorSummary({ content: [{ type: "text", text: JSON.stringify({ campaigns: [{ name: "Errors — retargeting" }] }) }] }),
    null,
    "an error-ish name inside a successful JSON result is still a success",
  );
  assert.strictEqual(toolErrorSummary(null), null);
  assert.strictEqual(toolErrorSummary({}), null);
  assert.strictEqual(toolErrorSummary({ content: [] }), null);
  assert.strictEqual(toolErrorSummary({ content: [{ type: "image", data: "QUJD" }] }), null);
}

// ── the reason is a label, not a payload ────────────────────────────────────
// This value is sent over SSE on every tool call; results carry base64 images
// and whole insight bodies, so it must stay short and never echo the body.
{
  const huge = toolErrorSummary({ error: "Error: " + "x".repeat(5000) });
  assert.ok(huge.length <= 200, `reason must be capped, got ${huge.length}`);

  const multiline = toolErrorSummary({
    content: [{ type: "text", text: "Error: something broke\n\n  with   ragged\n  whitespace" }],
  });
  assert.ok(!/\n/.test(multiline), "newlines would break the single-line step row");
  assert.ok(!/ {2}/.test(multiline), "whitespace is collapsed");
}

console.log("metaChat toolErrors tests passed");
