#!/usr/bin/env node
/**
 * CSRF origin guard. Run with:
 *
 *   node test/security/csrfSameOrigin.test.js
 *
 * Plain-Node assertions, same style as the rest of test/. Boots a throwaway
 * Express app carrying a copy of the index.js guard — never index.js itself —
 * so nothing here opens Mongo / Redis / the Business SDK.
 *
 * ── What broke ─────────────────────────────────────────────────────────────
 * The guard rejects any state-changing request whose Origin is absent from
 * CORS_ALLOWED_ORIGINS. That variable lists *frontend* origins, so it never
 * contains the API's own origin. The Swagger UI is served by this same app at
 * /api-docs, so its "Execute" fetches go out with
 * `Origin: https://<this-api-host>` — and every one of them came back
 * 403 {"error":"CSRF validation failed: untrusted origin"}, including
 * POST /adsgpt/mobile/signup.
 *
 * The fix exempts same-origin requests. The tests below pin both halves: the
 * exemption works, and it did not open a cross-site hole.
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const {
  parseAllowedOrigins,
  isOriginAllowed,
  isSameOriginRequest,
} = require("../../utils/corsOrigins");

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
};

/** The guard exactly as index.js mounts it. */
const csrfGuard = (allowedOriginsEnv) => (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin =
      req.headers.origin ||
      (req.headers.referer ? new URL(req.headers.referer).origin : null);
    if (origin) {
      const allowedOrigins = parseAllowedOrigins(allowedOriginsEnv);
      if (
        !isOriginAllowed(origin, allowedOrigins) &&
        !isSameOriginRequest(req, origin)
      ) {
        return res
          .status(403)
          .json({ error: "CSRF validation failed: untrusted origin" });
      }
    }
  }
  next();
};

const ALLOWED = "https://app.example.com,http://localhost:5173";

/**
 * POST through the guard and resolve with the status code.
 *
 * `host` overrides the Host header the way a reverse proxy fronting the API
 * would; `forwardedProto` stands in for the X-Forwarded-Proto that a
 * TLS-terminating proxy adds (and that some strip).
 */
async function post({ origin, referer, host, forwardedProto } = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(csrfGuard(ALLOWED));
  app.post("/probe", (req, res) => res.json({ ok: true }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    const { port } = server.address();
    const headers = {};
    if (origin) headers.Origin = origin;
    if (referer) headers.Referer = referer;
    // `Host` is a forbidden header name for fetch() — undici silently drops it,
    // which would make every same-origin case here look cross-origin. Hence the
    // raw http.request below.
    if (host) headers.Host = host;
    if (forwardedProto) headers["X-Forwarded-Proto"] = forwardedProto;

    return await new Promise((resolve, reject) => {
      const httpReq = http.request(
        { host: "127.0.0.1", port, path: "/probe", method: "POST", headers },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      httpReq.on("error", reject);
      httpReq.end();
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function run() {
  console.log("CSRF guard — the Swagger regression");

  await test("Swagger UI on the API's own host is allowed (https, proxied)", async () => {
    const status = await post({
      host: "adsgpt-dev-api.poweradspy.com",
      forwardedProto: "https",
      origin: "https://adsgpt-dev-api.poweradspy.com",
    });
    assert.equal(
      status,
      200,
      "same-origin Swagger request was rejected — /api-docs Execute is broken again",
    );
  });

  await test("still allowed when the proxy strips X-Forwarded-Proto", async () => {
    const status = await post({
      host: "adsgpt-dev-api.poweradspy.com",
      origin: "https://adsgpt-dev-api.poweradspy.com",
    });
    assert.equal(status, 200);
  });

  await test("a same-origin Referer with no Origin header is allowed", async () => {
    const status = await post({
      host: "adsgpt-dev-api.poweradspy.com",
      forwardedProto: "https",
      referer: "https://adsgpt-dev-api.poweradspy.com/api-docs/",
    });
    assert.equal(status, 200);
  });

  console.log("\nCSRF guard — what must stay blocked");

  await test("a cross-site origin is still rejected", async () => {
    const status = await post({
      host: "adsgpt-dev-api.poweradspy.com",
      forwardedProto: "https",
      origin: "https://evil.com",
    });
    assert.equal(status, 403, "the same-origin exemption opened a CSRF hole");
  });

  await test("a lookalike host is still rejected", async () => {
    const status = await post({
      host: "adsgpt-dev-api.poweradspy.com",
      forwardedProto: "https",
      origin: "https://adsgpt-dev-api.poweradspy.com.evil.com",
    });
    assert.equal(status, 403);
  });

  await test("a different port on the same hostname is still rejected", async () => {
    const status = await post({
      host: "adsgpt-dev-api.poweradspy.com",
      forwardedProto: "https",
      origin: "https://adsgpt-dev-api.poweradspy.com:8443",
    });
    assert.equal(status, 403);
  });

  console.log("\nCSRF guard — unchanged behaviour");

  await test("a configured frontend origin is still allowed", async () => {
    const status = await post({
      host: "adsgpt-dev-api.poweradspy.com",
      forwardedProto: "https",
      origin: "https://app.example.com",
    });
    assert.equal(status, 200);
  });

  await test("a native client sending no Origin is still allowed", async () => {
    const status = await post({ host: "adsgpt-dev-api.poweradspy.com" });
    assert.equal(status, 200, "mobile / server-to-server callers must not be blocked");
  });

  console.log("\nisSameOriginRequest — unit");

  await test("returns false when the Host header is missing entirely", () => {
    const req = { protocol: "https", headers: {} };
    assert.equal(isSameOriginRequest(req, "https://adsgpt-dev-api.poweradspy.com"), false);
  });

  await test("a null origin short-circuits to true", () => {
    const req = { protocol: "https", headers: { host: "api.example.com" } };
    assert.equal(isSameOriginRequest(req, null), true);
  });

  console.log(`\n${passed} passed`);
  if (process.exitCode) console.error("FAILED");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
