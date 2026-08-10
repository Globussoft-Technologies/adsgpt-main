const assert = require("node:assert/strict");
const Module = require("node:module");
const jwt = require("jsonwebtoken");

process.env.NODE_ENV = "test";
process.env.AMEMBER_SSO_SECRET = "test-secret-that-is-longer-than-32-characters";
process.env.AMEMBER_SSO_ISSUER = "amember";
process.env.AMEMBER_SSO_AUDIENCE = "adsgpt-node";
process.env.AMEMBER_SSO_SUCCESS_URL = "https://app.example.test/";
process.env.AUTH_COOKIE_DOMAIN = ".example.test";

let redisResult = "OK";
const redisCalls = [];
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request.endsWith("db/redis") || request.endsWith("db\\redis")) {
    return {
      redisClient: {
        set: async (...args) => {
          redisCalls.push(args);
          return redisResult;
        },
      },
    };
  }
  if (
    request === "./authController" &&
    /controllers[\\/]auth[\\/]amemberSsoController\.js$/.test(parent?.filename || "")
  ) {
    return {
      createAdsGptSessionForAmemberUserId: async () => ({
        token: "ads-jwt",
        user: {},
      }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const controller = require("../../controllers/auth/amemberSsoController");
Module._load = originalLoad;

function assertion(overrides = {}) {
  return jwt.sign(
    { return_path: "/adstudio", ...overrides },
    process.env.AMEMBER_SSO_SECRET,
    {
      algorithm: "HS256",
      issuer: "amember",
      audience: "adsgpt-node",
      subject: "123",
      jwtid: "0123456789abcdef0123456789abcdef",
      expiresIn: "60s",
    },
  );
}

(async () => {
  const payload = await controller.consumeAssertion(assertion());
  assert.equal(payload.sub, "123");
  assert.equal(payload.return_path, "/adstudio");
  assert.equal(redisCalls.length, 1);
  assert.equal(redisCalls[0][0], "auth:amember-sso:jti:0123456789abcdef0123456789abcdef");
  assert.deepEqual(redisCalls[0].slice(2), ["EX", 120, "NX"]);

  redisResult = null;
  await assert.rejects(
    controller.consumeAssertion(assertion()),
    (error) => error.code === "ASSERTION_REPLAYED",
  );

  assert.equal(controller.safeReturnPath("/adfactory?mode=test"), "/adfactory?mode=test");
  assert.equal(controller.safeReturnPath("https://evil.example/"), "/");
  assert.equal(controller.safeReturnPath("//evil.example/"), "/");
  assert.equal(controller.safeReturnPath("/\\evil.example/"), "/");

  const cookie = controller.serializeSessionCookie("jwt-value");
  assert.match(cookie, /^adsgpt-session=jwt-value;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Domain=\.example\.test/);
  assert.doesNotMatch(cookie, /Secure/);

  const legacyCookie = controller.serializeLegacyAccessTokenCookie("jwt-value");
  assert.match(legacyCookie, /^access-token=jwt-value;/);
  assert.doesNotMatch(legacyCookie, /HttpOnly/);
  assert.match(legacyCookie, /SameSite=Lax/);
  assert.match(legacyCookie, /Domain=\.example\.test/);

  const cleared = controller.clearSessionCookie();
  assert.match(cleared, /Max-Age=0/);

  const clearedLegacy = controller.clearLegacyAccessTokenCookie();
  assert.match(clearedLegacy, /^access-token=/);
  assert.match(clearedLegacy, /Max-Age=0/);

  // An expired plan is redirected to the aMember member area, derived from the
  // API base when AMEMBER_MEMBER_URL is not set explicitly.
  process.env.AMEMBER_BASE_API_URL = "https://adsgpt-dev.poweradspy.test/amember/api";
  delete process.env.AMEMBER_MEMBER_URL;
  assert.equal(
    controller.memberAreaUrl(),
    "https://adsgpt-dev.poweradspy.test/amember/member/index",
  );

  process.env.AMEMBER_MEMBER_URL = "https://members.example.test/amember/";
  assert.equal(controller.memberAreaUrl(), "https://members.example.test/amember/member/index");

  // A missing or unusable base must not become a 500 on the sign-in path.
  process.env.AMEMBER_MEMBER_URL = "not a url";
  assert.equal(controller.memberAreaUrl(), null);
  process.env.AMEMBER_MEMBER_URL = "";
  process.env.AMEMBER_BASE_API_URL = "";
  assert.equal(controller.memberAreaUrl(), null);

  console.log("amemberSso tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
