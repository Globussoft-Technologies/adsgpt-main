/**
 * callController — run an Express controller action in-process and capture what
 * it sent, instead of reimplementing its body.
 *
 * Ad Factory Quick setup is a second front door onto machinery that already
 * works. `createJob`, `updateJob` and `deleteJob` are full controller actions —
 * validation, ownership checks, run-lock detection, queue scheduling and
 * rescheduling, campaign back-links, GA4, and rollback if any of it throws.
 * Copying those bodies would mean a brief-created job could drift from a
 * canvas-created one the first time either side was touched; calling them means
 * the two are identical by construction, which is what
 * test/adFactory/v2JobParity.test.js pins.
 *
 * The captured `statusCode` matters as much as the body — every one of those
 * actions has meaningful 4xx paths (409 while a job is mid-run, 403 on a
 * connection the user doesn't own) that the brief layer has to relay rather
 * than swallow.
 *
 * Only `status()` and `json()` are implemented, because those are the only
 * response methods these actions use. A controller that reached for `send` or
 * `redirect` would throw here rather than resolve with something wrong, which
 * is the failure mode we want.
 */
function callController(fn, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body });
        return this;
      },
    };
    Promise.resolve(fn(req, res)).catch(reject);
  });
}

module.exports = { callController };
