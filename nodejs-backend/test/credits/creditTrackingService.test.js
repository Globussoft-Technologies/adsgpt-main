#!/usr/bin/env node

const assert = require("node:assert/strict");

// creditTrackingService only uses these modules for optional real-time Redis
// updates, which are disabled. Stub them so this unit test has no Redis side
// effects.
for (const modulePath of [
  "../../sockets/setupSockets",
  "../../controllers/adCopy",
]) {
  const resolvedPath = require.resolve(modulePath);
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: {},
  };
}

const {
  CreditTrackingService,
} = require("../../services/creditTrackingService");

function assertNear(actual, expected, toleranceMs = 1000) {
  assert.ok(actual instanceof Date);
  assert.ok(
    Math.abs(actual.getTime() - expected.getTime()) <= toleranceMs,
    `expected ${actual.toISOString()} to be near ${expected.toISOString()}`,
  );
}

const now = new Date();

const startOfDay = new Date(now);
startOfDay.setHours(0, 0, 0, 0);
assertNear(CreditTrackingService.getPeriodStartDate("day"), startOfDay);

const oneWeekAgo = new Date(now);
oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
assertNear(CreditTrackingService.getPeriodStartDate("week"), oneWeekAgo);

const oneMonthAgo = new Date(now);
oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
assertNear(CreditTrackingService.getPeriodStartDate("month"), oneMonthAgo);
assertNear(CreditTrackingService.getPeriodStartDate("unsupported"), oneMonthAgo);

const oneYearAgo = new Date(now);
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
assertNear(CreditTrackingService.getPeriodStartDate("year"), oneYearAgo);

console.log("Credit tracking period tests passed");
