const axios = require("axios");
const { generateToken } = require("../../services/authService");
const { object } = require("joi");
const UserProfile = require("../../Module/user/userProfileModel");
const { scheduleFreePlanDrip } = require("../newsletter.controller");
const UnifiedCreditController = require("../UnifiedCreditController");
const creditConfig = require("../../config/creditConfig");

const apiKey = process.env.AMEMBER_API_KEY;
const secretKey = process.env.JWT_SECRET_KEY;
const tokenExpiryTime = process.env.TOKEN_EXPIRY_TIME || 1440; // Default 24 hours
const baseUrl = process.env.AMEMBER_BASE_API_URL;
const customPlanID = process.env.customPlanID;
const topUpPlanID = process.env.topUpPlanID || "18";
const adCreativeAmount = process.env.TOP_UP_PLAN_AD_CREATIVE_PRICE;
const adCopyAmount = process.env.TOP_UP_PLAN_AD_COPY_PRICE;
const TRIAL_PLAN_ID = process.env.TRIAL_PLAN_ID;

// ── aMember product meta helpers ─────────────────────────────────────────────
// Credits & billing duration live on aMember products now (custom `credit`
// field + `second_period` / `first_period`). Cached briefly so logins don't
// hammer aMember for every subscribed product.
const PRODUCT_CACHE_TTL_MS = 1 * 60 * 1000; // 1 minutes
const productCache = new Map(); // productId -> { meta, expiresAt }

// "30d" → 30, "1y" → 365, "3m" → 90, "lifetime" → Infinity
function parsePeriodToDays(period) {
  if (!period || typeof period !== "string") return null;
  const p = period.trim().toLowerCase();
  if (p === "lifetime") return Number.POSITIVE_INFINITY;
  const match = p.match(/^(\d+)\s*([dmy])$/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "d") return n;
  if (unit === "m") return n * 30;
  if (unit === "y") return n * 365;
  return null;
}

async function fetchBillingPlan(billingPlanId) {
  if (!billingPlanId) return null;
  try {
    const res = await fetch(
      `${baseUrl}/billing-plans/${billingPlanId}?_key=${apiKey}`,
    );
    const data = await res.json();
    return data?.[0] || null;
  } catch (err) {
    console.error(`Failed to fetch aMember billing-plan ${billingPlanId}:`, err);
    return null;
  }
}

async function fetchProductMeta(productId) {
  const key = String(productId);
  const cached = productCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.meta;

  try {
    const res = await fetch(`${baseUrl}/products/${productId}?_key=${apiKey}`);
    const data = await res.json();
    const product = data?.[0];
    if (!product) return null;

    const rawCredit = product.credit;
    const credits =
      rawCredit !== undefined && rawCredit !== null && rawCredit !== ""
        ? Number(rawCredit)
        : null;

    // Period lives on the billing plan, not on the product itself.
    const billingPlan = await fetchBillingPlan(product.default_billing_plan_id);
    const firstPeriod = billingPlan?.first_period || "";
    const secondPeriod = billingPlan?.second_period || "";

    // Prefer second_period (recurring term) over first_period (trial/initial term)
    const durationDays =
      parsePeriodToDays(secondPeriod) ?? parsePeriodToDays(firstPeriod);

    const meta = {
      productId: key,
      credits: Number.isFinite(credits) ? credits : null,
      title: product.title || "",
      durationDays: Number.isFinite(durationDays) ? durationDays : null,
      firstPeriod,
      secondPeriod,
      billingPlanId: product.default_billing_plan_id || "",
    };

    productCache.set(key, {
      meta,
      expiresAt: Date.now() + PRODUCT_CACHE_TTL_MS,
    });
    return meta;
  } catch (err) {
    console.error(`Failed to fetch aMember product ${productId}:`, err);
    return null;
  }
}

// Enrich a user-data payload with resolved product metadata for every active
// subscription (skipping the top-up product — its credits come from invoices).
async function enrichUserDataWithProducts(userData) {
  const productIds = Object.keys(userData?.subscriptions || {}).filter(
    (id) => String(id) !== String(topUpPlanID),
  );

  if (productIds.length === 0) {
    userData.productsMeta = [];
    return userData;
  }

  const results = await Promise.allSettled(productIds.map(fetchProductMeta));
  userData.productsMeta = results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter(Boolean);
  return userData;
}

const fetchUserData = async (loginPass) => {
  const url = `${baseUrl}/check-access/by-login-pass`;
  const params = new URLSearchParams({
    _key: apiKey,
    login: loginPass?.login,
    pass: loginPass?.pass,
  });
  try {
    const response = await fetch(`${url}?${params}`);
    const data = await response.json();
    if (!data?.ok) return data;
    return await enrichUserDataWithProducts(data);
  } catch (error) {
    console.error("Error fetching user data:", error);
    throw error;
  }
};

function isPlanActive(user) {
  const subscription = user.userSubscriptionType || user.subscriptions;

  if (!subscription || Object.keys(subscription).length === 0) {
    return false;
  }

  const subscriptionDate = new Date(Object.values(subscription)[0]);

  const expiryUTC = Date.UTC(
    subscriptionDate.getUTCFullYear(),
    subscriptionDate.getUTCMonth(),
    subscriptionDate.getUTCDate(),
    23,
    59,
    59,
    999
  );

  const nowUTC = Date.now();

  return nowUTC <= expiryUTC;
}

function transformData(input) {
  const defaults = {
    planDetails: {
      name: "Custom Plan",
      description:
        "Provides limited access to basic features, including monthly prompts, ad copies, and connectivity to selected advertising platforms based on user preference.",
      access: "custom Plans",
      prompts: "Monthly limit applies",
      adCopies: "Limited ad copies",
      price: " ",
      topPlan: false,
      more: "Includes limited support and access to essential features.",
    },
    "Ad copy": 5000,
    "Ad Creative": 1500,
    Networks: ["google", "facebook", "instagram", "youtube", "pinterest"],
    "Number of prompts user can make per month": 50000,
    "Advertiser Search": true,
    "Market analysis": true,
    "Generate Similar Ads": true,
    "Target Audience": true,
    adsCopyNetworks: [],
    "Ad Count by Post Owner": true,
    "Popularity Index": true,
    "Distribution of Call to Action": true,
    "Geographical Distribution of Ads": 12,
    "Engagement Comparison Across Ad Formats": true,
  };

  const result = { ...defaults };

  for (const key in input) {
    const item = input[key];
    if (key === "Networks") {
      result["Networks"] =
        item.value.length > 0 ? item.value : defaults["Networks"];
    } else if (key === "adsCopyNetworks") {
      result["adsCopyNetworks"] =
        item.value.length > 0 ? item.value : defaults["adsCopyNetworks"];
    } else if (key === "Ad Creative") {
      result["Ad Creative"] = item?.value ? 0 : defaults["Ad Creative"];
    } else if (key === "Number of prompts user can make per month") {
      result["Number of prompts user can make per month"] =
        item.value.length > 0
          ? Number(item.value[0])
          : defaults["Number of prompts user can make per month"];
    } else if (key === "Ad copy") {
      result["Ad copy"] =
        item.value.length > 0 ? Number(item.value[0]) : defaults["Ad copy"];
    } else if (key === "Geographical Distribution of Ads") {
      result["Geographical Distribution of Ads"] = item?.value
        ? 12
        : defaults["Geographical Distribution of Ads"];
    } else if (item.value === 1) {
      result.adsCopyNetworks.push(item.optionLabel);
    } else if (item.valueLabel && item.valueLabel?.length > 0) {
      result.adsCopyNetworks.push(...item.valueLabel);
    } else if (
      item.value !== "" &&
      item.value !== null &&
      item.valueLabel.length > 0
    ) {
      result[key] = true;
    }
  }

  return result;
}

function transformTopUpData(input) {
  const defaults = {
    planDetails: {
      name: "Top-Up Plan",
      description:
        "Provides limited access to basic features, including monthly prompts, ad copies, and connectivity to selected advertising platforms based on user preference.",
      access: "Top-Up Plans",
      prompts: "Monthly limit applies",
      adCopies: "Limited ad copies",
      price: " ",
      topPlan: false,
      more: "Includes limited support and access to essential features.",
    },
    "Ad copy": 0,
    "Ad Creative": 0,
    Networks: ["google", "facebook", "instagram", "youtube", "pinterest"],
    "Number of prompts user can make per month": 50000,
    "Advertiser Search": true,
    "Market analysis": true,
    "Generate Similar Ads": true,
    "Target Audience": true,
    adsCopyNetworks: [
      "Google Performance Max Ads",
      "Google Video Ads",
      "Reddit Ads",
      "Twitter Ads",
      "Pinterest Ads",
      "Google Display Ads",
      "Meta Ads",
      "LinkedIn Ads",
      "Google Search Ads",
    ],
    "Ad Count by Post Owner": true,
    "Popularity Index": true,
    "Distribution of Call to Action": true,
    "Geographical Distribution of Ads": 12,
    "Engagement Comparison Across Ad Formats": true,
  };

  const result = { ...defaults };

  const totalUnitInDollor = input?.reduce((sum, val) => sum + val, 0);

  result["Ad copy"] = Math.floor(totalUnitInDollor / adCopyAmount);

  // Requirement: Every credit is exactly $0.06 based on how much the user has paid
  result["Ad Creative"] = Math.floor(totalUnitInDollor / 0.06);
  return result;
}

async function getTopUpPlanDetails(userId) {
  const testUrl = `${baseUrl}/users?_key=${apiKey}&_filter[user_id]=${userId}&_nested[]=invoices`;
  const response = await fetch(testUrl);
  const resultData = await response.json();
  let invoiceData = resultData[0]?.nested?.invoices || [];
  if (invoiceData.length > 0) {
    invoiceData = invoiceData.reverse();
  }
  const allCustomOptions = [];
  const wantId = String(topUpPlanID);
  const seenIds = []; // diagnostic: every (item_id / billing_plan_id) we saw

  for (const value of invoiceData) {
    const invoiceId = value.invoice_id;

    const customPlanUrl = `${baseUrl}/invoices/${invoiceId}?_key=${apiKey}`;
    try {
      const resultInvoice = await fetch(customPlanUrl);
      const resultDataInvoice = await resultInvoice.json();

      const invoiceItems =
        resultDataInvoice[0]?.nested?.["invoice-items"] || [];

      // Match the Top-Up product on EITHER identifier aMember may carry it on:
      // `item_id` (product id) or `billing_plan_id` (the trial flow in this
      // file matches on billing_plan_id, so top-up products may too). Without
      // this, a product whose id only appears in billing_plan_id is missed and
      // top-up credits silently resolve to 0.
      for (const item of invoiceItems) {
        seenIds.push(
          `item_id=${item.item_id}/billing_plan_id=${item.billing_plan_id}/type=${item.item_type}`,
        );
        const matches =
          String(item.item_id) === wantId ||
          String(item.billing_plan_id) === wantId;
        if (matches) {
          const dollarAmountPaid = parseFloat(item.first_total) || 0;
          allCustomOptions.push(dollarAmountPaid);
        }
      }
    } catch (err) {
      console.error(`Failed to fetch invoice ${invoiceId}:`, err);
    }
  }

  // allCustomOptions now contains an array of precise dollar amounts paid exclusively for Top-Ups
  if (allCustomOptions.length === 0) {
    console.warn(
      `[topup] user ${userId}: NO invoice items matched plan ${wantId}. ` +
        `Seen items: ${seenIds.join(" | ") || "(none)"}`,
    );
  } else {
    console.log(
      `[topup] user ${userId}: matched ${allCustomOptions.length} item(s) for plan ${wantId}, dollars=[${allCustomOptions.join(", ")}]`,
    );
  }

  const topUpResponse = transformTopUpData(allCustomOptions);
  return topUpResponse;
}
async function getCustomPlanDetails(userId) {
  const testUrl = `${baseUrl}/users?_key=${apiKey}&_filter[user_id]=${userId}&_nested[]=invoices`;
  const response = await fetch(testUrl);
  const resultData = await response.json();
  let invoiceData = resultData[0]?.nested?.invoices || [];
  if (invoiceData.length > 0) {
    invoiceData = invoiceData.reverse();
  }

  for (const value of invoiceData) {
    const invoiceId = value.invoice_id;

    const customPlanUrl = `${baseUrl}/invoices/${invoiceId}?_key=${apiKey}`;
    const resultInvoice = await fetch(customPlanUrl);
    const resultDataInvoice = await resultInvoice.json();
    const customOptions = JSON.parse(
      resultDataInvoice[0]?.nested?.["invoice-items"]?.[0]?.options || "{}"
    );

    const invoiceStatus = parseInt(value.status, 10);
    const response = transformData(customOptions);
    return response;
  }
}

async function getTrialPlanDetails(userId) {
  try {
    const testUrl = `${baseUrl}/users?_key=${apiKey}&_filter[user_id]=${userId}&_nested[]=invoices`;
    const response = await fetch(testUrl);
    const resultData = await response.json();

    const allUserInvoices = resultData[0]?.nested?.invoices || [];

    if (allUserInvoices?.length === 0) {
      return {
        phase: "no-invoice",
        statusText:
          "No invoice found. User might not have started a trial or subscription.",
        invoiceId: "",
        status: "",
        startDate: "",
        planDetails: {
          planDetails: {
            name: "No Active Plan",
            description: "Full access to all premium features after trial.",
            access: "Full Access",
            price: "$99/month",
            topPlan: true,
            more: "Includes premium support and unlimited access to features.",
          },
          "Ad copy": 0,
          "Ad Creative": 0,
          "Number of prompts user can make per month": 0,
          Networks: [],
          "Advertiser Search": false,
          "Market analysis": false,
          "Generate Similar Ads": false,
          "Target Audience": false,
          adsCopyNetworks: [],
          "Ad Count by Post Owner": false,
          "Popularity Index": false,
          "Distribution of Call to Action": false,
          "Geographical Distribution of Ads": 0,
          "Engagement Comparison Across Ad Formats": false,
        },
      };
    }

    const sortedInvoices = allUserInvoices.sort(
      (a, b) => new Date(b.tm_started) - new Date(a.tm_started)
    );

    let currentPlan = null;
    const currentDate = new Date();

    for (const invoice of sortedInvoices) {
      const invoiceId = invoice.invoice_id;

      const invoiceDetailUrl = `${baseUrl}/invoices/${invoiceId}?_key=${apiKey}`;
      const invoiceResponse = await fetch(invoiceDetailUrl);
      const invoiceDetails = await invoiceResponse.json();

      if (
        !invoiceDetails ||
        invoiceDetails.length === 0 ||
        !invoiceDetails[0]?.nested
      ) {
        continue;
      }

      const invoiceItems = invoiceDetails[0]?.nested?.["invoice-items"] || [];
      const invoicePayments = (
        invoiceDetails[0]?.nested?.["invoice-payments"] || []
      ).sort((a, b) => new Date(b.dattm) - new Date(a.dattm));

      const mainInvoiceItem = invoiceItems.find(
        (item) =>
          item.item_type === "product" && item.billing_plan_id === TRIAL_PLAN_ID
      );

      if (!mainInvoiceItem) {
        continue;
      }

      const options = JSON.parse(mainInvoiceItem?.options || "{}");
      const itemTitle = mainInvoiceItem.item_title;
      const status = parseInt(invoice.status, 10);

      const successfulPayments = invoicePayments.filter(
        (p) =>
          parseFloat(p.amount) > 0 &&
          (!p.refund_amount || parseFloat(p.refund_amount) === 0)
      );

      const latestPayment = successfulPayments[0];

      const totalPaid = successfulPayments.reduce(
        (sum, payment) => sum + parseFloat(payment.amount),
        0
      );

      if (status === 2 && successfulPayments.length > 0) {
        const firstPrice = parseFloat(mainInvoiceItem.first_price);
        const secondPrice = parseFloat(mainInvoiceItem.second_price);
        const rebillDate = new Date(invoice.rebill_date);
        const tmStarted = new Date(invoice.tm_started);

        if (
          totalPaid >= secondPrice - 0.01 &&
          mainInvoiceItem.second_period === "30d" &&
          secondPrice === 99.0
        ) {
          currentPlan = {
            phase: "post-trial-paid",
            statusText: "Trial ended, user is on $99 paid plan.",
            invoiceId,
            startDate: tmStarted,
            rebillDate: rebillDate,
            invoiceItem: options,
            terms: invoice.terms,
            planDetails: {
              planDetails: {
                name: "Basic Plan",
                description: "Full access to all premium features after trial.",
                access: "Full Access",
                price: "$99/month",
                topPlan: true,
                more: "Includes premium support and unlimited access to features.",
              },
              "Ad copy": 1000,
              "Ad Creative": 100,
              Networks: [
                "google",
                "facebook",
                "instagram",
                "youtube",
                "pinterest",
              ],
              "Number of prompts user can make per month": 100000,
              "Advertiser Search": true,
              "Market analysis": true,
              "Generate Similar Ads": true,
              "Target Audience": true,
              adsCopyNetworks: [
                "Google Performance Max Ads",
                "Google Video Ads",
                "Reddit Ads",
                "Twitter Ads",
                "Pinterest Ads",
                "Google Display Ads",
                "Meta Ads",
                "LinkedIn Ads",
                "Google Search Ads",
              ],
              "Ad Count by Post Owner": true,
              "Popularity Index": true,
              "Distribution of Call to Action": true,
              "Geographical Distribution of Ads": 12,
              "Engagement Comparison Across Ad Formats": true,
            },
          };
          break;
        } else if (
          totalPaid >= firstPrice - 0.01 &&
          mainInvoiceItem.first_period === "3d" &&
          currentDate < rebillDate
        ) {
          currentPlan = {
            phase: "on-trial",
            statusText: "User is currently in trial period.",
            invoiceId,
            startDate: tmStarted,
            rebillDate: rebillDate,
            invoiceItem: options,
            terms: invoice.terms,
            planDetails: {
              planDetails: {
                name: "Trial Plan",
                description: "Limited-time trial access to core features.",
                access: "Trial Access",
                price: "$10 for 3 days",
                topPlan: false,
                more: "Trial includes essential tools with usage limits.",
              },
              "Ad copy": 100,
              "Ad Creative": 70,
              Networks: [
                "google",
                "facebook",
                "instagram",
                "youtube",
                "pinterest",
              ],
              "Number of prompts user can make per month": 3000,
              "Advertiser Search": true,
              "Market analysis": true,
              "Generate Similar Ads": true,
              "Target Audience": true,
              adsCopyNetworks: [
                "Google Performance Max Ads",
                "Google Video Ads",
                "Reddit Ads",
                "Twitter Ads",
                "Pinterest Ads",
                "Google Display Ads",
                "Meta Ads",
                "LinkedIn Ads",
                "Google Search Ads",
              ],
              "Ad Count by Post Owner": true,
              "Popularity Index": true,
              "Distribution of Call to Action": true,
              "Geographical Distribution of Ads": 12,
              "Engagement Comparison Across Ad Formats": true,
            },
          };
          break;
        } else if (
          mainInvoiceItem.first_period === "3d" &&
          currentDate >= rebillDate &&
          totalPaid < secondPrice
        ) {
          continue;
        }
      } else if (status === 1) {
        if (
          !currentPlan ||
          currentPlan.phase === "no-invoice" ||
          currentPlan.phase === "trial-incomplete"
        ) {
          currentPlan = {
            phase: "trial-incomplete",
            statusText: "Trial started but not confirmed/paid.",
            invoiceId,
            status,
            startDate: new Date(invoice.tm_started),
            planDetails: {
              planDetails: {
                name: "Basic Plan",
                description: "Full access to all premium features after trial.",
                access: "Full Access",
                price: "$99/month",
                topPlan: false,
                more: "Includes premium support and unlimited access to features.",
              },
              "Ad copy": 0,
              "Ad Creative": 0,
              "Number of prompts user can make per month": 0,
              Networks: [],
              "Advertiser Search": false,
              "Market analysis": false,
              "Generate Similar Ads": false,
              "Target Audience": false,
              adsCopyNetworks: [],
              "Ad Count by Post Owner": false,
              "Popularity Index": false,
              "Distribution of Call to Action": false,
              "Geographical Distribution of Ads": 0,
              "Engagement Comparison Across Ad Formats": false,
            },
          };
        }
      }
    }

    if (currentPlan) {
      return currentPlan;
    } else {
      return {
        phase: "trial-incomplete",
        statusText: "No active paid plan found or trial is pending payment.",
        planDetails: {
          planDetails: {
            name: "Basic Plan",
            description: "Full access to all premium features after trial.",
            access: "Full Access",
            price: "$99/month",
            topPlan: false,
            more: "Includes premium support and unlimited access to features.",
          },
          "Ad copy": 0,
          "Ad Creative": 0,
          "Number of prompts user can make per month": 0,
          Networks: [],
          "Advertiser Search": false,
          "Market analysis": false,
          "Generate Similar Ads": false,
          "Target Audience": false,
          adsCopyNetworks: [],
          "Ad Count by Post Owner": false,
          "Popularity Index": false,
          "Distribution of Call to Action": false,
          "Geographical Distribution of Ads": 0,
          "Engagement Comparison Across Ad Formats": false,
        },
      };
    }
  } catch (error) {
    console.error("Error in getTrialPlanDetails:", error);
    return { status: "error", error: error.message };
  }
}

const fetchUserDataByName = async (loginPass, res) => {
  const url = `${baseUrl}/check-access/by-login`;
  const params = new URLSearchParams({ _key: apiKey, login: loginPass });
  try {
    const response = await fetch(`${url}?${params}`);
    const data = await response.json();
    if (!data?.ok) return data;
    return await enrichUserDataWithProducts(data);
  } catch (error) {
    console.error("Error fetching user data:", error);
    throw error;
  }
};

const fetchUserDataByName_Email = async (login, res, email) => {
  try {
    if (email) {
      const urlEmail = `${baseUrl}/check-access/by-email`;
      const paramsEmail = new URLSearchParams({ _key: apiKey, email });

      const emailRes = await fetch(`${urlEmail}?${paramsEmail}`);
      const emailData = await emailRes.json();

      if (emailData?.ok) {
        return { exists: true, type: "email", data: emailData };
      }
    }

    if (login) {
      const url = `${baseUrl}/check-access/by-login`;
      const params = new URLSearchParams({ _key: apiKey, login });

      const response = await fetch(`${url}?${params}`);
      const loginData = await response.json();

      if (loginData?.ok) {
        return { exists: true, type: "login", data: loginData };
      }
    }

    return { exists: false };
  } catch (error) {
    console.error("Error fetching user data:", error);
    throw error;
  }
};

/**
 * Resolve the plan snapshot ({ credits, durationDays, planName, source }) for
 * a given subscription plan id. Prefers aMember product meta; falls back to
 * creditConfig if the aMember field is missing (logged loudly).
 */
function resolvePlanSnapshot(subscriptionPlanId, productsMeta, env) {
  if (!subscriptionPlanId) return null;

  const meta = (productsMeta || []).find(
    (m) => String(m.productId) === String(subscriptionPlanId),
  );
  const configEntry = creditConfig[env]?.[subscriptionPlanId];

  let credits = null;
  let durationDays = null;
  let planName = null;
  let source = "";

  if (meta && Number.isFinite(meta.credits)) {
    credits = meta.credits;
    source = "amember";
  }
  if (meta && Number.isFinite(meta.durationDays)) {
    durationDays = meta.durationDays;
  }
  if (meta?.title) planName = meta.title;

  if (credits === null) {
    if (configEntry && Number.isFinite(configEntry.credits)) {
      credits = configEntry.credits;
      source = source || "config";
      console.warn(
        `[plan_snapshot] credits missing on aMember for plan ${subscriptionPlanId} — falling back to creditConfig`,
      );
    } else {
      credits = 0;
      source = source || "fallback";
      console.warn(
        `[plan_snapshot] no credits resolvable for plan ${subscriptionPlanId} — defaulting to 0`,
      );
    }
  }
  if (durationDays === null) {
    durationDays = configEntry?.durationDays ?? 30;
  }
  if (!planName) {
    planName = configEntry?.name || "Unknown Plan";
  }

  return {
    credits,
    durationDays,
    planName,
    source,
    fetched_at: new Date(),
  };
}

/**
 * Sync user profile in MongoDB and handle credit initialization / billing refresh.
 * Called on every login to keep local state in sync with aMember.
 */
async function syncUserProfile(userData) {
  const allSubIds = Object.keys(userData.subscriptions || {});

  // Pick the real base plan (ignore the topUpPlanID entirely finding the base plan)
  let subscriptionPlanId =
    allSubIds.find((id) => String(id) !== String(topUpPlanID)) || "";

  // NO FALLBACK: If they only have a top-up plan, subscriptionPlanId remains ""
  // This successfully prevents topups from providing access without an active subscription.

  const subscriptionExpiry = subscriptionPlanId
    ? userData.subscriptions[subscriptionPlanId]
    : null;

  const hasTopUpPlan = allSubIds.includes(String(topUpPlanID));

  // Calculate dynamic lifetime topup credits using aMember invoices
  let topupPurchasedTotal = 0;
  if (hasTopUpPlan) {
    try {
      const topUpDetails = await getTopUpPlanDetails(userData.user_id);
      topupPurchasedTotal = Number(topUpDetails?.["Ad Creative"]) || 0;
    } catch (err) {
      console.error(
        `Failed to fetch top-up details for user ${userData.user_id}:`,
        err
      );
    }
  }

  // Check if user already exists
  const existingUser = await UserProfile.findOne({
    user_id: `GPT-${userData.user_id}`,
  });

  const env = UnifiedCreditController.getEnvironment();
  const planSnapshot = resolvePlanSnapshot(
    subscriptionPlanId,
    userData.productsMeta,
    env,
  );
  const planName = planSnapshot?.planName || "";
  const baseCreditsFromSnapshot = planSnapshot?.credits ?? 0;

  // Derive billing cycle start from aMember's expire_date minus the plan's
  // duration. For a 30-day plan expiring on day X, the current cycle started
  // on X-30 — works across renewals because expire_date always reflects the
  // current cycle's end. Falls back to now if expiry/duration are unresolvable.
  const computeCycleStart = () => {
    const durationDays = planSnapshot?.durationDays;
    if (
      !subscriptionExpiry ||
      !Number.isFinite(durationDays) ||
      durationDays <= 0
    ) {
      return new Date();
    }
    return new Date(
      new Date(subscriptionExpiry).getTime() -
        durationDays * 24 * 60 * 60 * 1000,
    );
  };
  const billingCycleStart = computeCycleStart();

  if (!existingUser) {
    // --- NEW USER: Create profile and initialize credits ---
    await UserProfile.create({
      user_id: `GPT-${userData.user_id}`,
      login: userData.login,
      name: (userData.name_f ?? "") + " " + (userData.name_l ?? ""),
      name_f: userData.name_f ?? "",
      name_l: userData.name_l ?? "",
      email: userData.email,
      created_from: "GPT",
      amember_user_id: String(userData.user_id),
      subscriptions: userData.subscriptions,
      subscription_plan_id: String(subscriptionPlanId),
      subscription_plan_name: planName,
      subscription_expiry: subscriptionExpiry
        ? new Date(subscriptionExpiry)
        : null,
      base_subscription_credits: baseCreditsFromSnapshot,
      used_subscription_credits: 0,
      rolledover_credits: 0,
      used_rolledover_credits: 0,
      topup_credits_purchased: topupPurchasedTotal,
      topup_credits_used: 0,
      billing_cycle_start: billingCycleStart,
      last_credit_reset_date: billingCycleStart,
      plan_snapshot: planSnapshot || undefined,
    });
    
    console.log(
      `New user profile created for ${userData.login} (${userData.user_id}) with ${baseCreditsFromSnapshot} credits (source: ${planSnapshot?.source || "none"})`,
    );

    // Kick off the 7-day free-trial drip sequence for plan 8 users.
    scheduleFreePlanDrip({
      user_id: `GPT-${userData.user_id}`,
      subscription_plan_id: String(subscriptionPlanId),
      email: userData.email,
      name_f: userData.name_f ?? "",
      name: (userData.name_f ?? "") + " " + (userData.name_l ?? ""),
      billing_cycle_start: billingCycleStart,
    }).catch((err) => console.error("[newsletter] scheduleFreePlanDrip error:", err));
  } else {
    // --- EXISTING USER: Update profile fields ---
    const userId = `GPT-${userData.user_id}`;
    const oldPlanId = existingUser.subscription_plan_id || "";
    const newPlanId = String(subscriptionPlanId);
    const previousPlanId = existingUser.previous_plan_id || "";

    const updateFields = {
      login: userData.login,
      name: (userData.name_f ?? "") + " " + (userData.name_l ?? ""),
      name_f: userData.name_f ?? "",
      name_l: userData.name_l ?? "",
      email: userData.email,
      subscriptions: userData.subscriptions,
      subscription_plan_id: newPlanId,
      subscription_plan_name: planName,
      subscription_expiry: subscriptionExpiry
        ? new Date(subscriptionExpiry)
        : null,
      topup_credits_purchased: topupPurchasedTotal,
    };

    // Refresh the plan snapshot on every login — aMember is the source of truth
    if (planSnapshot) {
      updateFields.plan_snapshot = planSnapshot;
    }

    // Four scenarios:
    //  1. Plan paused (had a plan, now gone):    preserve credits, remember old plan
    //  2. Resubscribed to same plan after pause: rollover leftover, fresh base
    //  3. Plan changed (old and new differ):     zero reset, no rollover
    //  4. Plan unchanged:                        let refreshBillingCycle handle renewal
    let runBillingRefresh = false;

    if (oldPlanId !== "" && newPlanId === "") {
      // Scenario 1: base plan disappeared in aMember (admin deletion / lapse).
      // Keep all credit balances intact. Remember the last plan so a future
      // resubscribe to the same plan can roll over the leftover.
      updateFields.previous_plan_id = oldPlanId;
      console.log(
        `Base plan removed for user ${userId} (was ${oldPlanId}). ` +
          `Credits preserved; previous_plan_id saved for potential rollover.`
      );
    } else if (
      oldPlanId === "" &&
      newPlanId !== "" &&
      previousPlanId === newPlanId
    ) {
      // Scenario 2: user resubscribed to the same plan that was previously
      // removed. Treat like a monthly renewal — rollover leftover base +
      // rollover credits, assign fresh base allocation.
      const newBaseCredits = baseCreditsFromSnapshot;

      const leftoverBase = Math.max(
        0,
        (existingUser.base_subscription_credits || 0) -
          (existingUser.used_subscription_credits || 0)
      );
      const leftoverRollover = Math.max(
        0,
        (existingUser.rolledover_credits || 0) -
          (existingUser.used_rolledover_credits || 0)
      );
      // old logic: we used to allow both leftover base and leftover rollover to be carried forward on resubscribe, but this could lead to excessive credit accumulation if a user kept pausing and resubscribing without using credits. To prevent potential abuse while still rewarding users for unused credits, we now only allow leftover base credits to be rolled over on resubscribe — leftover rollover credits will not be carried forward.
      // const carryForward = leftoverBase + leftoverRollover;

      // New logic: only carry forward leftover base credits on resubscribe. Leftover rollover credits will be forfeited if the user pauses and resubscribes, but this prevents potential credit accumulation abuse while still allowing users to benefit from unused base credits when they return.
      // The 7-day trial gets NO rollover on resubscribe either — otherwise
      // a user could exit-then-resubscribe to chain unlimited free trials.
      const planDurationDays = planSnapshot?.durationDays || 30;
      const isShortTrial = planDurationDays === 7;
      const carryForward = isShortTrial ? 0 : leftoverBase;


      updateFields.base_subscription_credits = newBaseCredits;
      updateFields.used_subscription_credits = 0;
      updateFields.rolledover_credits = carryForward;
      updateFields.used_rolledover_credits = 0;
      updateFields.billing_cycle_start = billingCycleStart;
      updateFields.last_credit_reset_date = billingCycleStart;
      updateFields.previous_plan_id = "";

      console.log(
        `User ${userId} resubscribed to same plan ${newPlanId}. ` +
          `Rolled over ${carryForward} credits, new base: ${newBaseCredits}.`
      );
    } else if (oldPlanId !== newPlanId) {
      // Scenario 3: genuine plan change (different plan, or fresh subscribe
      // after a pause to a different plan). Reset without rollover.
      const newBaseCredits = newPlanId ? baseCreditsFromSnapshot : 0;

      updateFields.base_subscription_credits = newBaseCredits;
      updateFields.used_subscription_credits = 0;
      updateFields.rolledover_credits = 0;
      updateFields.used_rolledover_credits = 0;
      updateFields.billing_cycle_start = billingCycleStart;
      updateFields.last_credit_reset_date = billingCycleStart;
      updateFields.previous_plan_id = "";

      console.log(
        `Plan changed for user ${userId}: ${oldPlanId || "(none)"} → ` +
          `${newPlanId || "(none)"}. New base credits: ${newBaseCredits} ` +
          `(no rollover on plan change)`
      );
    } else {
      // Scenario 4: plan unchanged — normal login. Let billing cycle refresh
      // handle monthly renewal / rollover.
      runBillingRefresh = newPlanId !== "";
    }

    await UserProfile.findOneAndUpdate(
      { user_id: userId },
      { $set: updateFields },
      { new: true }
    );

    if (hasTopUpPlan) {
      console.log(
        `Top-up plan (ID: ${topUpPlanID}) detected for user ${userId}`
      );
    }

    if (runBillingRefresh) {
      await UnifiedCreditController.refreshBillingCycle(userId, newPlanId);
    }
  }
}

const getFromAmemberUserDetails = async (req, res, autoGenerated = false) => {
  const login = req?.params?.username || req?.userName;
  try {
    if (!login) {
      return res.status(403).json({ message: "login is required" });
    }
    const userData = await fetchUserDataByName(login, res);
    if (!userData?.ok) {
      return res.status(403).json({ ...userData });
    } else if (!isPlanActive(userData)) {
      return res.status(403).json({
        ok: true,
        code: -6,
        expired: true,
        msg: "Your Plan expired",
      });
    }

    // Sync user profile and credits in MongoDB
    await syncUserProfile(userData);

    const tokenPayload = {
      status: userData?.ok,
      user_id: userData?.user_id,
      login: userData.login,
      user_name: (userData.name_f ?? "") + " " + (userData.name_l ?? ""),
      user_email: userData.email,
      name_f: userData?.name_f ?? "",
      name_l: userData?.name_l ?? "",
      userSubscriptionType: Object.fromEntries(
        Object.entries(userData?.subscriptions || {}).filter(
          ([key]) => String(key) !== String(topUpPlanID)
        )
      ),
      created_from: "GPT",
    };

    let jwtToken = "";

    if (Object.keys(userData.subscriptions)[0] == customPlanID) {
      tokenPayload.customPlan = await getCustomPlanDetails(userData?.user_id);
      tokenPayload.applyCustomPlan = true;
      jwtToken = generateToken(
        tokenPayload,
        secretKey,
        tokenExpiryTime,
        autoGenerated
      );
      res.status(200).json({
        ok: true,
        msg: "User verified",
        token: jwtToken,
        user: tokenPayload,
      });
    } else {
      jwtToken = generateToken(
        tokenPayload,
        secretKey,
        tokenExpiryTime,
        autoGenerated
      );
      res.status(200).json({
        ok: true,
        msg: "User verified",
        token: jwtToken,
        user: tokenPayload,
      });
    }
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Failed to fetch user data", error: error.message });
  }
};

const getUserDetails = async (req, res) => {
  const login = req.body;
  try {
    if (!login?.login || !login?.pass) {
      return res.status(403).json({ message: "login and password require" });
    }
    const userData = await fetchUserData(login, res);
    if (!userData?.ok) {
      return res.status(403).json({ ...userData });
    } else if (!isPlanActive(userData)) {
      return res.status(403).json({
        ok: true,
        code: -6,
        expired: true,
        msg: "Your Plan expired",
      });
    }

    // Sync user profile and credits in MongoDB
    await syncUserProfile(userData);

    const tokenPayload = {
      status: userData?.ok,
      user_id: userData?.user_id,
      login: userData.login,
      user_name: (userData.name_f ?? "") + " " + (userData.name_l ?? ""),
      user_email: userData.email,
      name_f: userData?.name_f ?? "",
      name_l: userData?.name_l ?? "",
      userSubscriptionType: Object.fromEntries(
        Object.entries(userData?.subscriptions || {}).filter(
          ([key]) => String(key) !== String(topUpPlanID)
        )
      ),
      created_from: "GPT",
    };

    let jwtToken = "";
    if (Object.keys(userData.subscriptions)[0] == customPlanID) {
      tokenPayload.customPlan = await getCustomPlanDetails(userData?.user_id);
      tokenPayload.applyCustomPlan = true;
      jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);
      res.status(200).json({
        ok: true,
        msg: "User verified",
        token: jwtToken,
        user: tokenPayload,
      });
    } else if (
      (userData?.subscriptions &&
        Object.keys(userData.subscriptions)?.[0] == TRIAL_PLAN_ID) ||
      (userData?.userSubscriptionType &&
        Object.keys(userData.userSubscriptionType)?.[0] == TRIAL_PLAN_ID)
    ) {
      const Plan = await getTrialPlanDetails(userData?.user_id);
      tokenPayload.TrailPlanDetails = Plan;
      tokenPayload.TrailPlan = true;

      jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);
      res.status(200).json({
        ok: true,
        msg: "User verified",
        token: jwtToken,
        user: tokenPayload,
      });
    } else if (Object.keys(userData?.subscriptions)?.[0] == topUpPlanID) {
      tokenPayload.topUpPlan = await getTopUpPlanDetails(userData?.user_id);
      tokenPayload.applyTopUpPlan = true;
      jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);
      res.status(200).json({
        ok: true,
        msg: "User verified",
        token: jwtToken,
        user: tokenPayload,
      });
    } else {
      jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);
      res.status(200).json({
        ok: true,
        msg: "User verified",
        token: jwtToken,
        user: tokenPayload,
      });
    }
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Failed to fetch user data", error: error.message });
  }
};

module.exports = {
  getUserDetails,
  getFromAmemberUserDetails,
  fetchUserDataByName,
  fetchUserDataByName_Email,
};
