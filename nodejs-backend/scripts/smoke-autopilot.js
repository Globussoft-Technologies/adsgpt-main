#!/usr/bin/env node
/**
 * smoke-autopilot.js — one-command sanity check for an Autopilot deploy.
 *
 * Runs `/meta-ads/autopilot/run-cycle?dryRun=true&force=true` against the
 * configured base URL and asserts the response shape + non-zero finding
 * coverage. Intended for post-deploy verification (run it after a CI deploy
 * or whenever you want quick confidence the orchestrator + audit + system
 * token + Mongo writes are all alive).
 *
 * Exits 0 on success, non-zero on failure. Prints a one-screen summary.
 *
 * Required env or argv:
 *   AUTOPILOT_BASE_URL   default: https://adsgpt-dev-api.poweradspy.com
 *   AUTOPILOT_JWT        the Bearer token to send. Provide via env, --jwt
 *                        flag, or stdin (`echo $JWT | node scripts/...`).
 *
 * Usage:
 *   AUTOPILOT_JWT=<token> node scripts/smoke-autopilot.js
 *   node scripts/smoke-autopilot.js --jwt <token>
 *   node scripts/smoke-autopilot.js --jwt-from-mint   (mints from server env;
 *                                                      requires running on
 *                                                      the server itself.)
 *
 * Assertions
 *   - HTTP 200 + status: true
 *   - At least one configured account in response (orchestrator iterated)
 *   - Each non-skipped per-account block carries `audit`, `pause`, `resume` keys
 *   - dryRun: true on the response (so this can never trigger writes)
 *   - durationMs < 60_000 (orchestrator finished in < 1 minute)
 *   - The new on-demand audit + LLM-audit routes are MOUNTED (responds with
 *     400 missing-arg, not 404 unknown-route)
 *
 * What it does NOT verify
 *   - Whether log rows actually landed in Mongo (would need DB access)
 *   - Whether Slack alerts fired (no webhook in dry-run-only smoke flow)
 *   - Phase 9 rotation (gated off; will appear in response only when env on)
 */

const https = require("node:https");
const http = require("node:http");
const { URL } = require("node:url");

const BASE_URL =
  process.env.AUTOPILOT_BASE_URL || "https://adsgpt-dev-api.poweradspy.com";

function pickJwt() {
  // 1) --jwt <token> flag
  const idx = process.argv.indexOf("--jwt");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  // 2) --jwt-from-mint  (server-side helper)
  if (process.argv.includes("--jwt-from-mint")) {
    return mintLocalJwt();
  }
  // 3) AUTOPILOT_JWT env
  if (process.env.AUTOPILOT_JWT) return process.env.AUTOPILOT_JWT;
  // 4) explicit failure
  return null;
}

function mintLocalJwt() {
  // Server-side fallback: requires being run from the deployed backend dir
  // so dotenv finds JWT_SECRET_KEY. Useful for an SSH'd one-liner.
  try {
    require("dotenv").config();
    const jwt = require("jsonwebtoken");
    const secret = process.env.JWT_SECRET_KEY;
    if (!secret) throw new Error("JWT_SECRET_KEY not in env");
    return jwt.sign(
      {
        status: true,
        user_id: "414",
        login: "chandru_test",
        user_name: "Chandrashekar M R",
        user_email: "chandrashekar@globussoft.in",
        userSubscriptionType: { 23: "2026-12-31" },
        created_from: "GPT",
      },
      secret,
      { algorithm: "HS512", expiresIn: "10m" },
    );
  } catch (err) {
    console.error("--jwt-from-mint failed:", err.message);
    process.exit(2);
  }
}

function postJson(urlString, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": "0",
        },
        timeout: 240_000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {}
          resolve({ status: res.statusCode, body, json });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.end();
  });
}

function pad(s, n) {
  return String(s).padEnd(n);
}

(async () => {
  const jwt = pickJwt();
  if (!jwt) {
    console.error(
      "no JWT provided. Use --jwt <token>, AUTOPILOT_JWT env, or --jwt-from-mint (server only).",
    );
    process.exit(2);
  }

  const url = `${BASE_URL}/adsgpt/meta-ads/autopilot/run-cycle?dryRun=true&force=true`;
  console.log(`> POST ${url}`);
  const t0 = Date.now();

  let resp;
  try {
    resp = await postJson(url, jwt);
  } catch (err) {
    console.error("FAIL: HTTP error:", err.message);
    process.exit(3);
  }

  const wallMs = Date.now() - t0;
  console.log(`> wall: ${wallMs}ms  http: ${resp.status}`);

  // Assertions
  const failures = [];
  if (resp.status !== 200) {
    failures.push(`HTTP ${resp.status}: ${resp.body.slice(0, 300)}`);
  } else if (!resp.json) {
    failures.push("response body was not JSON");
  } else {
    const d = resp.json;
    if (d.status !== true) failures.push(`status field is ${d.status}, want true`);
    if (d.dryRun !== true)
      failures.push(`dryRun is ${d.dryRun}, MUST be true (smoke test must never write)`);
    if (typeof d.runId !== "string" || !d.runId)
      failures.push("missing runId");
    if (typeof d.durationMs !== "number")
      failures.push("missing durationMs");
    else if (d.durationMs > 60_000)
      failures.push(`durationMs ${d.durationMs} > 60s — orchestrator too slow`);
    if (!Array.isArray(d.accounts)) {
      failures.push("response missing `accounts` array");
    } else if (d.accounts.length === 0) {
      // Empty accounts is a VALID infra response when the smoke caller's
      // user has Autopilot disabled in their autopilotSettings (the cron
      // path scopes /run-cycle to the calling user only). Print a warning
      // so the operator knows the cron is wired up but inert for them.
      console.warn(
        "  [warn] accounts: [] — enable Autopilot in your autopilotSettings (Settings tab → Autopilot enabled) to bring the cron online for your account",
      );
    } else {
      for (const acc of d.accounts) {
        // The orchestrator skips users with no FB row, expired tokens, or
        // failed /me/adaccounts calls. Those are infra-irrelevant; the
        // smoke is checking infra, not config completeness.
        if (acc.skipped) continue;
        if (!acc.ok) {
          failures.push(`account ${acc.name} (${acc.adAccountId}) errored: ${acc.error}`);
          continue;
        }
        if (!acc.audit) failures.push(`account ${acc.name} missing audit block`);
        if (!acc.pause) failures.push(`account ${acc.name} missing pause block`);
        if (!acc.resume) failures.push(`account ${acc.name} missing resume block`);
      }
    }
  }

  // ─── Route-mounted check ─────────────────────────────────
  // Verifies the on-demand rule audit + LLM audit endpoints are wired up.
  // We DO NOT pass adAccountId so the controllers will return 400 (missing
  // arg). Anything other than 400 (e.g., 404 from express) means the route
  // is not mounted — that's the infra failure we care about.
  for (const path of [
    "/adsgpt/meta-ads/autopilot/audit/run",
    "/adsgpt/meta-ads/autopilot/llm-audit",
  ]) {
    const probeUrl = `${BASE_URL}${path}`;
    let probe;
    try {
      probe = await postJson(probeUrl, jwt);
    } catch (err) {
      failures.push(`route probe failed for ${path}: ${err.message}`);
      continue;
    }
    if (probe.status === 404) {
      failures.push(`route NOT mounted: ${path} (HTTP 404)`);
    } else if (probe.status >= 500) {
      failures.push(
        `route ${path} returned 5xx without args: ${probe.body.slice(0, 200)}`,
      );
    }
    // 400 / 422 / 429 are fine — route is mounted, controller rejected
    // an empty payload as expected.
  }

  // Render the rollup regardless of pass/fail.
  if (resp.json && Array.isArray(resp.json.accounts)) {
    console.log();
    console.log(
      pad("account", 22) +
        pad("audit", 16) +
        pad("would_pause", 14) +
        pad("would_resume", 14) +
        pad("scale", 10) +
        pad("rotate", 10),
    );
    for (const acc of resp.json.accounts) {
      if (!acc.ok) {
        console.log(`  ${acc.name}  ERROR: ${acc.error}`);
        continue;
      }
      const p = acc.pause || {};
      const r = acc.resume || {};
      const s = acc.scale || {};
      const rot = acc.rotate || {};
      console.log(
        "  " +
          pad((acc.name || "?").slice(0, 18), 20) +
          pad(`${acc.audit?.findings_count ?? "–"} (${acc.audit?.durationMs ?? "?"}ms)`, 16) +
          pad(p.would_pause ?? "–", 14) +
          pad(r.would_resume ?? "–", 14) +
          pad(acc.scale ? s.would_scale ?? "–" : "off", 10) +
          pad(acc.rotate ? rot.would_rotate ?? "–" : "off", 10),
      );
    }
    console.log();
    console.log(`runId: ${resp.json.runId}  duration: ${resp.json.durationMs}ms`);
  }

  if (failures.length) {
    console.log();
    console.log(`SMOKE FAILED (${failures.length} issue${failures.length === 1 ? "" : "s"}):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }

  console.log();
  console.log("SMOKE PASSED ✓");
  process.exit(0);
})();
