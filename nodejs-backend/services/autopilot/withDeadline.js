/**
 * withDeadline — reject if a promise has not settled in time.
 *
 * Its own module, with zero dependencies, for two reasons. It is wanted in
 * more than one place (the per-account bound today; C3's concurrent task
 * runner next), and keeping it out of `userRuleOrchestrator.js` means a test
 * can exercise it without transitively booting Mongo and Redis — which that
 * module does at require time, and which turns a 50ms unit test into a
 * process that never exits.
 *
 * TWO THINGS THIS DOES NOT DO, both deliberate.
 *
 * It does not CANCEL anything. The underlying work keeps running and, for a
 * Meta call, still spends rate-limit budget; we simply stop waiting on it. An
 * `AbortController` would be tidier but is not worth the plumbing in this
 * codebase: audit calls are reads, and every write Autopilot makes is
 * idempotent by design — absolute status, absolute budget, see the header of
 * `metaRetry.js` — so an abandoned call that lands anyway is at worst an
 * unlogged repeat of what we had already decided to do.
 *
 * It does not leave the timer holding the event loop open. `.unref()` matters
 * here: without it a finished cycle would idle until the last deadline
 * expired, which at the per-account default is two extra minutes for every
 * account audited.
 *
 * One property worth knowing rather than rediscovering: `Promise.race`
 * subscribes to every input, so the loser already carries a rejection handler
 * by the time it settles. Abandoned work that fails later therefore cannot
 * surface as an unhandled rejection and take the process down. A hand-rolled
 * timeout would lose that guarantee; there is a test pinning it.
 *
 * @param {Promise<T>} promise  the work to bound
 * @param {number} ms           milliseconds before giving up
 * @param {string} label        what this is, for the error message
 * @returns {Promise<T>}
 * @template T
 */
function withDeadline(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} exceeded ${ms}ms — abandoned`)),
        ms,
      );
      if (typeof timer.unref === "function") timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

module.exports = { withDeadline };
