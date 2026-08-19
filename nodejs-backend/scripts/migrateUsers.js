/**
 * migrate.js — One-time script to migrate active users from aMember + Redis → MongoDB
 *
 * Run with:
 *   node migrate.js
 *
 * What it does:
 *  1. Fetches ALL active user subscriptions from aMember
 *  2. For each user, checks Redis for any prior credit usage
 *     (key format: UnifiedCreditsUsed:<userId>:<subscriptionTypeKey>)
 *  3. Upserts a MongoDB UserProfile with correct base credits and existing used counts
 *
 * Safe to run multiple times — uses upsert so it won't duplicate records.
 * Users who already have a profile will have their usage preserved (not overwritten).
 */

require("dotenv").config();
const mongoose = require("mongoose");
const { Redis } = require("ioredis");
const UserProfile = require("../Module/user/userProfileModel");

// ─── Config ──────────────────────────────────────────────────────────────────

const MONGO_URI = process.env.MONGO_CONNECTION_STRING;
const AMEMBER_BASE_URL = process.env.AMEMBER_BASE_API_URL;
const AMEMBER_API_KEY = process.env.AMEMBER_API_KEY || process.env._key;
const TOP_UP_PLAN_ID = String(process.env.topUpPlanID || "19");
const CREDIT_PER_DOLLAR = 0.06; // $0.06 per credit for top-up calculations

const redisClient = new Redis({
  host: process.env.HOST,
  port: process.env.RD_PORT,
  username: process.env.RD_USERNAME,
  password: process.env.redisPass,
});

// ─── Credit Config (inline — mirrors creditConfig.js) ────────────────────────

const NODE_ENV = "production";

const creditConfig = {
  development: {
    8: { name: "Free for 7 days", credits: 35, durationDays: 7 },
    25: { name: "Basic for 30 days", credits: 250, durationDays: 30 },
    23: { name: "Starter 30 days", credits: 500, durationDays: 30 },
    2: { name: "Individual 30 days", credits: 1000, durationDays: 30 },
    3: { name: "Creator 30 days", credits: 2000, durationDays: 30 },
    5: { name: "Growth 30 days", credits: 4100, durationDays: 30 },
    9: { name: "Scale 30 days", credits: 6200, durationDays: 30 },
    24: { name: "Starter 1 year", credits: 6000, durationDays: 365 },
    12: { name: "Individual 1 year", credits: 13200, durationDays: 365 },
    26: { name: "Test Plan", credits: 100, durationDays: 30 },
  },
  production: {
    8: { name: "Free for 7 days", credits: 35, durationDays: 7 },
    19: { name: "Free for 7 days", credits: 35, durationDays: 7 },
    26: { name: "Basic for 30 days", credits: 250, durationDays: 30 },
    20: { name: "Starter 30 days", credits: 500, durationDays: 30 },
    2: { name: "Individual 30 days", credits: 1000, durationDays: 30 },
    23: { name: "Creator 30 days", credits: 2000, durationDays: 30 },
    24: { name: "Growth 30 days", credits: 4100, durationDays: 30 },
    25: { name: "Scale 30 days", credits: 6200, durationDays: 30 },
    21: { name: "Starter 1 year", credits: 6000, durationDays: 365 },
    9: { name: "Individual 1 year", credits: 13200, durationDays: 365 },
    27: { name: "Test Plan", credits: 100, durationDays: 30 },
    31: { name: "Starter 90 days", credits: 1600, durationDays: 90 },
  },
};

function getPlanCredits(planId) {
  return creditConfig[NODE_ENV]?.[planId]?.credits || 0;
}

function getPlanName(planId) {
  return creditConfig[NODE_ENV]?.[planId]?.name || "Unknown Plan";
}

function getPlanDurationDays(planId) {
  return creditConfig[NODE_ENV]?.[planId]?.durationDays || 30;
}

// ─── aMember Helpers ──────────────────────────────────────────────────────────

/**
 * Returns an object of { userId: { planId: expiryDate, ... }, ... }
 * For users who have at least one currently active and non-expired subscription access.
 * Handles aMember API pagination automatically.
 */
async function fetchActiveMemberSubscriptions() {
  const today = new Date().toISOString().slice(0, 10); // e.g. "2026-04-09"
  const PAGE_SIZE = 50; // fetch 50 users per page

  const userSubscriptions = {}; // { userId: { planId: expiry } }
  let page = 0;
  let totalFetched = 0;
  let grandTotal = null;

  do {
    const url =
      `${AMEMBER_BASE_URL}/users?_key=${AMEMBER_API_KEY}` +
      `&_nested[]=access&_count=${PAGE_SIZE}&_page=${page}`;

    console.log(`  Fetching page ${page} (count=${PAGE_SIZE})`);
    const res = await fetch(url);
    if (!res.ok)
      throw new Error(`aMember API failed: ${res.status} ${res.statusText}`);

    const data = await res.json();

    // aMember returns { "0": {...}, "1": {...}, ..., "_total": N }
    if (grandTotal === null) {
      grandTotal = Number(data._total) || 0;
      console.log(`  aMember reports ${grandTotal} total users`);
    }

    const usersOnPage = Object.values(data).filter(
      (u) => u && typeof u === "object" && u.user_id
    );

    if (usersOnPage.length === 0) break; // no more pages

    for (const user of usersOnPage) {
      const accesses = user.nested?.access || [];

      for (const sub of accesses) {
        // Skip not yet started
        if (sub.begin_date && sub.begin_date > today) continue;
        // Skip expired
        if (sub.expire_date && sub.expire_date < today) continue;

        const userId = String(user.user_id);
        const planId = String(sub.product_id);
        const expiry = sub.expire_date || null;

        if (!userSubscriptions[userId]) userSubscriptions[userId] = {};

        // Keep the latest expiry if the same plan appears multiple times
        if (
          !userSubscriptions[userId][planId] ||
          (expiry && expiry > userSubscriptions[userId][planId])
        ) {
          userSubscriptions[userId][planId] = expiry;
        }
      }
    }

    totalFetched += usersOnPage.length;
    page++;

    // Stop if we've fetched all users
  } while (grandTotal !== null && totalFetched < grandTotal);

  console.log(
    `  Fetched ${totalFetched} users total, ${
      Object.keys(userSubscriptions).length
    } have active subscriptions`
  );

  return userSubscriptions;
}

/**
 * Fetch a single user's profile from aMember (/users endpoint)
 */
async function fetchAmemberUser(userId) {
  const url = `${AMEMBER_BASE_URL}/users?_key=${AMEMBER_API_KEY}&_filter[user_id]=${userId}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] || null;
}

/**
 * Fetch all top-up invoices for a user and calculate lifetime top-up credits
 */
async function calcTopUpCredits(userId) {
  try {
    const url = `${AMEMBER_BASE_URL}/invoices?_key=${AMEMBER_API_KEY}&_filter[user_id]=${userId}&_nested[]=invoice-items`;
    const res = await fetch(url);
    if (!res.ok) return 0;
    const data = await res.json();

    let totalDollars = 0;
    for (const invoice of Object.values(data)) {
      if (typeof invoice !== "object" || !invoice.invoice_id) continue;
      const items = invoice.nested?.["invoice-items"] || [];
      for (const item of items) {
        if (String(item.item_id) === TOP_UP_PLAN_ID) {
          totalDollars += parseFloat(item.first_total) || 0;
        }
      }
    }

    return Math.floor(totalDollars / CREDIT_PER_DOLLAR);
  } catch (err) {
    console.error(
      `  Could not calculate top-up credits for user ${userId}:`,
      err.message
    );
    return 0;
  }
}

// ─── Redis Helpers ────────────────────────────────────────────────────────────

/**
 * Look up used credits in Redis.
 * Old key format: UnifiedCreditsUsed:<userId>:<subscriptionTypeKey>
 * where subscriptionTypeKey was the plan ID string used in old code.
 *
 * We try two patterns:
 *  1. UnifiedCreditsUsed:GPT-<amemberId>:<planId>
 *  2. UnifiedCreditsUsed:GPT-<amemberId>  (flat key, some older versions used this)
 */
async function getRedisUsedCredits(gptUserId, planId) {
  console.log(
    `    Checking Redis for usage of ${gptUserId} (plan ${planId})...`
  );
  const keys = [
    `UnifiedCreditsUsed:${gptUserId}-${planId}`,
    // `UnifiedCreditsUsed:${gptUserId}`,
  ];

  for (const key of keys) {
    const val = await redisClient.get(key);
    if (val !== null) {
      const num = parseInt(val, 10);
      if (!isNaN(num) && num > 0) {
        console.log(
          `    [Redis] Found usage for ${gptUserId} via key "${key}": ${num} credits`
        );
        return num;
      }
    }
  }
  return 0;
}

// ─── Main Migration ───────────────────────────────────────────────────────────

async function migrate() {
  console.log("=".repeat(60));
  console.log("  AdsGPT Credit Migration: aMember + Redis → MongoDB");
  console.log(`  Environment : ${NODE_ENV}`);
  console.log(`  aMember URL : ${AMEMBER_BASE_URL}`);
  console.log("=".repeat(60));

  // Connect to MongoDB
  await mongoose.connect(MONGO_URI);
  console.log("✅ MongoDB connected\n");

  // Step 1 — Fetch all active subscriptions from aMember
  const userSubscriptions = await fetchActiveMemberSubscriptions();
  const userIds = Object.keys(userSubscriptions);
  console.log(`✅ Found ${userIds.length} active aMember user(s)\n`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const amemberId of userIds) {
    const subs = userSubscriptions[amemberId];
    const allPlanIds = Object.keys(subs);

    // Determine the base plan (ignore top-up plan)
    const basePlanId = allPlanIds.find((id) => id !== TOP_UP_PLAN_ID) || "";
    const hasTopUp = allPlanIds.includes(TOP_UP_PLAN_ID);

    const gptUserId = `GPT-${amemberId}`;
    const planName = basePlanId ? getPlanName(basePlanId) : "";
    const baseCredits = basePlanId ? getPlanCredits(basePlanId) : 0;
    const subscriptionExpiry = basePlanId ? subs[basePlanId] : null;

    // Derive billing cycle start from the subscription's expiry minus the
    // plan's duration. For a 30-day plan expiring on day X, the current cycle
    // started on X-30 — works across renewals since expire_date always reflects
    // the current cycle's end. Falls back to today if expiry is unknown.
    let billingCycleStart = new Date();
    if (basePlanId && subscriptionExpiry) {
      const durationDays = getPlanDurationDays(basePlanId);
      const expiryDate = new Date(subscriptionExpiry);
      billingCycleStart = new Date(
        expiryDate.getTime() - durationDays * 24 * 60 * 60 * 1000,
      );
    }

    // Step 2 — Check Redis for existing usage
    const redisUsed = basePlanId
      ? await getRedisUsedCredits(gptUserId, basePlanId)
      : 0;

    // Calculate top-up credits from aMember invoices
    const topupCredits = hasTopUp ? await calcTopUpCredits(amemberId) : 0;

    // Fetch user details from aMember
    const amUser = await fetchAmemberUser(amemberId);
    if (!amUser) {
      console.warn(
        `  ⚠️  Skipping ${gptUserId} — could not fetch aMember profile`
      );
      skipped++;
      continue;
    }

    const existingProfile = await UserProfile.findOne({ user_id: gptUserId });

    if (existingProfile) {
      // Only update fields that are safe to backfill — preserve existing credit usage
      await UserProfile.findOneAndUpdate(
        { user_id: gptUserId },
        {
          $set: {
            login: amUser.login,
            name: `${amUser.name_f || ""} ${amUser.name_l || ""}`.trim(),
            name_f: amUser.name_f || "",
            name_l: amUser.name_l || "",
            email: amUser.email || "",
            amember_user_id: String(amemberId),
            subscriptions: subs,
            subscription_plan_id: basePlanId,
            subscription_plan_name: planName,
            subscription_expiry: subscriptionExpiry
              ? new Date(subscriptionExpiry)
              : null,
            topup_credits_purchased: topupCredits,
          },
        }
      );
      console.log(
        `  🔄  Updated existing profile: ${gptUserId} (plan: ${
          planName || "none"
        })`
      );
      updated++;
    } else {
      // New profile — set everything including Redis-migrated usage
      const safeUsed = Math.min(redisUsed, baseCredits); // can't use more than allocated

      await UserProfile.create({
        user_id: gptUserId,
        login: amUser.login,
        name: `${amUser.name_f || ""} ${amUser.name_l || ""}`.trim(),
        name_f: amUser.name_f || "",
        name_l: amUser.name_l || "",
        email: amUser.email || "",
        created_from: "GPT",
        amember_user_id: String(amemberId),
        subscriptions: subs,
        subscription_plan_id: basePlanId,
        subscription_plan_name: planName,
        subscription_expiry: subscriptionExpiry
          ? new Date(subscriptionExpiry)
          : null,
        base_subscription_credits: baseCredits,
        used_subscription_credits: safeUsed,
        rolledover_credits: 0,
        used_rolledover_credits: 0,
        topup_credits_purchased: topupCredits,
        topup_credits_used: 0,
        billing_cycle_start: billingCycleStart,
        last_credit_reset_date: billingCycleStart,
      });

      console.log(
        `  ✅  Created profile: ${gptUserId} | Plan: ${planName || "none"} | ` +
          `Base: ${baseCredits} | Used (Redis): ${safeUsed} | TopUp: ${topupCredits}`
      );
      created++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`  Migration complete`);
  console.log(`  Created : ${created}`);
  console.log(`  Updated : ${updated}`);
  console.log(`  Skipped : ${skipped}`);
  console.log("=".repeat(60));

  await redisClient.quit();
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
