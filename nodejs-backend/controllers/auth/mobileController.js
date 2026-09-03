const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const axios = require("axios");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { google } = require("googleapis");
const { generateToken } = require("../../services/authService");
const UserProfile = require("../../Module/user/userProfileModel");
const MobileStoreTransaction = require("../../Module/mobilePayments/mobileStoreTransactionModel");
const MobileStoreWebhookEvent = require("../../Module/mobilePayments/mobileStoreWebhookEventModel");
const mobileStorePlans = require("../../config/mobileStorePlans");
const { fetchUserDataByName, syncUserProfile } = require("./authController");
const BrandsList = require("../../Module/brandNames/brandNamesSchema");

const apiKey = process.env.AMEMBER_API_KEY;
const baseUrl = process.env.AMEMBER_BASE_API_URL;
const secretKey = process.env.JWT_SECRET_KEY;
const tokenExpiryTime = process.env.TOKEN_EXPIRY_TIME || 1440;

function verifyAndDecodeAppleJWS(jwsString) {
  if (!jwsString) throw new Error("Empty Apple JWS token.");
  const parts = jwsString.split(".");
  if (parts.length !== 3) throw new Error("Invalid Apple JWS format.");

  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  if (header.alg !== "ES256") throw new Error("Unexpected Apple JWS algorithm.");
  if (!Array.isArray(header.x5c) || header.x5c.length < 3) {
    throw new Error("Apple JWS certificate chain is missing.");
  }

  const certificates = header.x5c.map(
    (certificate) => new crypto.X509Certificate(Buffer.from(certificate, "base64")),
  );
  for (let index = 0; index < certificates.length - 1; index += 1) {
    if (!certificates[index].verify(certificates[index + 1].publicKey)) {
      throw new Error("Apple JWS certificate chain verification failed.");
    }
  }

  return jwt.verify(
    jwsString,
    certificates[0].publicKey.export({ type: "spki", format: "pem" }),
    { algorithms: ["ES256"] },
  );
}

function validateApplePayload(payload) {
  const bundleId = process.env.APPLE_BUNDLE_ID;
  const envStr = process.env.APPLE_ENVIRONMENT;
  if (!bundleId || !envStr) {
    throw new Error("APPLE_BUNDLE_ID and APPLE_ENVIRONMENT are required.");
  }
  const expectedEnvironment =
    envStr.toLowerCase() === "sandbox" ? "Sandbox" : "Production";
  if (payload.bundleId !== bundleId || payload.environment !== expectedEnvironment) {
    throw new Error("Apple JWS app identity does not match server configuration.");
  }
  return payload;
}

function generateAppleServerApiToken() {
  const privateKey = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const keyId = process.env.APPLE_KEY_ID;
  const issuerId = process.env.APPLE_ISSUER_ID;
  const bundleId = process.env.APPLE_BUNDLE_ID;
  if (!privateKey || !keyId || !issuerId || !bundleId) {
    throw new Error("Apple App Store Server API credentials are incomplete.");
  }
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: issuerId, iat: now - 30, exp: now + 20 * 60, aud: "appstoreconnect-v1", bid: bundleId },
    privateKey,
    { algorithm: "ES256", header: { alg: "ES256", kid: keyId, typ: "JWT" } },
  );
}

async function crossCheckAppleTransaction(payload, retries = 3) {
  const baseUrl =
    payload.environment === "Sandbox"
      ? "https://api.storekit-sandbox.itunes.apple.com/inApps/v1"
      : "https://api.storekit.itunes.apple.com/inApps/v1";

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(
        `${baseUrl}/transactions/${payload.transactionId}`,
        {
          headers: { Authorization: `Bearer ${generateAppleServerApiToken()}` },
          timeout: 15000,
        },
      );
      const serverPayload = validateApplePayload(
        verifyAndDecodeAppleJWS(response.data.signedTransactionInfo),
      );
      if (
        String(serverPayload.transactionId) !== String(payload.transactionId) ||
        String(serverPayload.originalTransactionId) !== String(payload.originalTransactionId) ||
        serverPayload.productId !== payload.productId
      ) {
        throw new Error("Apple transaction does not match App Store Server API data.");
      }
      return serverPayload;
    } catch (err) {
      const isRetryable = err.response && (err.response.status >= 500 || err.response.data?.errorCode === 5000001);
      if (isRetryable && attempt < retries) {
        console.warn(`[verifyApplePayment] Apple API 5000001/latency error (attempt ${attempt}/${retries}). Retrying in ${attempt * 2}s...`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      } else {
        throw err;
      }
    }
  }
}

function validateAppleWebhookTransaction(notificationType, payload) {
  const expiresAt = payload.expiresDate ? new Date(payload.expiresDate).getTime() : 0;
  const revoked = Boolean(payload.revocationDate);

  if (notificationType === "DID_RENEW") {
    return !revoked && expiresAt > Date.now();
  }
  if (notificationType === "EXPIRED") {
    return expiresAt > 0 && expiresAt <= Date.now();
  }
  if (notificationType === "REFUND" || notificationType === "REVOKE") {
    return revoked;
  }
  return true;
}

// Initialize Firebase Admin if credentials present
if (getApps().length === 0) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    privateKey = privateKey.replace(/\\n/g, "\n");
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }
}

// ── Shared Helper Functions ──────────────────────────────────────────────────

function isPlanActive(user) {
  const subscription = user?.userSubscriptionType || user?.subscriptions;
  if (!subscription || Object.keys(subscription).length === 0) return false;

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
  return Date.now() <= expiryUTC;
}

function generateRandomString(length = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let res = "";
  for (let i = 0; i < length; i++) {
    res += chars.charAt(crypto.randomInt(0, chars.length));
  }
  return res;
}

function emailToLogin(email) {
  const prefix = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "_");
  return `${prefix}_${crypto.randomInt(1000, 10000)}`;
}

async function verifyFirebaseToken(idToken) {
  if (!idToken) {
    const error = new Error("Authentication token is missing. Please try signing in again.");
    error.code = "ID_TOKEN_REQUIRED";
    error.status = 400;
    throw error;
  }
  if (getApps().length === 0) {
    const error = new Error("Firebase authentication is not configured on the server.");
    error.code = "FIREBASE_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  try {
    return await getAuth(getApps()[0]).verifyIdToken(idToken, true);
  } catch (err) {
    console.error("[mobileController] Firebase verifyIdToken error:", err.message);
    const error = new Error("Invalid, revoked, or expired Firebase ID token.");
    error.code = "INVALID_FIREBASE_TOKEN";
    error.status = 401;
    throw error;
  }
}

function normalizePhoneNumber(value) {
  const phoneNumber = String(value || "").trim();
  const digitCount = phoneNumber.replace(/\D/g, "").length;
  return digitCount >= 7 && digitCount <= 15 ? phoneNumber : null;
}

async function createAmemberUser({ login, email, password, firstName, lastName, phoneNumber }) {
  const url = `${baseUrl}/users`;
  const params = new URLSearchParams({
    _key: apiKey,
    login: login.toLowerCase(),
    email: email.toLowerCase(),
    pass: password,
    name_f: firstName || "",
    name_l: lastName || "",
    phone: phoneNumber,
  });


  const response = await axios.post(url, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const data = response.data;
  if (Array.isArray(data) && data.length > 0) return data[0];
  if (data && data.user_id) return data;
  if (data && typeof data === "object") {
    const firstKey = Object.keys(data)[0];
    if (data[firstKey]?.user_id) return data[firstKey];
  }
  throw new Error("Failed to parse created aMember user response.");
}

async function updateAmemberPassword(amemberUserId, newPassword) {
  if (!amemberUserId || !newPassword) return;
  try {
    const url = `${baseUrl}/users/${amemberUserId}?_key=${apiKey}`;
    const params = new URLSearchParams();
    params.append("pass", newPassword);
    await axios.put(url, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch (e) {
    console.error("[updateAmemberPassword] error updating password in aMember:", e.message);
  }
}

async function updateAmemberPhone(amemberUserId, phoneNumber) {
  if (!amemberUserId || !phoneNumber) return;
  const url = `${baseUrl}/users/${amemberUserId}?_key=${apiKey}`;
  const params = new URLSearchParams({ phone: phoneNumber });
  await axios.put(url, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

async function findUserByEmailOrFirebaseUid({ email, firebaseUid }) {
  const conditions = [];
  if (firebaseUid) conditions.push({ firebase_uid: firebaseUid });
  if (email) conditions.push({ email: email.toLowerCase() });

  const mongoProfile = conditions.length > 0 ? await UserProfile.findOne({ $or: conditions, is_deleted: { $ne: true } }) : null;

  let amemberUser = null;
  if (email) {
    try {
      const url = `${baseUrl}/users?_key=${apiKey}&_filter[email]=${encodeURIComponent(email.toLowerCase())}`;
      const response = await axios.get(url);
      const data = response.data;
      if (Array.isArray(data) && data.length > 0) amemberUser = data[0];
      else if (data && typeof data === "object" && Object.keys(data).length > 0) {
        const firstKey = Object.keys(data)[0];
        if (data[firstKey]?.user_id) amemberUser = data[firstKey];
      }
    } catch (e) {
      console.error("[mobileController] error looking up aMember user by email:", e.message);
    }
  }

  return { mongoProfile, amemberUser };
}

// ── aMember Direct Product Resolution ───────────────────────────────────────

let amemberProductsCache = null;
let amemberProductsCacheExpiry = 0;
let amemberProductCategoriesCache = null;
let amemberProductCategoriesCacheExpiry = 0;

async function getAmemberProducts() {
  if (!amemberProductsCache || Date.now() > amemberProductsCacheExpiry) {
    try {
      const apiHost = baseUrl || "https://adsgpt-dev.poweradspy.com/amember/api";
      const pageSize = 100;
      const allProducts = [];
      let page = 0;
      let pageProducts = [];

      do {
        const res = await axios.get(`${apiHost}/products`, {
          params: { _key: apiKey, _count: pageSize, _page: page },
        });
        let products = res.data;
        if (
          products &&
          typeof products === "object" &&
          !Array.isArray(products)
        ) {
          products = Object.values(products);
        }
        pageProducts = Array.isArray(products)
          ? products.filter(
            (product) =>
              product &&
              typeof product === "object" &&
              product.product_id,
          )
          : [];
        allProducts.push(...pageProducts);
        page += 1;
      } while (pageProducts.length === pageSize);

      amemberProductsCache = allProducts;
      amemberProductsCacheExpiry = Date.now() + 5 * 60 * 1000;
    } catch (e) {
      console.error("[mobileController] fetch products error:", e.message);
    }
  }
  return amemberProductsCache || [];
}

async function getAmemberProductCategoryMap() {
  if (amemberProductCategoriesCache && Date.now() < amemberProductCategoriesCacheExpiry) {
    return amemberProductCategoriesCache;
  }

  try {
    const apiHost = (baseUrl || "").replace(/\/+$/, "");
    const response = await axios.get(`${apiHost}/product-category`, {
      params: { _key: apiKey },
    });
    const rows = Array.isArray(response.data) ? response.data : Object.values(response.data || {});
    const categoryMap = new Map(
      rows
        .filter((row) => row && typeof row === "object")
        .map((row) => {
          const id = String(row.product_category_id || row.id || "").trim();
          const title = String(row.title || row.name || "").trim();
          return id && title ? [id, title] : null;
        })
        .filter(Boolean),
    );
    amemberProductCategoriesCache = categoryMap;
    amemberProductCategoriesCacheExpiry = Date.now() + 5 * 60 * 1000;
  } catch (error) {
    console.error("[mobileController] fetch product categories error:", error.message);
    amemberProductCategoriesCache = new Map();
    amemberProductCategoriesCacheExpiry = Date.now() + 60 * 1000;
  }

  return amemberProductCategoriesCache;
}

function getConfiguredProductCredit(product) {
  const value = product?.credit;
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const credit = Number.parseInt(value, 10);
  return Number.isNaN(credit) ? null : credit;
}

function getStorePlanDescriptor(storePlan) {
  const productId = String(storePlan?.productId || "").toLowerCase();
  const segments = productId.split(".");
  const tier = ["scale", "growth", "creator", "individual", "starter"].find(
    (candidate) => segments.includes(candidate),
  );
  if (!tier) return null;
  return { tier, isAnnual: segments.includes("annual") };
}

function getProductCategoryIds(product) {
  const rows = product?.nested?.["product-product-category"];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => String(row?.product_category_id || "").trim())
    .filter(Boolean);
}

function hasMobileCategory(product, categoryMap) {
  return getProductCategoryIds(product).some((categoryId) => {
    const categoryTitle = String(categoryMap?.get(categoryId) || "").trim().toLowerCase();
    return categoryTitle === "mobile";
  });
}

function getProductCreditNumber(product) {
  const value = Number.parseFloat(product?.credit);
  return Number.isFinite(value) ? value : null;
}

function getProductSortOrderNumber(product) {
  const value = Number.parseInt(product?.sort_order, 10);
  return Number.isFinite(value) ? value : null;
}

function resolveAmemberProduct(products, storePlan, categoryMap) {
  const descriptor = getStorePlanDescriptor(storePlan);
  if (!descriptor) return null;

  const candidates = products
    .filter((product) => {
      if (!product || product.is_disabled === "1" || product.is_archived === "1") {
        return false;
      }
      const titleWords = String(product.title || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      const isAnnual = titleWords.includes("annual") || titleWords.includes("yearly");
      return (
        titleWords.includes(descriptor.tier) &&
        isAnnual === descriptor.isAnnual &&
        hasMobileCategory(product, categoryMap)
      );
    });

  return candidates
    .sort((left, right) => {
      const leftSortOrder = getProductSortOrderNumber(left);
      const rightSortOrder = getProductSortOrderNumber(right);
      if (leftSortOrder !== null && rightSortOrder !== null && leftSortOrder !== rightSortOrder) {
        return leftSortOrder - rightSortOrder;
      }
      if (leftSortOrder !== null && rightSortOrder === null) return -1;
      if (leftSortOrder === null && rightSortOrder !== null) return 1;
      return Number.parseInt(left.product_id, 10) - Number.parseInt(right.product_id, 10);
    })[0] || null;
}

function findConfiguredStorePlan(storeProductId) {
  const targetId = String(storeProductId || "").trim();
  return Object.values(mobileStorePlans)
    .flat()
    .find((plan) => plan.productId === targetId) || null;
}

async function matchAmemberProduct(storeProductId) {
  const prods = await getAmemberProducts();
  const categoryMap = await getAmemberProductCategoryMap();
  const targetId = String(storeProductId || "").trim();
  const storePlan = findConfiguredStorePlan(targetId);
  const matched = storePlan ? resolveAmemberProduct(prods, storePlan, categoryMap) : null;

  if (!matched) {
    const error = new Error("The selected subscription plan is currently unavailable. Please contact support.");
    error.code = "PRODUCT_NOT_MAPPED";
    error.status = 422;
    throw error;
  }

  const amemberProductId = parseInt(matched.product_id, 10);
  const title = matched?.title || "AdsGPT Subscription";
  const billingPlanId = matched?.default_billing_plan_id || amemberProductId;
  const targetIdLower = targetId.toLowerCase();
  const titleLower = (matched.title || "").toLowerCase();
  const isAnnual =
    targetIdLower.includes("annual") ||
    targetIdLower.includes("year") ||
    titleLower.includes("annual") ||
    titleLower.includes("year");

  return {
    amember_product_id: amemberProductId,
    amember_billing_plan_id: billingPlanId,
    title,
    period: isAnnual ? "1y" : "1m",
    amemberProduct: matched,
  };
}

async function matchAmemberFreeTrialProduct() {
  const prods = await getAmemberProducts();
  const trialPlanId = process.env.TRIAL_PLAN_ID || "8";

  let matched = prods.find(
    (product) =>
      product &&
      product.is_disabled !== "1" &&
      product.is_archived !== "1" &&
      String(product.product_id) === String(trialPlanId),
  );

  if (!matched) {
    matched = prods.find((product) => {
      if (!product || product.is_disabled === "1" || product.is_archived === "1") return false;
      const titleWords = String(product.title || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      return titleWords.includes("free");
    });
  }

  if (!matched && prods.length > 0) {
    matched = prods[0];
  }

  const amemberProductId = matched ? parseInt(matched.product_id, 10) : parseInt(trialPlanId, 10);
  const title = matched?.title || "Free Trial";
  const billingPlanId = matched?.default_billing_plan_id || amemberProductId;

  return {
    amember_product_id: amemberProductId,
    amember_billing_plan_id: billingPlanId,
    title,
    period: "7d",
    amemberProduct: matched,
  };
}

function formatDateForAmember(date) {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function postAmemberInvoice({
  amemberUserId,
  canonicalTransactionId,
  platform,
  storeProductId,
  matchedProduct,
  amount,
  currency,
  purchasedAt,
  expiresAt,
}) {
  // Expire any existing active access records in aMember for this user before granting new access
  try {
    const todayStr = formatDateForAmember(new Date());
    const userAccessResp = await axios.get(`${baseUrl}/access`, {
      params: { _key: apiKey, "_filter[user_id]": String(amemberUserId) },
    });
    const accessRecords = Array.isArray(userAccessResp.data)
      ? userAccessResp.data
      : Object.values(userAccessResp.data || {});
    for (const acc of accessRecords) {
      if (acc && acc.access_id && acc.expire_date && acc.expire_date > todayStr) {
        const expireParams = new URLSearchParams({
          _key: apiKey,
          expire_date: todayStr,
        });
        await axios.put(`${baseUrl}/access/${acc.access_id}`, expireParams.toString(), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }).catch((e) => console.warn("[postAmemberInvoice] Could not expire previous access:", e.message));
      }
    }
  } catch (prevErr) {
    console.warn("[postAmemberInvoice] Warning checking previous active access:", prevErr.message);
  }

  // Expire previous active transactions in MongoDB MobileStoreTransaction
  await MobileStoreTransaction.updateMany(
    {
      amember_user_id: String(amemberUserId),
      canonical_transaction_id: { $ne: canonicalTransactionId },
      expires_at: { $gt: new Date() },
    },
    {
      $set: {
        expires_at: new Date(),
        "meta.replaced_by": canonicalTransactionId,
        "meta.replaced_at": new Date(),
      },
    }
  ).catch((err) => console.warn("[postAmemberInvoice] Expire previous active transactions warning:", err.message));

  const publicId = `${platform}_${canonicalTransactionId}`;
  const paysysId = platform === "ios" ? "app-store" : "google-play";
  const beginDateStr = formatDateForAmember(purchasedAt);
  const expireDateStr = formatDateForAmember(expiresAt);
  const numericAmount = typeof amount === "number" && !Number.isNaN(amount) ? amount : (parseFloat(amount) || 0);
  const formattedAmount = numericAmount.toFixed(2);

  const payload = new URLSearchParams();
  payload.append("_key", apiKey);
  payload.append("public_id", publicId);
  payload.append("user_id", String(amemberUserId));
  payload.append("paysys_id", paysysId);
  payload.append("currency", currency || "USD");
  payload.append("first_subtotal", formattedAmount);
  payload.append("first_discount", "0.00");
  payload.append("first_tax", "0.00");
  payload.append("first_shipping", "0.00");
  payload.append("first_total", formattedAmount);
  payload.append("first_period", matchedProduct.period);
  payload.append("rebill_times", "0");
  payload.append("is_confirmed", "1");
  payload.append("status", "1");

  payload.append("nested[invoice-items][0][invoice_public_id]", publicId);
  payload.append("nested[invoice-items][0][item_id]", String(matchedProduct.amember_product_id));
  payload.append("nested[invoice-items][0][item_type]", "product");
  payload.append("nested[invoice-items][0][item_title]", matchedProduct.title);
  payload.append("nested[invoice-items][0][item_description]", storeProductId);
  payload.append("nested[invoice-items][0][qty]", "1");
  payload.append("nested[invoice-items][0][first_discount]", "0.00");
  payload.append("nested[invoice-items][0][first_price]", formattedAmount);
  payload.append("nested[invoice-items][0][first_tax]", "0.00");
  payload.append("nested[invoice-items][0][first_shipping]", "0.00");
  payload.append("nested[invoice-items][0][first_total]", formattedAmount);
  payload.append("nested[invoice-items][0][first_period]", matchedProduct.period);
  payload.append("nested[invoice-items][0][rebill_times]", "0");
  payload.append("nested[invoice-items][0][currency]", currency || "USD");
  payload.append("nested[invoice-items][0][billing_plan_id]", String(matchedProduct.amember_billing_plan_id));

  payload.append("nested[invoice-payments][0][invoice_public_id]", publicId);
  payload.append("nested[invoice-payments][0][user_id]", String(amemberUserId));
  payload.append("nested[invoice-payments][0][paysys_id]", paysysId);
  payload.append("nested[invoice-payments][0][receipt_id]", canonicalTransactionId);
  payload.append("nested[invoice-payments][0][transaction_id]", canonicalTransactionId);
  payload.append("nested[invoice-payments][0][currency]", currency || "USD");
  payload.append("nested[invoice-payments][0][amount]", formattedAmount);

  payload.append("nested[access][0][invoice_public_id]", publicId);
  payload.append("nested[access][0][user_id]", String(amemberUserId));
  payload.append("nested[access][0][product_id]", String(matchedProduct.amember_product_id));
  payload.append("nested[access][0][transaction_id]", canonicalTransactionId);
  payload.append("nested[access][0][begin_date]", beginDateStr);
  payload.append("nested[access][0][expire_date]", expireDateStr);

  const res = await axios.post(`${baseUrl}/invoices`, payload.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  // Explicitly grant product access in aMember /access table
  try {
    const accessPayload = new URLSearchParams({
      _key: apiKey,
      user_id: String(amemberUserId),
      product_id: String(matchedProduct.amember_product_id),
      begin_date: beginDateStr,
      expire_date: expireDateStr,
    });
    await axios.post(`${baseUrl}/access`, accessPayload.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch (accessErr) {
    console.error("[postAmemberInvoice] aMember access post warning:", accessErr.message);
  }

  // Update user status to Active (1) in aMember
  try {
    const userParams = new URLSearchParams({
      _key: apiKey,
      status: "1",
    });
    await axios.put(`${baseUrl}/users/${amemberUserId}`, userParams.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch (userErr) {
    console.error("[postAmemberInvoice] aMember user status update warning:", userErr.message);
  }

  return res.data;
}

async function activateAmemberUserStatus({
  amemberUserId,
  matchedProduct,
  purchasedAt,
  expiresAt,
}) {
  try {
    const beginDateStr = formatDateForAmember(purchasedAt);
    const expireDateStr = formatDateForAmember(expiresAt);
    const accessPayload = new URLSearchParams({
      _key: apiKey,
      user_id: String(amemberUserId),
      product_id: String(matchedProduct.amember_product_id),
      begin_date: beginDateStr,
      expire_date: expireDateStr,
    });
    await axios.post(`${baseUrl}/access`, accessPayload.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch (accessErr) {
    console.warn("[activateAmemberUserStatus] Access post info:", accessErr.message);
  }

  try {
    const userParams = new URLSearchParams({
      _key: apiKey,
      status: "1",
    });
    await axios.put(`${baseUrl}/users/${amemberUserId}`, userParams.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch (userErr) {
    console.warn("[activateAmemberUserStatus] User status update info:", userErr.message);
  }
}

async function deleteAmemberInvoice(platform, canonicalTransactionId) {
  const publicId = `${platform}_${canonicalTransactionId}`;
  try {
    const fetchRes = await axios.get(`${baseUrl}/invoices?_key=${apiKey}&_filter[public_id]=${publicId}`);
    const data = fetchRes.data;
    const invoices = Array.isArray(data) ? data : Object.values(data || {});

    for (const inv of invoices) {
      if (inv && inv.invoice_id) {
        await axios.delete(`${baseUrl}/invoices/${inv.invoice_id}?_key=${apiKey}`);
        console.log(`[deleteAmemberInvoice] Deleted invoice ${inv.invoice_id} for ${publicId}`);
      }
    }
  } catch (err) {
    console.error("[deleteAmemberInvoice] Failed to delete invoice from aMember:", err.message);
  }
}

// ── Auth Handlers ────────────────────────────────────────────────────────────

const MobileSignup = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Native email/password mobile signup'
    #swagger.description = 'Creates a new aMember user and Mongo UserProfile without requiring initial payment.'
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: '#/components/schemas/mobileSignupPayload' }
        }
      }
    }
    #swagger.responses[201] = {
      description: 'Successfully created user',
      schema: { $ref: '#/components/schemas/mobileAuthResponse' }
    }
  */
  try {
    const { email, password, firstName, lastName, phoneNumber, platform } = req.body;
    if (!email || !password) {
      return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "Email and password are required." });
    }
    let cleanPhoneNumber = "";
    if (phoneNumber !== undefined && phoneNumber !== null && String(phoneNumber).trim() !== "") {
      cleanPhoneNumber = normalizePhoneNumber(phoneNumber);
      if (!cleanPhoneNumber) {
        return res.status(400).json({ ok: false, code: "INVALID_PHONE_NUMBER", error: "A valid phone number is required." });
      }
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanLogin = cleanEmail;

    const { mongoProfile, amemberUser } = await findUserByEmailOrFirebaseUid({ email: cleanEmail });
    if (mongoProfile || amemberUser) {
      const amemberUserId = amemberUser?.user_id || mongoProfile?.amember_user_id;
      const userData = await fetchUserDataByName(amemberUser?.login || mongoProfile?.login || cleanLogin);
      const active = userData?.ok ? isPlanActive(userData) : false;

      if (!active) {
        // Sync the updated password to aMember so user can log in with the new password typed during re-signup
        if (password && amemberUserId) {
          await updateAmemberPassword(amemberUserId, password);
        }
        await updateAmemberPhone(amemberUserId, cleanPhoneNumber);
        if (mongoProfile) {
          mongoProfile.phoneNumber = cleanPhoneNumber;
          await mongoProfile.save();
        }

        // Pending unpaid user who abandoned checkout — route directly to SELECT_PLAN!
        const tokenPayload = {
          status: true,
          user_id: amemberUserId,
          login: amemberUser?.login || mongoProfile?.login || cleanLogin,
          user_email: cleanEmail,
          hasActivePlan: false,
          userSubscriptionType: {},
          created_from: "GPT",
        };
        const jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);
        return res.status(200).json({
          ok: true,
          token: jwtToken,
          isNewUser: false,
          user: {
            user_id: amemberUserId,
            login: amemberUser?.login || mongoProfile?.login || cleanLogin,
            user_name: mongoProfile?.name || `${firstName || ""} ${lastName || ""}`.trim(),
            name_f: mongoProfile?.name_f || firstName || "",
            name_l: mongoProfile?.name_l || lastName || "",
            phoneNumber: cleanPhoneNumber,
            user_email: cleanEmail,
            userSubscriptionType: {},
            hasActivePlan: false,
            created_from: "GPT",
          },
          nextAction: "SELECT_PLAN",
        });
      }

      return res.status(409).json({
        ok: false,
        code: "ACCOUNT_ALREADY_EXISTS",
        error: "An account with this email address already exists. Please log in to continue.",
      });
    }

    const newAmemberUser = await createAmemberUser({ login: cleanLogin, email: cleanEmail, password, firstName, lastName, phoneNumber: cleanPhoneNumber });
    const amemberUserId = String(newAmemberUser.user_id || newAmemberUser.id);

    const existingDeletedProfile = await UserProfile.findOne({ email: cleanEmail });
    if (existingDeletedProfile) {
      existingDeletedProfile.is_deleted = false;
      existingDeletedProfile.deleted_at = null;
      existingDeletedProfile.delete_reason = "";
      existingDeletedProfile.user_id = `GPT-${amemberUserId}`;
      existingDeletedProfile.amember_user_id = amemberUserId;
      existingDeletedProfile.login = cleanLogin;
      existingDeletedProfile.name = `${firstName || ""} ${lastName || ""}`.trim();
      existingDeletedProfile.name_f = firstName || "";
      existingDeletedProfile.name_l = lastName || "";
      existingDeletedProfile.phoneNumber = cleanPhoneNumber;
      existingDeletedProfile.platform = platform || "";
      existingDeletedProfile.last_login_at = new Date();
      await existingDeletedProfile.save();
    } else {
      await UserProfile.create({
        user_id: `GPT-${amemberUserId}`,
        login: cleanLogin,
        name: `${firstName || ""} ${lastName || ""}`.trim(),
        name_f: firstName || "",
        name_l: lastName || "",
        phoneNumber: cleanPhoneNumber,
        email: cleanEmail,
        created_from: "GPT",
        amember_user_id: amemberUserId,
        loginProviders: ["general"],
        last_login_at: new Date(),
        platform: platform || "",
      });
    }

    const tokenPayload = {
      status: true,
      user_id: amemberUserId,
      login: cleanLogin,
      user_name: `${firstName || ""} ${lastName || ""}`.trim(),
      user_email: cleanEmail,
      name_f: firstName || "",
      name_l: lastName || "",
      phoneNumber: cleanPhoneNumber,
      userSubscriptionType: {},
      hasActivePlan: false,
      created_from: "GPT",
    };

    const jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);

    return res.status(201).json({
      ok: true,
      token: jwtToken,
      user: {
        user_id: amemberUserId,
        login: cleanLogin,
        user_name: `${firstName || ""} ${lastName || ""}`.trim(),
        name_f: firstName || "",
        name_l: lastName || "",
        phoneNumber: cleanPhoneNumber,
        user_email: cleanEmail,
        userSubscriptionType: {},
        hasActivePlan: false,
        created_from: "GPT",
      },
      nextAction: "SELECT_PLAN",
    });
  } catch (error) {
    console.error("[MobileSignup] error:", error);
    return res.status(error.status || 500).json({
      ok: false,
      code: error.code || "INTERNAL_ERROR",
      error: error.message || "Signup failed. Please try again.",
    });
  }
};

const GoogleSignup = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Firebase Google social signup'
    #swagger.description = 'Verifies Firebase ID token, creates aMember user and Mongo UserProfile.'
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: '#/components/schemas/googleSignupPayload' }
        }
      }
    }
    #swagger.responses[201] = {
      description: 'Successfully registered Google user',
      schema: { $ref: '#/components/schemas/mobileAuthResponse' }
    }
  */
  try {
    const { firebaseIdToken, firstName, lastName, phoneNumber, platform, email: bodyEmail } = req.body;
    let cleanPhoneNumber = "";
    if (phoneNumber !== undefined && phoneNumber !== null && String(phoneNumber).trim() !== "") {
      cleanPhoneNumber = normalizePhoneNumber(phoneNumber);
      if (!cleanPhoneNumber) {
        return res.status(400).json({ ok: false, code: "INVALID_PHONE_NUMBER", error: "A valid phone number is required." });
      }
    }
    const decoded = await verifyFirebaseToken(firebaseIdToken);
    if (decoded.firebase?.sign_in_provider !== "google.com") {
      return res.status(400).json({ ok: false, code: "INVALID_PROVIDER", error: "Please use Google to sign in to this endpoint." });
    }
    if (decoded.email && bodyEmail && decoded.email.toLowerCase() !== bodyEmail.toLowerCase()) {
      return res.status(400).json({ ok: false, code: "EMAIL_MISMATCH", error: "The provided email does not match the authenticated account." });
    }
    const email = (decoded.email || bodyEmail) ? (decoded.email || bodyEmail).toLowerCase() : null;
    const firebaseUid = decoded.uid;

    if (!email) {
      return res.status(400).json({ ok: false, code: "INVALID_GOOGLE_TOKEN", error: "Google account must have a verified email address." });
    }

    const derivedFirstName = firstName || "";
    const derivedLastName = lastName || "";

    const { mongoProfile, amemberUser } = await findUserByEmailOrFirebaseUid({ email, firebaseUid });
    if (mongoProfile || amemberUser) {
      const amemberUserId = amemberUser?.user_id || mongoProfile?.amember_user_id;
      const userData = await fetchUserDataByName(amemberUser?.login || mongoProfile?.login || email);
      const active = userData?.ok ? isPlanActive(userData) : false;

      if (!active) {
        await updateAmemberPhone(amemberUserId, cleanPhoneNumber);
        if (mongoProfile) {
          mongoProfile.phoneNumber = cleanPhoneNumber;
          await mongoProfile.save();
        }
        // Pending unpaid user who abandoned checkout — route directly to SELECT_PLAN!
        const tokenPayload = {
          status: true,
          user_id: amemberUserId,
          firebase_uid: firebaseUid,
          auth_provider: "google.com",
          login: userData?.login || mongoProfile?.login || email,
          user_email: email,
          hasActivePlan: false,
          userSubscriptionType: {},
          created_from: "GPT",
        };
        const jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);
        return res.status(200).json({
          ok: true,
          token: jwtToken,
          isNewUser: false,
          user: {
            user_id: amemberUserId,
            firebase_uid: firebaseUid,
            auth_provider: "google.com",
            login: userData?.login || mongoProfile?.login || email,
            user_name: userData?.name || mongoProfile?.name || `${derivedFirstName} ${derivedLastName}`.trim(),
            name_f: userData?.name_f || mongoProfile?.name_f || derivedFirstName,
            name_l: userData?.name_l || mongoProfile?.name_l || derivedLastName,
            phoneNumber: cleanPhoneNumber,
            user_email: email,
            loginProviders: mongoProfile?.loginProviders || ["google"],
            userSubscriptionType: {},
            hasActivePlan: false,
          },
          nextAction: "SELECT_PLAN",
        });
      }

      return res.status(409).json({
        ok: false,
        code: "ACCOUNT_ALREADY_EXISTS",
        error: "An account with this email address already exists. Please log in using Google Login.",
      });
    }

    const generatedLogin = emailToLogin(email);
    const newAmemberUser = await createAmemberUser({
      login: generatedLogin,
      email,
      password: generateRandomString(16),
      firstName: derivedFirstName,
      lastName: derivedLastName,
      phoneNumber: cleanPhoneNumber,
    });

    const amemberUserId = String(newAmemberUser.user_id || newAmemberUser.id);

    const existingDeletedProfile = await UserProfile.findOne({
      $or: [{ email: email.toLowerCase() }, { firebase_uid: firebaseUid }],
    });

    if (existingDeletedProfile) {
      existingDeletedProfile.is_deleted = false;
      existingDeletedProfile.deleted_at = null;
      existingDeletedProfile.delete_reason = "";
      existingDeletedProfile.user_id = `GPT-${amemberUserId}`;
      existingDeletedProfile.amember_user_id = amemberUserId;
      existingDeletedProfile.firebase_uid = firebaseUid;
      existingDeletedProfile.login = generatedLogin;
      existingDeletedProfile.name = `${derivedFirstName} ${derivedLastName}`.trim();
      existingDeletedProfile.name_f = derivedFirstName;
      existingDeletedProfile.name_l = derivedLastName;
      existingDeletedProfile.phoneNumber = cleanPhoneNumber;
      existingDeletedProfile.platform = platform || "";
      if (!existingDeletedProfile.loginProviders?.includes("google")) {
        existingDeletedProfile.loginProviders = [...(existingDeletedProfile.loginProviders || []), "google"];
      }
      existingDeletedProfile.last_login_at = new Date();
      await existingDeletedProfile.save();
    } else {
      await UserProfile.create({
        user_id: `GPT-${amemberUserId}`,
        login: generatedLogin,
        name: `${derivedFirstName} ${derivedLastName}`.trim(),
        name_f: derivedFirstName,
        name_l: derivedLastName,
        phoneNumber: cleanPhoneNumber,
        email,
        created_from: "GPT",
        amember_user_id: amemberUserId,
        firebase_uid: firebaseUid,
        loginProviders: ["google"],
        last_login_at: new Date(),
        platform: platform || "",
      });
    }

    const tokenPayload = {
      status: true,
      user_id: amemberUserId,
      firebase_uid: firebaseUid,
      auth_provider: "google.com",
      login: generatedLogin,
      user_email: email,
      hasActivePlan: false,
      userSubscriptionType: {},
      created_from: "GPT",
    };

    const jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);

    return res.status(201).json({
      ok: true,
      token: jwtToken,
      isNewUser: true,
      user: {
        user_id: amemberUserId,
        firebase_uid: firebaseUid,
        auth_provider: "google.com",
        login: generatedLogin,
        user_name: `${derivedFirstName} ${derivedLastName}`.trim(),
        name_f: derivedFirstName,
        name_l: derivedLastName,
        phoneNumber: cleanPhoneNumber,
        user_email: email,
        userSubscriptionType: {},
        hasActivePlan: false,
        credits: { adCopy: 0, adCreative: 0 },
      },
      nextAction: "SELECT_PLAN",
    });
  } catch (error) {
    console.error("[GoogleSignup] error:", error);
    return res.status(error.status || 500).json({
      ok: false,
      code: error.code || "INVALID_GOOGLE_TOKEN",
      error: error.message || "Google sign-in failed.",
    });
  }
};

const GoogleLogin = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Firebase Google social login'
    #swagger.description = 'Verifies Firebase ID token, resolves existing account or links Google login provider.'
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: '#/components/schemas/googleLoginPayload' }
        }
      }
    }
    #swagger.responses[200] = {
      description: 'Successfully logged in Google user',
      schema: { $ref: '#/components/schemas/mobileAuthResponse' }
    }
  */
  try {
    const { firebaseIdToken, platform, email: bodyEmail } = req.body;
    const decoded = await verifyFirebaseToken(firebaseIdToken);
    if (decoded.firebase?.sign_in_provider !== "google.com") {
      return res.status(400).json({ ok: false, code: "INVALID_PROVIDER", error: "Please use Google to sign in to this endpoint." });
    }
    if (decoded.email && bodyEmail && decoded.email.toLowerCase() !== bodyEmail.toLowerCase()) {
      return res.status(400).json({ ok: false, code: "EMAIL_MISMATCH", error: "The provided email does not match the authenticated account." });
    }
    const email = (decoded.email || bodyEmail) ? (decoded.email || bodyEmail).toLowerCase() : null;
    const firebaseUid = decoded.uid;

    let { mongoProfile, amemberUser } = await findUserByEmailOrFirebaseUid({ email, firebaseUid });
    if (!mongoProfile && !amemberUser) {
      return res.status(404).json({
        ok: false,
        code: "USER_NOT_FOUND",
        error: "No account was found with this email. Please tap Sign Up to create your account.",
      });
    }

    const amemberUserId = amemberUser?.user_id || mongoProfile?.amember_user_id;

    if (mongoProfile) {
      if (!mongoProfile.firebase_uid) mongoProfile.firebase_uid = firebaseUid;
      if (!mongoProfile.loginProviders) mongoProfile.loginProviders = ["general"];
      if (!mongoProfile.loginProviders.includes("google")) mongoProfile.loginProviders.push("google");
      if (platform) mongoProfile.platform = platform;
      mongoProfile.last_login_at = new Date();
      await mongoProfile.save();
    }

    const userData = await fetchUserDataByName(amemberUser?.login || mongoProfile?.login);
    if (userData?.ok) {
      await syncUserProfile(userData);
      if (mongoProfile?._id) {
        mongoProfile = await UserProfile.findById(mongoProfile._id);
      }
    }
    const active = userData?.ok ? isPlanActive(userData) : false;

    const tokenPayload = {
      status: true,
      user_id: amemberUserId,
      firebase_uid: firebaseUid,
      auth_provider: "google.com",
      login: userData?.login || mongoProfile?.login,
      user_email: email,
      hasActivePlan: active,
      userSubscriptionType: userData?.subscriptions || {},
      created_from: "GPT",
    };

    const jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);

    const subscription = await getUserSubscriptionDetails(amemberUserId, userData, active);

    return res.status(200).json({
      ok: true,
      token: jwtToken,
      isNewUser: false,
      subscription,
      user: {
        user_id: amemberUserId,
        firebase_uid: firebaseUid,
        auth_provider: "google.com",
        login: userData?.login || mongoProfile?.login,
        user_name: userData?.name || mongoProfile?.name || "",
        name_f: userData?.name_f || mongoProfile?.name_f || "",
        name_l: userData?.name_l || mongoProfile?.name_l || "",
        user_email: email,
        loginProviders: mongoProfile?.loginProviders || ["google"],
        userSubscriptionType: userData?.subscriptions || {},
        hasActivePlan: active,
        credits: {
          adCopy: mongoProfile?.total_available_credits || 0,
          adCreative: mongoProfile?.remaining_topup_credits || 0,
        },
      },
      nextAction: active ? "OPEN_APP" : "SELECT_PLAN",
    });
  } catch (error) {
    console.error("[GoogleLogin] error:", error);
    return res.status(error.status || 500).json({
      ok: false,
      code: error.code || "INVALID_GOOGLE_TOKEN",
      error: error.message || "Google sign-in failed.",
    });
  }
};

const AppleSignup = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Firebase Apple social signup'
    #swagger.description = 'Verifies Firebase ID token, creates aMember user and Mongo UserProfile.'
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: '#/components/schemas/appleSignupPayload' }
        }
      }
    }
    #swagger.responses[201] = {
      description: 'Successfully registered Apple user',
      schema: { $ref: '#/components/schemas/mobileAuthResponse' }
    }
  */
  try {
    const { firebaseIdToken, firstName, lastName, phoneNumber, platform, email: bodyEmail } = req.body;
    let cleanPhoneNumber = "";
    if (phoneNumber !== undefined && phoneNumber !== null && String(phoneNumber).trim() !== "") {
      cleanPhoneNumber = normalizePhoneNumber(phoneNumber);
      if (!cleanPhoneNumber) {
        return res.status(400).json({ ok: false, code: "INVALID_PHONE_NUMBER", error: "A valid phone number is required." });
      }
    }
    const decoded = await verifyFirebaseToken(firebaseIdToken);
    if (decoded.firebase?.sign_in_provider !== "apple.com") {
      return res.status(400).json({ ok: false, code: "INVALID_PROVIDER", error: "Please use Apple to sign in to this endpoint." });
    }
    if (decoded.email && bodyEmail && decoded.email.toLowerCase() !== bodyEmail.toLowerCase()) {
      return res.status(400).json({ ok: false, code: "EMAIL_MISMATCH", error: "The provided email does not match the authenticated account." });
    }
    const email = (decoded.email || bodyEmail) ? (decoded.email || bodyEmail).toLowerCase() : null;
    const firebaseUid = decoded.uid;

    if (!email) {
      return res.status(400).json({ ok: false, code: "INVALID_APPLE_TOKEN", error: "Apple account must provide an email address." });
    }

    const derivedFirstName = firstName || "";
    const derivedLastName = lastName || "";

    const { mongoProfile, amemberUser } = await findUserByEmailOrFirebaseUid({ email, firebaseUid });
    if (mongoProfile || amemberUser) {
      const amemberUserId = amemberUser?.user_id || mongoProfile?.amember_user_id;
      const userData = await fetchUserDataByName(amemberUser?.login || mongoProfile?.login || email);
      const active = userData?.ok ? isPlanActive(userData) : false;

      if (!active) {
        await updateAmemberPhone(amemberUserId, cleanPhoneNumber);
        if (mongoProfile) {
          mongoProfile.phoneNumber = cleanPhoneNumber;
          await mongoProfile.save();
        }
        // Pending unpaid user who abandoned checkout — route directly to SELECT_PLAN!
        const tokenPayload = {
          status: true,
          user_id: amemberUserId,
          firebase_uid: firebaseUid,
          auth_provider: "apple.com",
          login: userData?.login || mongoProfile?.login || email,
          user_email: email,
          hasActivePlan: false,
          userSubscriptionType: {},
          created_from: "GPT",
        };
        const jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);
        return res.status(200).json({
          ok: true,
          token: jwtToken,
          isNewUser: false,
          user: {
            user_id: amemberUserId,
            firebase_uid: firebaseUid,
            auth_provider: "apple.com",
            login: userData?.login || mongoProfile?.login || email,
            user_name: userData?.name || mongoProfile?.name || `${derivedFirstName} ${derivedLastName}`.trim(),
            name_f: userData?.name_f || mongoProfile?.name_f || derivedFirstName,
            name_l: userData?.name_l || mongoProfile?.name_l || derivedLastName,
            phoneNumber: cleanPhoneNumber,
            user_email: email,
            loginProviders: mongoProfile?.loginProviders || ["apple"],
            userSubscriptionType: {},
            hasActivePlan: false,
          },
          nextAction: "SELECT_PLAN",
        });
      }

      return res.status(409).json({
        ok: false,
        code: "ACCOUNT_ALREADY_EXISTS",
        error: "An account with this email address already exists. Please log in using Apple Login.",
      });
    }

    const generatedLogin = emailToLogin(email);
    const newAmemberUser = await createAmemberUser({
      login: generatedLogin,
      email,
      password: generateRandomString(16),
      firstName: derivedFirstName,
      lastName: derivedLastName,
      phoneNumber: cleanPhoneNumber,
    });

    const amemberUserId = String(newAmemberUser.user_id || newAmemberUser.id);

    const existingDeletedProfile = await UserProfile.findOne({
      $or: [{ email: email.toLowerCase() }, { firebase_uid: firebaseUid }],
    });

    if (existingDeletedProfile) {
      existingDeletedProfile.is_deleted = false;
      existingDeletedProfile.deleted_at = null;
      existingDeletedProfile.delete_reason = "";
      existingDeletedProfile.user_id = `GPT-${amemberUserId}`;
      existingDeletedProfile.amember_user_id = amemberUserId;
      existingDeletedProfile.firebase_uid = firebaseUid;
      existingDeletedProfile.login = generatedLogin;
      existingDeletedProfile.name = `${derivedFirstName} ${derivedLastName}`.trim();
      existingDeletedProfile.name_f = derivedFirstName;
      existingDeletedProfile.name_l = derivedLastName;
      existingDeletedProfile.phoneNumber = cleanPhoneNumber;
      existingDeletedProfile.platform = platform || "ios";
      if (!existingDeletedProfile.loginProviders?.includes("apple")) {
        existingDeletedProfile.loginProviders = [...(existingDeletedProfile.loginProviders || []), "apple"];
      }
      existingDeletedProfile.last_login_at = new Date();
      await existingDeletedProfile.save();
    } else {
      await UserProfile.create({
        user_id: `GPT-${amemberUserId}`,
        login: generatedLogin,
        name: `${derivedFirstName} ${derivedLastName}`.trim(),
        name_f: derivedFirstName,
        name_l: derivedLastName,
        phoneNumber: cleanPhoneNumber,
        email,
        created_from: "GPT",
        amember_user_id: amemberUserId,
        firebase_uid: firebaseUid,
        loginProviders: ["apple"],
        last_login_at: new Date(),
        platform: platform || "ios",
      });
    }

    const tokenPayload = {
      status: true,
      user_id: amemberUserId,
      firebase_uid: firebaseUid,
      auth_provider: "apple.com",
      login: generatedLogin,
      user_email: email,
      hasActivePlan: false,
      userSubscriptionType: {},
      created_from: "GPT",
    };

    const jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);

    return res.status(201).json({
      ok: true,
      token: jwtToken,
      isNewUser: true,
      user: {
        user_id: amemberUserId,
        firebase_uid: firebaseUid,
        auth_provider: "apple.com",
        login: generatedLogin,
        user_name: `${derivedFirstName} ${derivedLastName}`.trim(),
        name_f: derivedFirstName,
        name_l: derivedLastName,
        phoneNumber: cleanPhoneNumber,
        user_email: email,
        userSubscriptionType: {},
        hasActivePlan: false,
        credits: { adCopy: 0, adCreative: 0 },
      },
      nextAction: "SELECT_PLAN",
    });
  } catch (error) {
    console.error("[AppleSignup] error:", error);
    return res.status(error.status || 500).json({
      ok: false,
      code: error.code || "INVALID_APPLE_TOKEN",
      error: error.message || "Apple sign-in failed.",
    });
  }
};

const AppleLogin = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Firebase Apple social login'
    #swagger.description = 'Verifies Firebase ID token, resolves existing account or links Apple login provider.'
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: '#/components/schemas/appleLoginPayload' }
        }
      }
    }
    #swagger.responses[200] = {
      description: 'Successfully logged in Apple user',
      schema: { $ref: '#/components/schemas/mobileAuthResponse' }
    }
  */
  try {
    const { firebaseIdToken, platform, email: bodyEmail } = req.body;
    const decoded = await verifyFirebaseToken(firebaseIdToken);
    if (decoded.firebase?.sign_in_provider !== "apple.com") {
      return res.status(400).json({ ok: false, code: "INVALID_PROVIDER", error: "Please use Apple to sign in to this endpoint." });
    }
    if (decoded.email && bodyEmail && decoded.email.toLowerCase() !== bodyEmail.toLowerCase()) {
      return res.status(400).json({ ok: false, code: "EMAIL_MISMATCH", error: "The provided email does not match the authenticated account." });
    }
    const email = (decoded.email || bodyEmail) ? (decoded.email || bodyEmail).toLowerCase() : null;
    const firebaseUid = decoded.uid;

    let { mongoProfile, amemberUser } = await findUserByEmailOrFirebaseUid({ email, firebaseUid });
    if (!mongoProfile && !amemberUser) {
      return res.status(404).json({
        ok: false,
        code: "USER_NOT_FOUND",
        error: "No account was found with this email. Please tap Sign Up to create your account.",
      });
    }

    const amemberUserId = amemberUser?.user_id || mongoProfile?.amember_user_id;

    if (mongoProfile) {
      if (!mongoProfile.firebase_uid) mongoProfile.firebase_uid = firebaseUid;
      if (!mongoProfile.loginProviders) mongoProfile.loginProviders = ["general"];
      if (!mongoProfile.loginProviders.includes("apple")) mongoProfile.loginProviders.push("apple");
      mongoProfile.platform = platform || mongoProfile.platform || "ios";
      mongoProfile.last_login_at = new Date();
      await mongoProfile.save();
    }

    const userData = await fetchUserDataByName(amemberUser?.login || mongoProfile?.login);
    if (userData?.ok) {
      await syncUserProfile(userData);
      if (mongoProfile?._id) {
        mongoProfile = await UserProfile.findById(mongoProfile._id);
      }
    }
    const active = userData?.ok ? isPlanActive(userData) : false;

    const tokenPayload = {
      status: true,
      user_id: amemberUserId,
      firebase_uid: firebaseUid,
      auth_provider: "apple.com",
      login: userData?.login || mongoProfile?.login,
      user_email: email,
      hasActivePlan: active,
      userSubscriptionType: userData?.subscriptions || {},
      created_from: "GPT",
    };

    const jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);

    const subscription = await getUserSubscriptionDetails(amemberUserId, userData, active);

    return res.status(200).json({
      ok: true,
      token: jwtToken,
      isNewUser: false,
      subscription,
      user: {
        user_id: amemberUserId,
        firebase_uid: firebaseUid,
        auth_provider: "apple.com",
        login: userData?.login || mongoProfile?.login,
        user_name: userData?.name || mongoProfile?.name || "",
        name_f: userData?.name_f || mongoProfile?.name_f || "",
        name_l: userData?.name_l || mongoProfile?.name_l || "",
        user_email: email,
        loginProviders: mongoProfile?.loginProviders || ["apple"],
        userSubscriptionType: userData?.subscriptions || {},
        hasActivePlan: active,
        credits: {
          adCopy: mongoProfile?.total_available_credits || 0,
          adCreative: mongoProfile?.remaining_topup_credits || 0,
        },
      },
      nextAction: active ? "OPEN_APP" : "SELECT_PLAN",
    });
  } catch (error) {
    console.error("[AppleLogin] error:", error);
    return res.status(error.status || 500).json({
      ok: false,
      code: error.code || "INVALID_APPLE_TOKEN",
      error: error.message || "Apple sign-in failed.",
    });
  }
};


// ── Payment Verification Handlers ───────────────────────────────────────────

const APPLE_PROCESSING_LEASE_MS = 2 * 60 * 1000;

function appleOwnershipConflict(status, code, error) {
  return { ok: false, status, code, error };
}

async function resolveAppleSubscriptionOwnership({
  originalTransactionId,
  appAccountToken,
  subscriptionGroupIdentifier,
  amemberUserId,
}) {
  const legacyRows = await MobileStoreTransaction.find({
    platform: "ios",
    original_transaction_id: originalTransactionId,
  })
    .select("amember_user_id event_type lineage_owner trial_consumed app_account_token subscription_group_identifier raw_payload.appAccountToken")
    .sort({ createdAt: 1 });
  const legacyOwners = [...new Set(
    legacyRows.map((row) => String(row.amember_user_id || "")).filter(Boolean),
  )];

  // Existing conflicting rows cannot be assigned automatically. Choosing one
  // would transfer a paid subscription without authorization.
  if (legacyOwners.length > 1) {
    return appleOwnershipConflict(
      409,
      "account_transfer_required",
      "This Apple subscription is linked to multiple AdsGPT accounts and requires support review.",
    );
  }

  let ownership = legacyRows.find((row) => row.lineage_owner) || null;
  if (!ownership && legacyRows.length > 0) {
    const candidate = legacyRows[0];
    const legacyAppAccountToken = legacyRows
      .map((row) => row.app_account_token || row.raw_payload?.appAccountToken || "")
      .find(Boolean) || "";
    try {
      ownership = await MobileStoreTransaction.findOneAndUpdate(
        { _id: candidate._id, lineage_owner: { $ne: true } },
        {
          $set: {
            lineage_owner: true,
            trial_consumed: legacyRows.some((row) => row.event_type === "free_trial"),
            app_account_token: legacyAppAccountToken || appAccountToken,
            subscription_group_identifier:
              candidate.subscription_group_identifier || subscriptionGroupIdentifier,
          },
        },
        { new: true },
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    // A concurrent request may have promoted the same legacy row first,
    // causing findOneAndUpdate to return null rather than throw.
    if (!ownership) {
      ownership = await MobileStoreTransaction.findOne({
        platform: "ios",
        original_transaction_id: originalTransactionId,
        lineage_owner: true,
      });
    }
  }

  if (ownership && String(ownership.amember_user_id) !== String(amemberUserId)) {
    return appleOwnershipConflict(
      409,
      "subscription_already_linked",
      "This Apple subscription is already linked to another AdsGPT account.",
    );
  }

  if (appAccountToken) {
    const tokenOwnedElsewhere = await MobileStoreTransaction.exists({
      platform: "ios",
      amember_user_id: { $ne: String(amemberUserId) },
      $or: [
        { app_account_token: appAccountToken },
        { "raw_payload.appAccountToken": appAccountToken },
      ],
    });
    if (tokenOwnedElsewhere) {
      return appleOwnershipConflict(
        409,
        "account_transfer_required",
        "This Apple app account token is already associated with another AdsGPT account.",
      );
    }
    if (ownership?.app_account_token && ownership.app_account_token !== appAccountToken) {
      return appleOwnershipConflict(
        409,
        "account_transfer_required",
        "The Apple app account token does not match this subscription owner.",
      );
    }
    if (ownership && !ownership.app_account_token) ownership.app_account_token = appAccountToken;
  }

  if (ownership && !ownership.subscription_group_identifier && subscriptionGroupIdentifier) {
    ownership.subscription_group_identifier = subscriptionGroupIdentifier;
  }
  if (ownership?.isModified()) await ownership.save();

  return { ok: true, ownership };
}

async function acquireAppleTransactionProcessing(ownershipId, transactionId) {
  const now = new Date();
  return MobileStoreTransaction.findOneAndUpdate(
    {
      _id: ownershipId,
      lineage_owner: true,
      $or: [
        { processing_transaction_id: "" },
        { processing_transaction_id: null },
        { processing_transaction_id: { $exists: false } },
        { processing_expires_at: { $lte: now } },
      ],
    },
    {
      $set: {
        processing_transaction_id: transactionId,
        processing_expires_at: new Date(now.getTime() + APPLE_PROCESSING_LEASE_MS),
      },
    },
    { new: true },
  );
}

async function releaseAppleTransactionProcessing(ownershipId, transactionId) {
  await MobileStoreTransaction.updateOne(
    { _id: ownershipId, lineage_owner: true, processing_transaction_id: transactionId },
    { $set: { processing_transaction_id: "", processing_expires_at: null } },
  );
}

async function sendApplePaymentSuccess({
  req,
  res,
  amemberUserId,
  productId,
  matchedProduct,
  originalTransactionId,
  transactionId,
  expiresDate,
  idempotent = false,
}) {
  let userProfile = await UserProfile.findOne({ amember_user_id: amemberUserId });
  const userData = await fetchUserDataByName(userProfile?.login || req.user?.login);
  if (userData?.ok) {
    await syncUserProfile(userData);
    userProfile = await UserProfile.findOne({ amember_user_id: amemberUserId });
  }

  const amemberProdId = matchedProduct?.amember_product_id || 8;
  const subscriptionType = {
    [amemberProdId]: formatDateForAmember(expiresDate),
  };
  const tokenPayload = {
    status: true,
    user_id: amemberUserId,
    login: userProfile?.login || req.user?.login,
    user_email: userProfile?.email || req.user?.user_email,
    hasActivePlan: true,
    userSubscriptionType: subscriptionType,
    created_from: "GPT",
  };

  return res.status(200).json({
    ok: true,
    ...(idempotent ? { message: "Apple transaction already verified for this account." } : {}),
    ...(req.appleRestore ? { restoredCount: 1 } : {}),
    token: generateToken(tokenPayload, secretKey, tokenExpiryTime),
    subscription: {
      platform: "ios",
      store_product_id: productId,
      status: "active",
      original_transaction_id: originalTransactionId,
      latest_transaction_id: transactionId,
      expires_at: expiresDate,
    },
    credits: {
      adCopy: userProfile?.total_available_credits || 5000,
      adCreative: userProfile?.remaining_topup_credits || 1500,
    },
    user: {
      user_id: amemberUserId,
      login: userProfile?.login || req.user?.login,
      user_name: userProfile?.name || req.user?.user_name || "",
      name_f: userProfile?.name_f || req.user?.name_f || "",
      name_l: userProfile?.name_l || req.user?.name_l || "",
      user_email: userProfile?.email || req.user?.user_email,
      loginProviders: userProfile?.loginProviders || req.user?.loginProviders || [],
      hasActivePlan: true,
      userSubscriptionType: subscriptionType,
    },
  });
}

const verifyApplePayment = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'StoreKit 2 payment verification'
    #swagger.description = 'Verifies JWS transaction proof, matches aMember product, posts mirrored invoice, and unlocks active access.'
    #swagger.security = [{ "BearerAuth": [] }]
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: '#/components/schemas/verifyApplePaymentPayload' }
        }
      }
    }
    #swagger.responses[200] = {
      description: 'Verification successful',
      schema: { $ref: '#/components/schemas/mobilePaymentVerifyResponse' }
    }
  */
  try {
    const { signedTransaction } = req.body;
    const rawUserId = req.user?.user_id || req.user?.amember_user_id;
    const amemberUserId = String(rawUserId).replace(/^GPT-/, "");

    if (!signedTransaction) {
      return res.status(400).json({ ok: false, code: "STORE_PROOF_INVALID", error: "signedTransaction is required." });
    }

    let decoded;
    try {
      decoded = validateApplePayload(verifyAndDecodeAppleJWS(signedTransaction));
    } catch (e) {
      console.error("[verifyApplePayment] JWS verification failed:", e.message);
      return res.status(403).json({ ok: false, code: "STORE_PROOF_INVALID", error: "Invalid App Store signature." });
    }

    try {
      decoded = await crossCheckAppleTransaction(decoded);
    } catch (e) {
      console.error("[verifyApplePayment] App Store Server API check failed:", e.message, e.response?.data || e.stack);
      return res.status(403).json({ ok: false, code: "APPLE_SERVER_ERROR", error: "Apple could not confirm this transaction." });
    }

    const productId = decoded.productId;
    const transactionId = String(decoded.transactionId);
    const originalTransactionId = String(decoded.originalTransactionId || transactionId);
    const purchaseDate = decoded.purchaseDate ? new Date(decoded.purchaseDate) : new Date();
    const expiresDate = decoded.expiresDate ? new Date(decoded.expiresDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const offerDiscountType = String(decoded.offerDiscountType || "").toUpperCase();
    const isTrial =
      Number(decoded.offerType) === 1 &&
      (offerDiscountType === "FREE_TRIAL" || Number(decoded.price) === 0);

    let amount = 0.00;
    if (isTrial) {
      amount = 0.00;
    } else if (typeof decoded.price === "number") {
      amount = decoded.price / 1000.0;
    } else {
      amount = 0.00;
    }

    const appAccountToken = String(decoded.appAccountToken || "").trim();
    const subscriptionGroupIdentifier = String(decoded.subscriptionGroupIdentifier || "").trim();

    const ownershipResult = await resolveAppleSubscriptionOwnership({
      originalTransactionId,
      transactionId,
      appAccountToken,
      subscriptionGroupIdentifier,
      amemberUserId,
    });
    if (!ownershipResult.ok) {
      const conflictCode =
        req.appleRestore && ownershipResult.code === "subscription_already_linked"
          ? "restore_conflict"
          : ownershipResult.code;
      return res.status(ownershipResult.status).json({
        ok: false,
        code: conflictCode,
        error: ownershipResult.error,
      });
    }
    let ownership = ownershipResult.ownership;

    let existingTx = await MobileStoreTransaction.findOne({
      canonical_transaction_id: transactionId,
    });
    if (existingTx && String(existingTx.amember_user_id) !== String(amemberUserId)) {
      return res.status(409).json({
        ok: false,
        code: req.appleRestore ? "restore_conflict" : "subscription_already_linked",
        error: "This Apple subscription is already linked to another AdsGPT account.",
      });
    }

    // A verified record with the same transaction and owner is an idempotent
    // retry. Do not create another aMember invoice.
    if (existingTx && !existingTx.meta?.amember_sync_pending) {
      const existingMatchedProduct = existingTx.event_type === "free_trial"
        ? await matchAmemberFreeTrialProduct()
        : await matchAmemberProduct(existingTx.store_product_id || productId);
      return sendApplePaymentSuccess({
        req,
        res,
        amemberUserId,
        productId: existingTx.store_product_id || productId,
        matchedProduct: existingMatchedProduct,
        originalTransactionId,
        transactionId,
        expiresDate: existingTx.expires_at || expiresDate,
        idempotent: true,
      });
    }

    if (isTrial && ownership?.trial_consumed && !existingTx) {
      return res.status(409).json({
        ok: false,
        code: "trial_already_used",
        error: "The free trial for this Apple subscription has already been used.",
      });
    }

    const matchedProduct = isTrial
      ? await matchAmemberFreeTrialProduct()
      : await matchAmemberProduct(productId);
    const hadExistingLineage = Boolean(ownership);
    let lineageTx = existingTx || null;
    let processingAlreadyClaimed = false;

    const transactionValues = {
      user_id: `GPT-${amemberUserId}`,
      amember_user_id: amemberUserId,
      platform: "ios",
      canonical_transaction_id: transactionId,
      original_transaction_id: originalTransactionId,
      app_account_token: appAccountToken,
      subscription_group_identifier: subscriptionGroupIdentifier,
      trial_consumed: Boolean(ownership?.trial_consumed),
      store_product_id: productId,
      event_type: existingTx?.event_type || (isTrial ? "free_trial" : (hadExistingLineage ? "renewal" : "initial_purchase")),
      amount,
      currency: decoded.currency || "USD",
      amember_invoice_id: `ios_${transactionId}`,
      purchased_at: purchaseDate,
      expires_at: expiresDate,
      raw_payload: decoded,
      meta: {
        ...(lineageTx?.meta || {}),
        env: process.env.APPLE_ENVIRONMENT || "Production",
        amember_sync_pending: true,
        verification_state: "processing",
      },
    };

    // For a brand-new lineage, creating the transaction row with
    // lineage_owner=true is the atomic ownership claim. The partial unique
    // index permits only one owner for this Apple originalTransactionId.
    if (!ownership) {
      try {
        lineageTx = await MobileStoreTransaction.create({
          ...transactionValues,
          lineage_owner: true,
          processing_transaction_id: transactionId,
          processing_expires_at: new Date(Date.now() + APPLE_PROCESSING_LEASE_MS),
        });
        ownership = lineageTx;
        processingAlreadyClaimed = true;
      } catch (claimError) {
        if (claimError?.code !== 11000) throw claimError;
        const retryOwnership = await resolveAppleSubscriptionOwnership({
          originalTransactionId,
          appAccountToken,
          subscriptionGroupIdentifier,
          amemberUserId,
        });
        if (!retryOwnership.ok) {
          return res.status(retryOwnership.status).json({
            ok: false,
            code:
              req.appleRestore && retryOwnership.code === "subscription_already_linked"
                ? "restore_conflict"
                : retryOwnership.code,
            error: retryOwnership.error,
          });
        }
        ownership = retryOwnership.ownership;
        lineageTx = ownership;
      }
    }

    if (isTrial && ownership?.trial_consumed && !existingTx) {
      return res.status(409).json({
        ok: false,
        code: "trial_already_used",
        error: "The free trial for this Apple subscription has already been used.",
      });
    }

    if (!processingAlreadyClaimed) {
      const processingOwnership = await acquireAppleTransactionProcessing(
        ownership._id,
        transactionId,
      );
      if (!processingOwnership) {
        return res.status(409).json({
          ok: false,
          code: "purchase_processing",
          error: "This Apple transaction is already being processed. Please retry shortly.",
        });
      }
      ownership = processingOwnership;
    }

    if (!lineageTx) {
      lineageTx = new MobileStoreTransaction(transactionValues);
    }

    // Re-check after acquiring the lineage lease. Another request may have
    // completed between the initial read and this atomic claim.
    const completedTx = await MobileStoreTransaction.findOne({
      canonical_transaction_id: transactionId,
    });
    if (
      completedTx &&
      String(completedTx.amember_user_id) !== String(amemberUserId)
    ) {
      await releaseAppleTransactionProcessing(ownership._id, transactionId);
      return res.status(409).json({
        ok: false,
        code: req.appleRestore ? "restore_conflict" : "subscription_already_linked",
        error: "This Apple subscription is already linked to another AdsGPT account.",
      });
    }
    if (
      completedTx &&
      completedTx._id.toString() !== lineageTx._id.toString() &&
      !completedTx.meta?.amember_sync_pending
    ) {
      await releaseAppleTransactionProcessing(ownership._id, transactionId);
      const existingMatchedProduct = completedTx.event_type === "free_trial"
        ? await matchAmemberFreeTrialProduct()
        : await matchAmemberProduct(completedTx.store_product_id || productId);
      return sendApplePaymentSuccess({
        req,
        res,
        amemberUserId,
        productId: completedTx.store_product_id || productId,
        matchedProduct: existingMatchedProduct,
        originalTransactionId,
        transactionId,
        expiresDate: completedTx.expires_at || expiresDate,
        idempotent: true,
      });
    }

    Object.assign(lineageTx, transactionValues);
    try {
      await lineageTx.save();
    } catch (persistenceError) {
      await releaseAppleTransactionProcessing(ownership._id, transactionId);
      throw persistenceError;
    }

    try {
      await postAmemberInvoice({
        amemberUserId,
        canonicalTransactionId: transactionId,
        platform: "ios",
        storeProductId: productId,
        matchedProduct,
        amount,
        currency: decoded.currency || "USD",
        purchasedAt: purchaseDate,
        expiresAt: expiresDate,
      });
    } catch (invoiceErr) {
      await releaseAppleTransactionProcessing(ownership._id, transactionId);
      const detail = invoiceErr.response?.data?.error || invoiceErr.response?.data?.message || invoiceErr.message;
      console.error("[verifyApplePayment] aMember invoice failed:", detail);
      return res.status(422).json({
        ok: false,
        code: "AMEMBER_SYNC_FAILED",
        error: `aMember invoice sync failed: ${detail}`,
      });
    }

    await activateAmemberUserStatus({
      amemberUserId,
      matchedProduct,
      purchasedAt: purchaseDate,
      expiresAt: expiresDate,
    });

    lineageTx.trial_consumed = Boolean(lineageTx.trial_consumed || isTrial);
    lineageTx.meta = {
      ...(lineageTx.meta || {}),
      env: process.env.APPLE_ENVIRONMENT || "Production",
      amember_sync_pending: false,
      verification_state: "verified",
    };

    ownership.trial_consumed = Boolean(ownership.trial_consumed || isTrial);
    ownership.processing_transaction_id = "";
    ownership.processing_expires_at = null;
    if (ownership._id.toString() === lineageTx._id.toString()) {
      ownership.meta = lineageTx.meta;
      await ownership.save();
    } else {
      await lineageTx.save();
      await ownership.save();
    }

    return sendApplePaymentSuccess({
      req,
      res,
      amemberUserId,
      productId,
      matchedProduct,
      originalTransactionId,
      transactionId,
      expiresDate,
    });
  } catch (error) {
    console.error("[verifyApplePayment] error:", error);
    return res.status(500).json({ ok: false, code: "STORE_PROOF_INVALID", error: error.message || "App Store verification failed." });
  }
};

const verifyGooglePayment = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Google Play billing payment verification'
    #swagger.description = 'Verifies purchase token, matches aMember product, posts mirrored invoice, and unlocks active access.'
    #swagger.security = [{ "BearerAuth": [] }]
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: '#/components/schemas/verifyGooglePaymentPayload' }
        }
      }
    }
    #swagger.responses[200] = {
      description: 'Verification successful',
      schema: { $ref: '#/components/schemas/mobilePaymentVerifyResponse' }
    }
  */
  try {
    const { productId, purchaseToken, packageName } = req.body;
    const rawUserId = req.user?.user_id || req.user?.amember_user_id;
    const amemberUserId = String(rawUserId).replace(/^GPT-/, "");

    if (!productId || !purchaseToken) {
      return res.status(400).json({ ok: false, code: "STORE_PROOF_INVALID", error: "productId and purchaseToken are required." });
    }

    let subscriptionState;
    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        scopes: ["https://www.googleapis.com/auth/androidpublisher"],
      });
      const androidPublisher = google.androidpublisher({ version: 'v3', auth });
      const response = await androidPublisher.purchases.subscriptionsv2.get({
        packageName: packageName || process.env.GOOGLE_PLAY_PACKAGE_NAME || "io.adsgpt.app",
        token: purchaseToken,
      });
      subscriptionState = response.data;
    } catch (e) {
      console.error("[verifyGooglePayment] Google Developer API failed:", e.message);
      return res.status(403).json({ ok: false, code: "STORE_PROOF_INVALID", error: "Invalid Google Play purchase token." });
    }

    let isTrial = false;
    let amount = 0.00;
    let expiresDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const now = new Date();

    if (subscriptionState.lineItems && subscriptionState.lineItems.length > 0) {
      const item = subscriptionState.lineItems[0];
      if (item.expiryTime) {
        expiresDate = new Date(item.expiryTime);
      }
      if (item.offerDetails && item.offerDetails.offerTags && item.offerDetails.offerTags.includes("trial")) {
        isTrial = true;
      }
    }

    if (isTrial) {
      amount = 0.00;
    }

    const canonicalTxId = purchaseToken;
    let existingTx = await MobileStoreTransaction.findOne({ canonical_transaction_id: canonicalTxId });
    // If this transaction ID was already processed (by any user), reject it
    if (existingTx) {
      return res.status(409).json({
        ok: false,
        code: "TRANSACTION_ALREADY_USED",
        error: "This transaction ID has already been processed."
      });
    }

    const matchedProduct = isTrial
      ? await matchAmemberFreeTrialProduct()
      : await matchAmemberProduct(productId);

    try {
      await postAmemberInvoice({
        amemberUserId,
        canonicalTransactionId: canonicalTxId,
        platform: "android",
        storeProductId: productId,
        matchedProduct,
        amount,
        currency: "USD",
        purchasedAt: now,
        expiresAt: expiresDate,
      });
    } catch (invoiceErr) {
      const detail = invoiceErr.response?.data?.error || invoiceErr.response?.data?.message || invoiceErr.message;
      console.error("[verifyGooglePayment] aMember invoice failed:", detail);
      return res.status(422).json({
        ok: false,
        code: "AMEMBER_SYNC_FAILED",
        error: `aMember invoice sync failed: ${detail}`
      });
    }

    existingTx = await MobileStoreTransaction.create({
      user_id: `GPT-${amemberUserId}`,
      amember_user_id: amemberUserId,
      platform: "android",
      canonical_transaction_id: canonicalTxId,
      original_transaction_id: canonicalTxId,
      store_product_id: productId,
      event_type: isTrial ? "free_trial" : "initial_purchase",
      amount,
      currency: "USD",
      amember_invoice_id: `android_${canonicalTxId}`,
      purchased_at: now,
      expires_at: expiresDate,
      raw_payload: subscriptionState,
      meta: { packageName },
    });

    await activateAmemberUserStatus({
      amemberUserId,
      matchedProduct,
      purchasedAt: now,
      expiresAt: expiresDate,
    });

    let userProfile = await UserProfile.findOne({ amember_user_id: amemberUserId });
    const userData = await fetchUserDataByName(userProfile?.login || req.user?.login);
    if (userData?.ok) {
      await syncUserProfile(userData);
      userProfile = await UserProfile.findOne({ amember_user_id: amemberUserId });
    }

    const googleAmemberProdId = matchedProduct?.amember_product_id || 8;
    const tokenPayload = {
      status: true,
      user_id: amemberUserId,
      login: userProfile?.login || req.user?.login,
      user_email: userProfile?.email || req.user?.user_email,
      hasActivePlan: true,
      userSubscriptionType: { [googleAmemberProdId]: formatDateForAmember(expiresDate) },
      created_from: "GPT",
    };

    const jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);

    return res.status(200).json({
      ok: true,
      token: jwtToken,
      subscription: {
        platform: "android",
        store_product_id: productId,
        status: "active",
        latest_transaction_id: canonicalTxId,
        expires_at: expiresDate,
      },
      credits: {
        adCopy: userProfile?.total_available_credits || 5000,
        adCreative: userProfile?.remaining_topup_credits || 1500,
      },
      user: {
        user_id: amemberUserId,
        login: userProfile?.login || req.user?.login,
        user_name: userProfile?.name || req.user?.user_name || "",
        name_f: userProfile?.name_f || req.user?.name_f || "",
        name_l: userProfile?.name_l || req.user?.name_l || "",
        user_email: userProfile?.email || req.user?.user_email,
        loginProviders: userProfile?.loginProviders || req.user?.loginProviders || [],
        hasActivePlan: true,
        userSubscriptionType: { [googleAmemberProdId]: formatDateForAmember(expiresDate) },
      },
    });
  } catch (error) {
    console.error("[verifyGooglePayment] error:", error);
    return res.status(500).json({ ok: false, code: "STORE_PROOF_INVALID", error: error.message || "Google Play verification failed." });
  }
};

const restoreApplePurchases = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'StoreKit 2 restore purchases'
    #swagger.description = 'Reconciles one or more active StoreKit 2 entitlement JWS values for the authenticated user.'
    #swagger.security = [{ "BearerAuth": [] }]
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: '#/components/schemas/restoreApplePurchasesPayload' }
        }
      }
    }
  */
  const { signedTransaction, signedTransactionJwsList } = req.body || {};
  const transactions = Array.isArray(signedTransactionJwsList)
    ? signedTransactionJwsList.filter(
      (value) => typeof value === "string" && value.trim().length > 0,
    )
    : signedTransaction
      ? [signedTransaction]
      : [];

  if (transactions.length === 0) {
    return res.status(400).json({
      ok: false,
      code: "STORE_PROOF_INVALID",
      error: "signedTransactionJwsList must contain at least one Apple transaction.",
    });
  }

  req.appleRestore = true;
  let lastSuccess = null;
  const restoredTransactions = [];

  for (const jws of transactions) {
    let statusCode = 200;
    let responseBody = null;
    const captureResponse = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        responseBody = body;
        return body;
      },
    };
    req.body = { signedTransaction: jws, source: "ios" };
    await verifyApplePayment(req, captureResponse);

    if (!responseBody?.ok) {
      const code = responseBody?.code === "subscription_already_linked"
        ? "restore_conflict"
        : responseBody?.code || "verification_failed";
      return res.status(statusCode).json({
        ...responseBody,
        ok: false,
        code,
        msg: responseBody?.msg || responseBody?.error || "Restore failed.",
      });
    }
    lastSuccess = responseBody;
    restoredTransactions.push(responseBody.subscription);
  }

  return res.status(200).json({
    ...lastSuccess,
    ok: true,
    msg: "Apple purchases restored.",
    restoredCount: restoredTransactions.length,
    subscriptions: restoredTransactions,
  });
};

const restoreGooglePurchases = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Google Play restore purchases'
    #swagger.description = 'Reconciles active Google Play purchases for the currently authenticated user.'
    #swagger.security = [{ "BearerAuth": [] }]
    #swagger.responses[200] = {
      description: 'Purchases restored'
    }
  */
  try {
    const rawUserId = req.user?.user_id || req.user?.amember_user_id;
    const amemberUserId = String(rawUserId).replace(/^GPT-/, "");

    const activeTx = await MobileStoreTransaction.findOne({
      amember_user_id: amemberUserId,
      platform: "android",
      expires_at: { $gt: new Date() }
    }).sort({ expires_at: -1 });

    if (activeTx) {
      return res.status(200).json({
        ok: true,
        restoredCount: 1,
        entitlements: [activeTx],
        user: { user_id: amemberUserId, hasActivePlan: true }
      });
    }

    return res.status(200).json({ ok: true, restoredCount: 0, entitlements: [], user: { user_id: amemberUserId, hasActivePlan: false } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

async function getUserSubscriptionDetails(amemberUserId, userData, active) {
  try {
    const latestTx = await MobileStoreTransaction.findOne({
      amember_user_id: String(amemberUserId),
    }).sort({ createdAt: -1 });

    if (latestTx) {
      const isTxActive = active && new Date(latestTx.expires_at) > new Date();
      const platform = latestTx.platform || "ios";
      const manageUrl = platform === "ios"
        ? "https://apps.apple.com/account/subscriptions"
        : `https://play.google.com/store/account/subscriptions?sku=${latestTx.store_product_id || ""}&package=com.adsgpt.app`;

      return {
        hasActivePlan: Boolean(active),
        platform,
        source: platform,
        store_product_id: latestTx.store_product_id || "",
        status: isTxActive ? (latestTx.event_type === "free_trial" ? "free_trial" : "active") : (active ? "active" : "expired"),
        latest_transaction_id: latestTx.canonical_transaction_id || "",
        original_transaction_id: latestTx.original_transaction_id || latestTx.canonical_transaction_id || "",
        purchased_at: latestTx.purchased_at || null,
        expires_at: latestTx.expires_at || null,
        can_manage_in_app: true,
        manage_url: manageUrl,
      };
    }

    if (active) {
      return {
        hasActivePlan: true,
        platform: "web",
        source: "web",
        store_product_id: "",
        status: "active",
        latest_transaction_id: "",
        original_transaction_id: "",
        purchased_at: null,
        expires_at: null,
        can_manage_in_app: false,
        manage_url: "https://adsgpt.app/account",
      };
    }

    return {
      hasActivePlan: false,
      platform: null,
      source: null,
      store_product_id: null,
      status: "none",
      latest_transaction_id: null,
      original_transaction_id: null,
      purchased_at: null,
      expires_at: null,
      can_manage_in_app: false,
      manage_url: null,
    };
  } catch (err) {
    console.error("[getUserSubscriptionDetails] Error:", err.message);
    return {
      hasActivePlan: Boolean(active),
      platform: null,
      source: null,
      store_product_id: null,
      status: active ? "active" : "none",
      latest_transaction_id: null,
      original_transaction_id: null,
      purchased_at: null,
      expires_at: null,
      can_manage_in_app: false,
      manage_url: null,
    };
  }
}

const getSubscriptionStatus = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Get Subscription Status'
    #swagger.description = 'Returns the active subscription state, latest transaction ID, platform source, and management flags for the logged-in user.'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const rawUserId = req.user?.user_id || req.user?.amember_user_id;
    const amemberUserId = String(rawUserId).replace(/^GPT-/, "");

    const userProfile = await UserProfile.findOne({ amember_user_id: amemberUserId });
    const userData = await fetchUserDataByName(userProfile?.login || req.user?.login);
    const active = userData?.ok ? isPlanActive(userData) : false;

    const subscription = await getUserSubscriptionDetails(amemberUserId, userData, active);

    return res.status(200).json({
      ok: true,
      hasActivePlan: active,
      subscription,
      user: {
        user_id: amemberUserId,
        hasActivePlan: active,
        userSubscriptionType: userData?.subscriptions || {},
      },
      userSubscriptionType: userData?.subscriptions || {},
      credits: {
        adCopy: userProfile?.total_available_credits || 0,
        adCreative: userProfile?.remaining_topup_credits || 0,
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Failed to fetch status" });
  }
};

const getMobileSubscriptionDetails = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Get Mobile Subscription Details for Manage Subscription UI'
    #swagger.description = 'Requires JWT token in Authorization header. Verifies user and returns latest transaction ID, platform source (ios/android/web), store product ID, expiry date, and manage URL for native App Store / Google Play manage subscription.'
    #swagger.security = [{ "BearerAuth": [] }]
    #swagger.responses[200] = {
      description: 'Successfully fetched mobile subscription details',
      schema: { $ref: '#/components/schemas/mobileSubscriptionDetailsResponse' }
    }
  */
  try {
    const rawUserId = req.user?.user_id || req.user?.amember_user_id;
    if (!rawUserId) {
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED", error: "Authentication required." });
    }
    const amemberUserId = String(rawUserId).replace(/^GPT-/, "");

    const userProfile = await UserProfile.findOne({ amember_user_id: amemberUserId });
    const userData = await fetchUserDataByName(userProfile?.login || req.user?.login);
    const active = userData?.ok ? isPlanActive(userData) : false;

    const subscription = await getUserSubscriptionDetails(amemberUserId, userData, active);

    return res.status(200).json({
      ok: true,
      hasActivePlan: active,
      subscription,
      user: {
        user_id: amemberUserId,
        login: userProfile?.login || req.user?.login || "",
        email: userProfile?.email || req.user?.user_email || "",
      },
    });
  } catch (error) {
    console.error("[getMobileSubscriptionDetails] error:", error);
    return res.status(500).json({ ok: false, error: "Failed to retrieve mobile subscription details." });
  }
};

// ── Webhooks Handlers ────────────────────────────────────────────────────────

const handleAppleWebhook = async (req, res) => {
  try {
    const { signedPayload } = req.body;
    if (!signedPayload) return res.status(400).json({ ok: false, error: "signedPayload is required" });

    let decoded;
    try {
      decoded = verifyAndDecodeAppleJWS(signedPayload);
    } catch (err) {
      console.error("[handleAppleWebhook] JWS verification failed:", err.message);
      return res.status(401).json({ ok: false, error: "Forged webhook payload." });
    }

    const eventId = decoded.notificationUUID || `apple_evt_${Date.now()}`;
    const notificationType = decoded.notificationType;

    const existing = await MobileStoreWebhookEvent.findOne({ event_id: eventId });
    if (existing) return res.status(200).json({ ok: true, message: "Duplicate event ignored." });

    if (notificationType === "TEST") {
      return res.status(200).json({ ok: true, message: "Test notification received." });
    }

    let txInfo = null;
    if (decoded.data?.signedTransactionInfo) {
      try {
        const signedTransaction = validateApplePayload(
          verifyAndDecodeAppleJWS(decoded.data.signedTransactionInfo),
        );
        txInfo = await crossCheckAppleTransaction(signedTransaction);
      } catch (err) {
        console.error("[handleAppleWebhook] Apple transaction check failed:", err.message);
        return res.status(err.response ? 502 : 401).json({
          ok: false,
          error: err.response
            ? "Apple could not confirm the webhook transaction."
            : "Invalid Apple webhook transaction.",
        });
      }
    }

    const stateChangingTypes = ["DID_RENEW", "EXPIRED", "REFUND", "REVOKE"];
    if (stateChangingTypes.includes(notificationType)) {
      if (!txInfo || !validateAppleWebhookTransaction(notificationType, txInfo)) {
        return res.status(409).json({
          ok: false,
          error: "Webhook state does not match Apple Server API data.",
        });
      }
    }

    if (txInfo) {
      try {
        const originalTransactionId = String(txInfo.originalTransactionId || txInfo.transactionId);
        const lineageRows = await MobileStoreTransaction.find({
          platform: "ios",
          original_transaction_id: originalTransactionId,
        }).sort({ createdAt: 1 });
        const lineageOwners = [...new Set(
          lineageRows.map((row) => String(row.amember_user_id || "")).filter(Boolean),
        )];

        if (lineageOwners.length > 1) {
          return res.status(409).json({
            ok: false,
            code: "account_transfer_required",
            error: "This Apple subscription has conflicting AdsGPT owners and requires support review.",
          });
        }

        let existingTx = lineageRows.find((row) => row.lineage_owner) || null;
        if (!existingTx && lineageOwners.length === 1) {
          const ownershipResult = await resolveAppleSubscriptionOwnership({
            originalTransactionId,
            appAccountToken: String(txInfo.appAccountToken || "").trim(),
            subscriptionGroupIdentifier: String(txInfo.subscriptionGroupIdentifier || "").trim(),
            amemberUserId: lineageOwners[0],
          });
          if (!ownershipResult.ok) {
            return res.status(ownershipResult.status).json({
              ok: false,
              code: ownershipResult.code,
              error: ownershipResult.error,
            });
          }
          existingTx = ownershipResult.ownership;
        }

        // A webhook has no logged-in AdsGPT user. It may update a verified
        // lineage owner, but it must never guess ownership for a new lineage.
        if (existingTx && notificationType === "DID_RENEW") {
          const expiresDate = new Date(txInfo.expiresDate);
          const purchaseDate = new Date(txInfo.purchaseDate);
          const transactionId = String(txInfo.transactionId);
          let renewalTx = await MobileStoreTransaction.findOne({
            canonical_transaction_id: transactionId,
          });
          if (
            renewalTx &&
            String(renewalTx.original_transaction_id) !== originalTransactionId
          ) {
            return res.status(409).json({
              ok: false,
              code: "subscription_already_linked",
              error: "This Apple transaction is already linked to another subscription.",
            });
          }

          const storeProductId = txInfo.productId || existingTx.store_product_id;
          const renewalAmount =
            typeof txInfo.price === "number"
              ? txInfo.price / 1000.0
              : existingTx.amount;
          const currency = txInfo.currency || existingTx.currency || "USD";

          // Transaction.updates or an earlier webhook may already have created
          // this immutable transaction record and its aMember invoice.
          if (!renewalTx || renewalTx.meta?.amember_sync_pending) {
            const processingOwnership = await acquireAppleTransactionProcessing(
              existingTx._id,
              transactionId,
            );
            if (!processingOwnership) {
              return res.status(409).json({
                ok: false,
                code: "purchase_processing",
                error: "This Apple transaction is already being processed.",
              });
            }
            existingTx = processingOwnership;

            try {
              if (!renewalTx) {
                renewalTx = await MobileStoreTransaction.create({
                  user_id: existingTx.user_id,
                  amember_user_id: existingTx.amember_user_id,
                  platform: "ios",
                  canonical_transaction_id: transactionId,
                  original_transaction_id: originalTransactionId,
                  app_account_token:
                    String(txInfo.appAccountToken || "").trim() ||
                    existingTx.app_account_token ||
                    "",
                  subscription_group_identifier:
                    String(txInfo.subscriptionGroupIdentifier || "").trim() ||
                    existingTx.subscription_group_identifier ||
                    "",
                  store_product_id: storeProductId,
                  event_type: "renewal",
                  amount: renewalAmount,
                  currency,
                  amember_invoice_id: "ios_" + transactionId,
                  purchased_at: purchaseDate,
                  expires_at: expiresDate,
                  raw_payload: txInfo,
                  meta: {
                    env: process.env.APPLE_ENVIRONMENT || "Production",
                    amember_sync_pending: true,
                    verification_state: "processing",
                    source: "apple_webhook",
                  },
                });
              }

              const matchedProduct = await matchAmemberProduct(storeProductId);
              await postAmemberInvoice({
                amemberUserId: existingTx.amember_user_id,
                canonicalTransactionId: transactionId,
                platform: "ios",
                storeProductId,
                matchedProduct,
                amount: renewalAmount,
                currency,
                purchasedAt: purchaseDate,
                expiresAt: expiresDate,
              });
              renewalTx.meta = {
                ...(renewalTx.meta || {}),
                amember_sync_pending: false,
                verification_state: "verified",
              };
              await renewalTx.save();
            } finally {
              await releaseAppleTransactionProcessing(existingTx._id, transactionId);
            }
          }
          if (!existingTx.expires_at || existingTx.expires_at < expiresDate) {
            existingTx.expires_at = expiresDate;
            await existingTx.save();
          }
        } else if (
          existingTx &&
          (notificationType === "EXPIRED" ||
            notificationType === "REFUND" ||
            notificationType === "REVOKE")
        ) {
          await MobileStoreTransaction.updateMany(
            {
              platform: "ios",
              original_transaction_id: originalTransactionId,
              amember_user_id: existingTx.amember_user_id,
            },
            { $set: { expires_at: new Date() } },
          );

          if (notificationType === "REFUND" || notificationType === "REVOKE") {
            await deleteAmemberInvoice("ios", String(txInfo.transactionId));
          }
        }
      } catch (err) {
        console.error("[handleAppleWebhook] Failed to process transaction info:", err.message);
        return res.status(500).json({ ok: false, error: "Webhook processing failed." });
      }
    }
    await MobileStoreWebhookEvent.create({
      platform: "ios",
      event_id: eventId,
      event_type: notificationType,
      state: "processed",
      raw_payload: decoded,
    });

    try {
      const { notifyUserSessionUpdate } = require("../../services/push/notifyUser");
      if (txInfo?.originalTransactionId) {
        const tx = await MobileStoreTransaction.findOne({ original_transaction_id: String(txInfo.originalTransactionId) });
        if (tx && tx.amember_user_id) {
          notifyUserSessionUpdate(tx.amember_user_id).catch(() => {});
        }
      }
    } catch (_) {}

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[handleAppleWebhook] error:", error);
    return res.status(500).json({ ok: false, error: "Webhook failed." });
  }
};

const handleGoogleWebhook = async (req, res) => {
  try {
    const secretToken = process.env.GOOGLE_PUBSUB_SECRET_TOKEN;
    if (secretToken && req.query.token !== secretToken) {
      return res.status(401).json({ ok: false, error: "Unauthorized webhook." });
    }

    const { message } = req.body;
    if (!message || !message.data) return res.status(400).json({ ok: false, error: "message.data is required" });

    const messageId = message.messageId || `g_evt_${Date.now()}`;
    const existing = await MobileStoreWebhookEvent.findOne({ event_id: messageId });
    if (existing) return res.status(200).json({ ok: true, message: "Duplicate event ignored." });

    let decodedData = {};
    try {
      decodedData = JSON.parse(Buffer.from(message.data, "base64").toString("utf-8"));
    } catch (e) { }

    await MobileStoreWebhookEvent.create({
      platform: "android",
      event_id: messageId,
      event_type: "GOOGLE_PUBSUB_EVENT",
      state: "processed",
      raw_payload: decodedData,
    });

    const subNotification = decodedData.subscriptionNotification;
    if (subNotification) {
      const purchaseToken = subNotification.purchaseToken;
      const notificationType = subNotification.notificationType;

      if (notificationType === 2) { // Renewed
        try {
          const auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
            scopes: ["https://www.googleapis.com/auth/androidpublisher"],
          });
          const androidPublisher = google.androidpublisher({ version: 'v3', auth });
          const packageName = decodedData.packageName || process.env.GOOGLE_PLAY_PACKAGE_NAME || "io.adsgpt.app";
          const response = await androidPublisher.purchases.subscriptionsv2.get({
            packageName: packageName,
            token: purchaseToken,
          });
          const subscriptionState = response.data;

          let expiresDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // fallback
          if (subscriptionState.lineItems && subscriptionState.lineItems.length > 0) {
            const item = subscriptionState.lineItems[0];
            if (item.expiryTime) {
              expiresDate = new Date(item.expiryTime);
            }
          }

          await MobileStoreTransaction.updateMany(
            { original_transaction_id: purchaseToken },
            { $set: { event_type: "renewal", amember_sync_pending: false, expires_at: expiresDate } }
          );

          const existingTx = await MobileStoreTransaction.findOne({ original_transaction_id: purchaseToken });
          if (existingTx && existingTx.amember_user_id) {
            const matchedProduct = await matchAmemberProduct(existingTx.store_product_id);
            const renewalAmount = existingTx.amount;
            await postAmemberInvoice({
              amemberUserId: existingTx.amember_user_id,
              canonicalTransactionId: purchaseToken,
              platform: "android",
              storeProductId: existingTx.store_product_id,
              matchedProduct,
              amount: renewalAmount,
              currency: existingTx.currency || "USD",
              purchasedAt: new Date(),
              expiresAt: expiresDate,
            });
          }
        } catch (err) {
          console.error("[handleGoogleWebhook] Failed to process renewal via Developer API:", err.message);
          await MobileStoreTransaction.updateMany(
            { original_transaction_id: purchaseToken },
            { $set: { event_type: "renewal", amember_sync_pending: true } }
          );
        }
      } else if (notificationType === 3 || notificationType === 12 || notificationType === 13) { // Canceled, Revoked, or Expired
        await MobileStoreTransaction.updateMany(
          { original_transaction_id: purchaseToken },
          { $set: { expires_at: new Date() } }
        );

        const existingTx = await MobileStoreTransaction.findOne({ original_transaction_id: purchaseToken });
        if (existingTx && existingTx.canonical_transaction_id) {
          await deleteAmemberInvoice("android", existingTx.canonical_transaction_id);
        }
      }
    }

    try {
      const { notifyUserSessionUpdate } = require("../../services/push/notifyUser");
      if (subNotification?.purchaseToken) {
        const tx = await MobileStoreTransaction.findOne({ original_transaction_id: String(subNotification.purchaseToken) });
        if (tx && tx.amember_user_id) {
          notifyUserSessionUpdate(tx.amember_user_id).catch(() => {});
        }
      }
    } catch (_) {}

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[handleGoogleWebhook] error:", error);
    return res.status(500).json({ ok: false, error: "Webhook failed." });
  }
};

const DeleteAccount = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'In-app account deletion'
    #swagger.description = 'Deletes account for Native Email/Password, Google, or Apple users. Hard-deletes from Firebase (if present) and aMember, and soft-deletes in MongoDB (App Store Guideline 5.1.1(v)).'
    #swagger.security = [{ "BearerAuth": [] }]
    #swagger.requestBody = {
      required: false,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              reason: { type: "string", description: "Reason for account deletion", example: "User requested deletion from mobile app settings" }
            }
          }
        }
      }
    }
    #swagger.responses[200] = { description: 'Account successfully deleted' }
    #swagger.responses[401] = { description: 'Authenticated user required' }
    #swagger.responses[404] = { description: 'User account not found' }
  */
  try {
    const rawUserId = req.user?.user_id || req.user?.amember_user_id;
    const login = req.user?.login;
    const userEmail = req.user?.user_email || req.user?.email;

    if (!rawUserId && !login && !userEmail) {
      return res.status(401).json({
        ok: false,
        code: "AUTH_USER_REQUIRED",
        error: "An authenticated user is required.",
      });
    }

    const cleanUserId = rawUserId ? String(rawUserId).replace(/^GPT-/, "") : null;

    // 1. Find user in MongoDB
    const userProfile = await UserProfile.findOne({
      $or: [
        ...(cleanUserId ? [{ amember_user_id: cleanUserId }, { user_id: `GPT-${cleanUserId}` }] : []),
        ...(login ? [{ login }] : []),
        ...(userEmail ? [{ email: userEmail }] : []),
      ],
    });

    if (!userProfile || userProfile.is_deleted === true) {
      return res.status(404).json({
        ok: false,
        code: "USER_NOT_FOUND",
        error: "The authenticated user account was not found.",
      });
    }

    const targetAmemberUserId = userProfile.amember_user_id || cleanUserId;
    const reason = req.body?.reason || "User requested deletion from mobile app settings";

    // 2. If Firebase user (Google or Apple), hard-delete from Firebase Admin
    if (userProfile.firebase_uid) {
      try {
        const admin = require("firebase-admin");
        if (admin.apps && admin.apps.length > 0) {
          await admin.auth().deleteUser(userProfile.firebase_uid);
        }
      } catch (fbErr) {
        console.error("[DeleteAccount] Firebase user deletion warning:", fbErr.message);
      }
    }

    // 3. Hard-delete from aMember via REST API
    if (targetAmemberUserId) {
      try {
        const url = `${baseUrl}/users/${targetAmemberUserId}?_key=${apiKey}`;
        await axios.delete(url);
      } catch (amErr) {
        console.error("[DeleteAccount] aMember user deletion error:", amErr.message);
      }
    }

    // 4. Soft-delete in MongoDB UserProfile
    userProfile.is_deleted = true;
    userProfile.deleted_at = new Date();
    userProfile.deletion_reason = reason;
    await userProfile.save();

    return res.status(200).json({
      ok: true,
      message: "Account has been successfully deleted.",
    });
  } catch (error) {
    console.error("[DeleteAccount] error:", error);
    return res.status(500).json({
      ok: false,
      code: "INTERNAL_ERROR",
      error: "Failed to delete account. Please try again.",
    });
  }
};

const AcceptMobileTerms = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Accept the current mobile terms and conditions'
    #swagger.description = 'Records consent in aMember for the authenticated user. Consent is not stored in MongoDB.'
    #swagger.security = [{ "BearerAuth": [] }]
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: '#/components/schemas/acceptMobileTermsPayload' }
        }
      }
    }
    #swagger.responses[200] = { description: 'Consent recorded in aMember' }
    #swagger.responses[400] = { description: 'Explicit acceptance is required' }
    #swagger.responses[404] = { description: 'Authenticated user was not found' }
    #swagger.responses[502] = { description: 'aMember consent update failed' }
  */
  try {
    if (req.body?.accepted !== true) {
      return res.status(400).json({
        ok: false,
        code: "TERMS_ACCEPTANCE_REQUIRED",
        error: "Set accepted to true to accept the terms and conditions.",
      });
    }

    const rawUserId = req.user?.user_id || req.user?.amember_user_id;
    if (!rawUserId) {
      return res.status(401).json({
        ok: false,
        code: "AUTH_USER_REQUIRED",
        error: "An authenticated user is required.",
      });
    }

    const amemberUserId = String(rawUserId).replace(/^GPT-/, "");
    const userProfile = await UserProfile.findOne({
      amember_user_id: amemberUserId,
    });
    if (!userProfile || userProfile.is_deleted === true) {
      return res.status(404).json({
        ok: false,
        code: "USER_NOT_FOUND",
        error: "The authenticated user account was not found.",
      });
    }

    const amemberUser = await fetchUserDataByName(
      userProfile.login || req.user?.login,
    );
    if (!amemberUser?.ok || String(amemberUser.user_id) !== amemberUserId) {
      return res.status(404).json({
        ok: false,
        code: "AMEMBER_USER_NOT_FOUND",
        error: "The authenticated aMember account was not found.",
      });
    }

    const termsVersion = process.env.MOBILE_TERMS_VERSION || "mobile-terms-v1";
    const acceptedAt = new Date().toISOString();
    const params = new URLSearchParams({
      _key: apiKey,
      accepted_terms: "1",
      terms_version: termsVersion,
      terms_accepted_at: acceptedAt,
    });

    try {
      await axios.put(
        `${baseUrl}/users/${amemberUserId}`,
        params.toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
    } catch (error) {
      console.error("[AcceptMobileTerms] aMember update failed:", error.message);
      return res.status(500).json({
        ok: false,
        code: "AMEMBER_TERMS_SYNC_FAILED",
        error: "Failed to record terms acceptance in aMember.",
      });
    }

    return res.status(200).json({
      ok: true,
      accepted: true,
      termsVersion,
      acceptedAt,
    });
  } catch (error) {
    console.error("[AcceptMobileTerms] error:", error);
    return res.status(500).json({
      ok: false,
      code: "INTERNAL_ERROR",
      error: "Failed to record terms acceptance.",
    });
  }
};

async function getMobileFreeTrial(req, res) {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Get Free Trial details and user eligibility'
    #swagger.description = 'Requires a valid Bearer token, returns the direct aMember Free Trial product, and checks whether the authenticated user already used the trial.'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const products = await getAmemberProducts();
    const freeTrialProduct = products
      .filter((product) => {
        if (!product || product.is_disabled === "1" || product.is_archived === "1") {
          return false;
        }
        const titleWords = String(product.title || "")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean);
        return titleWords.includes("free");
      })
      .sort((left, right) =>
        Number.parseInt(left.product_id, 10) - Number.parseInt(right.product_id, 10),
      )[0] || null;

    if (!freeTrialProduct) {
      return res.status(503).json({
        ok: false,
        code: "FREE_TRIAL_UNAVAILABLE",
        error: "The Free Trial is currently unavailable.",
      });
    }

    const freeTrial = {
      amemberProductId: Number.parseInt(freeTrialProduct.product_id, 10),
      title: freeTrialProduct.title,
      credit: getConfiguredProductCredit(freeTrialProduct),
    };

    const rawUserId = req.user?.user_id || req.user?.amember_user_id || req.user?.id;
    if (!rawUserId) {
      return res.status(401).json({
        ok: false,
        code: "AUTH_USER_REQUIRED",
        error: "A valid authentication token is required.",
      });
    }

    const amemberUserId = String(rawUserId).replace(/^(GPT|PAS)-/, "");
    const userResponse = await axios.get(`${baseUrl}/users`, {
      params: { _key: apiKey, "_filter[user_id]": amemberUserId },
    });
    const userRecords = Array.isArray(userResponse.data)
      ? userResponse.data
      : Object.values(userResponse.data || {});
    const amemberUser = userRecords.find(
      (user) => user && String(user.user_id) === amemberUserId,
    );
    if (!amemberUser) {
      return res.status(404).json({
        ok: false,
        code: "USER_NOT_FOUND",
        error: "The authenticated aMember account was not found.",
      });
    }

    const invoices = [];
    const invoicePageSize = 100;
    let invoicePage = 0;
    let pageInvoices = [];
    do {
      const invoiceResponse = await axios.get(`${baseUrl}/invoices`, {
        params: {
          _key: apiKey,
          "_filter[user_id]": amemberUserId,
          "_nested[]": "invoice-items",
          _count: invoicePageSize,
          _page: invoicePage,
        },
      });
      const invoiceRecords = Array.isArray(invoiceResponse.data)
        ? invoiceResponse.data
        : Object.values(invoiceResponse.data || {});
      pageInvoices = invoiceRecords.filter(
        (invoice) => invoice && typeof invoice === "object" && invoice.invoice_id,
      );
      invoices.push(...pageInvoices);
      invoicePage += 1;
    } while (pageInvoices.length === invoicePageSize);
    const trialIds = new Set(
      [freeTrialProduct.product_id, freeTrialProduct.default_billing_plan_id]
        .filter((value) => value !== undefined && value !== null && String(value) !== "")
        .map(String),
    );
    const hasUsedFreeTrial = invoices.some((invoice) => {
      const nestedItems = invoice?.nested?.["invoice-items"] || [];
      const items = Array.isArray(nestedItems)
        ? nestedItems
        : Object.values(nestedItems || {});
      return items.some((item) =>
        [item?.item_id, item?.product_id, item?.billing_plan_id]
          .filter((value) => value !== undefined && value !== null)
          .map(String)
          .some((value) => trialIds.has(value)),
      );
    });

    return res.status(200).json({
      ok: true,
      freeTrial,
      eligibility: {
        checked: true,
        eligible: !hasUsedFreeTrial,
        hasUsedFreeTrial,
        message: hasUsedFreeTrial
          ? "You have already used the Free Trial."
          : "You are eligible for the Free Trial.",
      },
    });
  } catch (error) {
    console.error("[getMobileFreeTrial] error:", error.response?.data || error.message);
    return res.status(500).json({
      ok: false,
      code: "AMEMBER_ERROR",
      error: "Failed to fetch or verify the Free Trial from aMember.",
    });
  }
}

async function getMobilePlans(req, res) {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Get mobile subscription plans'
    #swagger.description = 'Returns direct aMember products matched by Apple / Google Store Product IDs for the native paywall.'
    #swagger.security = [{ "BearerAuth": [] }]
    #swagger.parameters['platform'] = {
      in: 'query',
      description: 'Target mobile platform',
      required: false,
      type: 'string',
      enum: ['ios', 'android']
    }
  */
  try {
    const authorization = String(req.headers?.authorization || "");
    if (!/^Bearer\s+\S+$/i.test(authorization)) {
      return res.status(401).json({
        ok: false,
        code: "BEARER_TOKEN_REQUIRED",
        error: "Authorization: Bearer token is required.",
      });
    }

    const rawUserId = req.user?.user_id || req.user?.amember_user_id || req.user?.id;
    if (!rawUserId) {
      return res.status(401).json({
        ok: false,
        code: "AUTH_USER_REQUIRED",
        error: "A valid authentication token is required.",
      });
    }

    const amemberUserId = String(rawUserId).replace(/^GPT-/, "");
    const userProfile = await UserProfile.findOne({
      amember_user_id: amemberUserId,
    });

    if (userProfile && userProfile.is_deleted === true) {
      return res.status(404).json({
        ok: false,
        code: "USER_NOT_FOUND",
        error: "The authenticated user account was not found.",
      });
    }

    let reqPlatform = req.query.platform ? String(req.query.platform).toLowerCase() : null;
    if (reqPlatform === "google") reqPlatform = "android";
    if (reqPlatform && reqPlatform !== "ios" && reqPlatform !== "android") {
      return res.status(400).json({
        ok: false,
        code: "INVALID_PLATFORM",
        error: `Unsupported platform: ${req.query.platform}. Use 'ios' or 'android'.`,
      });
    }

    const targetPlatform = reqPlatform || "ios";
    const configuredStorePlans = mobileStorePlans[targetPlatform];

    // Fetch aMember IDs, titles, and credits dynamically. The store catalog
    // contains only the native store Product IDs and subscription levels.
    const prods = await getAmemberProducts();
    const categoryMap = await getAmemberProductCategoryMap();
    // Join each static Store Product ID to the exact aMember tier and billing
    // period encoded in that ID. IDs, titles, and credits remain live aMember data.
    const plans = configuredStorePlans.flatMap((storePlan) => {
      const product = resolveAmemberProduct(prods, storePlan, categoryMap);
      if (!product) return [];

      return [{
        productId: storePlan.productId,
        amemberProductId: parseInt(product.product_id, 10),
        ...(reqPlatform === "ios"
          ? { appleProductId: storePlan.productId }
          : reqPlatform === "android"
            ? { googleProductId: storePlan.productId }
            : {
              appleProductId: storePlan.productId,
              googleProductId: "",
            }),
        tier: product.title || "Subscription",
        fallbackTitle: product.title || "Subscription Plan",
        badge: storePlan.badge || null,
        ...(reqPlatform ? { platform: reqPlatform } : {}),
        credit: getConfiguredProductCredit(product),
      }];
    });

    const defaultProductId = plans[0]?.productId || null;

    return res.status(200).json({
      ok: true,
      defaultProductId,
      plans,
    });
  } catch (error) {
    console.error("[getMobilePlans] error:", error);
    return res.status(500).json({
      ok: false,
      code: "INTERNAL_ERROR",
      error: "Failed to fetch plans.",
    });
  }
};
const ForgotPassword = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Trigger aMember forgot password reset email'
    #swagger.description = 'Checks if user exists, then dispatches password reset instructions via aMember to their registered email.'
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["identity"],
            properties: {
              identity: { type: "string", description: "Username or Email address", example: "user@example.com" }
            }
          }
        }
      }
    }
    #swagger.responses[200] = {
      description: 'Password reset email sent successfully',
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean", example: true },
          message: { type: "string", example: "Password reset link has been sent to your email address." }
        }
      }
    }
    #swagger.responses[400] = { description: 'Missing identity input' }
    #swagger.responses[404] = { description: 'User account not found' }
    #swagger.responses[500] = { description: 'aMember error' }
  */
  try {
    const identityInput = (req.body?.identity || req.body?.email || req.body?.username || "").trim();
    if (!identityInput) {
      return res.status(400).json({
        ok: false,
        code: "IDENTITY_REQUIRED",
        error: "Please enter your registered email address or username.",
      });
    }

    const cleanInput = identityInput.toLowerCase();

    // 1. Check if user exists in MongoDB or aMember
    const { mongoProfile, amemberUser } = await findUserByEmailOrFirebaseUid({ email: cleanInput });

    let existingUser = mongoProfile || amemberUser;
    if (!existingUser) {
      existingUser = await UserProfile.findOne({ login: cleanInput });
    }

    if (!existingUser) {
      return res.status(404).json({
        ok: false,
        code: "USER_NOT_FOUND",
        error: "No account was found with that email address or username. Please check your spelling or sign up for a new account.",
      });
    }

    // 2. User exists — trigger aMember send-pass API
    const targetLogin = existingUser.login || existingUser.email || cleanInput;
    const url = `${baseUrl}/check-access/send-pass?_key=${apiKey}&login=${encodeURIComponent(targetLogin)}`;
    const amemberResponse = await axios.get(url);
    console.log('[ForgotPassword] aMember send-pass response:', {
      status: amemberResponse.status,
      data: amemberResponse.data,
    });

    return res.status(200).json({
      ok: true,
      message: "Password reset link has been sent to your email address.",
    });
  } catch (error) {
    console.error("[ForgotPassword] error:", error.response?.data || error.message);
    return res.status(500).json({
      ok: false,
      code: "AMEMBER_ERROR",
      error: error.response?.data?.error || error.message || "Failed to send password reset email. Please try again.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// V2 AUTH HANDLERS  (PRD §API 1A · 1B · 1C · 1D)
// Namespace : POST /api/v2/auth/email | /google | /apple
//
// Design rules:
//  • ALL existing functions above are 100 % untouched.
//  • These handlers reuse every private helper already in this file
//    (verifyFirebaseToken, findUserByEmailOrFirebaseUid, createAmemberUser,
//     isPlanActive, syncUserProfile, generateToken, …).
//  • Returns the unified V2 envelope:
//      { success, statusCode, data: { token, user: { id, email, fullName,
//        isNewUser, isOnboarded } } }
//  • isOnboarded is derived at runtime: user has ≥1 brand in BrandsList = true.
//    No schema fields added to UserProfile.

// ───────────────────────────────────────────────────────────────────────────────

/**
 * Derive whether onboarding is complete for a given user_id.
 * Returns true if the user has created at least one brand (step 2.3 done).
 * No schema fields required — purely from the existing BrandsList collection.
 */
async function _v2IsOnboarded(userId) {
  try {
    if (!userId) return false;
    const record = await BrandsList.findOne({ user_id: userId }, { brands: 1 }).lean();
    return Array.isArray(record?.brands) && record.brands.length > 0;
  } catch {
    return false; // non-fatal — never block auth
  }
}


/**
 * Build the standard V2 success response envelope.
 * isOnboarded is passed in — computed by the caller via _v2IsOnboarded().
 */
function _v2BuildSuccessResponse(token, mongoProfile, amemberUserId, email, fullName, isNewUser, isOnboarded, hasActivePlan) {
  return {
    success: true,
    statusCode: 200,
    data: {
      token,
      user: {
        id: mongoProfile?.user_id || `GPT-${amemberUserId}`,
        email: email || "",
        fullName: fullName || "",
        isNewUser: Boolean(isNewUser),
        isOnboarded: Boolean(isOnboarded),
        hasActivePlan: Boolean(hasActivePlan),
        phoneNumber: mongoProfile?.phoneNumber || "",
      },
    },
  };
}

// ── API 1A : POST /api/v2/auth/email ─────────────────────────────────────────

/**
 * Email + password authentication via aMember.
 * Existing getUserDetails / getFromAmemberUserDetails are NOT touched.
 */
const v2EmailAuth = async (req, res) => {
  /*
    #swagger.tags = ['V2 Auth & Onboarding']
    #swagger.summary = 'V2 Email Auth (Signup & Login)'
    #swagger.description = 'Unified email authentication endpoint that authenticates a user against aMember and resolves or creates their profile. Used by both web and mobile in V2.'
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: '#/components/schemas/v2EmailAuthPayload' }
        }
      }
    }
    #swagger.responses[200] = {
      description: 'Successfully authenticated user',
      schema: { $ref: '#/components/schemas/v2AuthSuccessResponse' }
    }
  */
  try {
    const { email, password } = req.body || {};

    // Input validation
    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        success: false, statusCode: 400,
        error: "email is required.", code: "INVALID_INPUT",
      });
    }
    if (!password || typeof password !== "string") {
      return res.status(400).json({
        success: false, statusCode: 400,
        error: "password is required.", code: "INVALID_INPUT",
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Check if user exists in aMember (using findUserByEmailOrFirebaseUid helper)
    const { mongoProfile: existingProfile, amemberUser } = await findUserByEmailOrFirebaseUid({ email: cleanEmail });

    let userData;
    let isNewUser = false;

    if (amemberUser) {
      // 2. User exists -> LOGIN Flow
      const amemberUrl = `${baseUrl}/check-access/by-login-pass`;
      const qs = new URLSearchParams({ _key: apiKey, login: amemberUser.login, pass: password });
      try {
        const resp = await fetch(`${amemberUrl}?${qs}`);
        userData = await resp.json();
      } catch (fetchErr) {
        console.error("[v2Auth/email] aMember fetch error:", fetchErr.response?.data || fetchErr.message);
        return res.status(500).json({
          success: false, statusCode: 500,
          error: "We're having trouble logging you in right now. Please try again in a moment.",
          code: "AUTH_SERVICE_ERROR",
        });
      }

      if (!userData?.ok) {
        return res.status(401).json({
          success: false, statusCode: 401,
          error: "Invalid email or password.", code: "INVALID_CREDENTIALS",
        });
      }
    } else {
      // 3. User does NOT exist -> SIGNUP Flow
      isNewUser = true;
      const cleanLogin = cleanEmail;

      try {
        const newAmemberUser = await createAmemberUser({
          login:       cleanLogin,
          email:       cleanEmail,
          password:    password,
          firstName:   "",
          lastName:    "",
          phoneNumber: "",
        });

        // Resolve the newly registered user data
        userData = await fetchUserDataByName(newAmemberUser.login);
      } catch (createErr) {
        console.error("[v2Auth/email] signup error:", createErr.response?.data || createErr.message);
        return res.status(500).json({
          success: false, statusCode: 500,
          error: "Failed to create account. Please try again.",
          code: "SIGNUP_ERROR",
        });
      }
    }

    const hasActivePlan = isPlanActive(userData);

    // Sync Mongo profile (creates on first login/signup, updates on subsequent logins)
    if (hasActivePlan || isNewUser) {
      try { await syncUserProfile(userData); }
      catch (syncErr) { console.error("[v2Auth/email] syncUserProfile warning:", syncErr.message); }
    }

    const mongoProfile = await UserProfile.findOne({ email: cleanEmail });
    const fullName    = `${userData.name_f ?? ""} ${userData.name_l ?? ""}`.trim();

    const tokenPayload = {
      status: userData.ok,
      user_id: userData.user_id,
      login: userData.login,
      user_name: fullName,
      user_email: userData.email,
      name_f: userData.name_f ?? "",
      name_l: userData.name_l ?? "",
      userSubscriptionType: userData.subscriptions || {},
      hasActivePlan,
      created_from: "GPT",
    };

    const jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);
    const userId    = `GPT-${userData.user_id}`;

    // Derive isOnboarded from brands (API 1D)
    const isOnboarded = await _v2IsOnboarded(userId);

    return res.status(200).json(
      _v2BuildSuccessResponse(jwtToken, mongoProfile, userData.user_id, userData.email, fullName, isNewUser, isOnboarded, hasActivePlan),
    );
  } catch (error) {
    console.error("[v2Auth/emailAuth] Unexpected error:", error);
    return res.status(500).json({
      success: false, statusCode: 500,
      error: "An unexpected error occurred. Please try again.",
      code: "INTERNAL_ERROR",
    });
  }
};

// ── Shared Firebase core (Google & Apple) ────────────────────────────────────

/**
 * Resolve a Firebase-authenticated user for V2 endpoints.
 * Handles BOTH new (signup) and returning (login) users in one call —
 * no need for separate signup/login endpoints like the mobile routes have.
 *
 * @param {string} firebaseIdToken  Firebase ID token from client
 * @param {string} expectedProvider "google.com" | "apple.com"
 * @param {string} providerLabel    "google" | "apple"
 * @param {string} [platform]       optional hint from request body
 */
async function _v2ResolveFirebaseUser(firebaseIdToken, expectedProvider, providerLabel, platform) {
  const decoded = await verifyFirebaseToken(firebaseIdToken);

  if (decoded.firebase?.sign_in_provider !== expectedProvider) {
    const err = new Error(`Please use ${providerLabel} to authenticate with this endpoint.`);
    err.code   = "INVALID_PROVIDER";
    err.status = 400;
    throw err;
  }

  const email      = decoded.email ? decoded.email.toLowerCase() : null;
  const firebaseUid = decoded.uid;
  const displayName = decoded.name || "";
  const firstName   = displayName.split(" ")[0] || "";
  const lastName    = displayName.split(" ").slice(1).join(" ") || "";

  if (!email) {
    const label = providerLabel.charAt(0).toUpperCase() + providerLabel.slice(1);
    const err   = new Error(`${label} account must have a verified email address.`);
    err.code    = `INVALID_${providerLabel.toUpperCase()}_TOKEN`;
    err.status  = 400;
    throw err;
  }

  let { mongoProfile, amemberUser } = await findUserByEmailOrFirebaseUid({ email, firebaseUid });
  let isNewUser   = false;
  let amemberUserId;
  let hasActivePlan = false;
  let userSubscriptionType = {};

  if (mongoProfile || amemberUser) {
    // ── Returning user ──────────────────────────────────────────────────────
    amemberUserId = amemberUser?.user_id || mongoProfile?.amember_user_id;

    if (mongoProfile) {
      if (!mongoProfile.firebase_uid) mongoProfile.firebase_uid = firebaseUid;
      if (!mongoProfile.loginProviders) mongoProfile.loginProviders = [];
      if (!mongoProfile.loginProviders.includes(providerLabel)) {
        mongoProfile.loginProviders.push(providerLabel);
      }
      if (platform) mongoProfile.platform = platform;
      mongoProfile.last_login_at = new Date();
      await mongoProfile.save();
    }

    const userData = await fetchUserDataByName(amemberUser?.login || mongoProfile?.login || email);
    if (userData?.ok) {
      hasActivePlan = isPlanActive(userData);
      userSubscriptionType = userData.subscriptions || {};
      await syncUserProfile(userData);
      if (mongoProfile?._id) mongoProfile = await UserProfile.findById(mongoProfile._id);
    }
  } else {
    // ── New user: provision aMember account + Mongo profile ─────────────────
    isNewUser = true;
    const generatedLogin = emailToLogin(email);

    const newAmemberUser = await createAmemberUser({
      login:       generatedLogin,
      email,
      password:    generateRandomString(16),
      firstName,
      lastName,
      phoneNumber: "",
    });
    amemberUserId = String(newAmemberUser.user_id || newAmemberUser.id);

    // Reuse a previously soft-deleted profile if one exists
    const existingDeleted = await UserProfile.findOne({
      $or: [{ email: email.toLowerCase() }, { firebase_uid: firebaseUid }],
    });

    if (existingDeleted) {
      existingDeleted.is_deleted             = false;
      existingDeleted.deleted_at             = null;
      existingDeleted.delete_reason          = "";
      existingDeleted.user_id                = `GPT-${amemberUserId}`;
      existingDeleted.amember_user_id        = amemberUserId;
      existingDeleted.firebase_uid           = firebaseUid;
      existingDeleted.login                  = generatedLogin;
      existingDeleted.name                   = displayName;
      existingDeleted.name_f                 = firstName;
      existingDeleted.name_l                 = lastName;
      existingDeleted.loginProviders         = [providerLabel];
      existingDeleted.last_login_at          = new Date();
      if (platform) existingDeleted.platform = platform;
      await existingDeleted.save();
      mongoProfile = existingDeleted;
    } else {
      mongoProfile = await UserProfile.create({
        user_id:         `GPT-${amemberUserId}`,
        login:           generatedLogin,
        name:            displayName,
        name_f:          firstName,
        name_l:          lastName,
        email,
        created_from:    "GPT",
        amember_user_id: amemberUserId,
        firebase_uid:    firebaseUid,
        loginProviders:  [providerLabel],
        last_login_at:   new Date(),
        platform:        platform || "",
      });
    }
  }

  // Build JWT (same shape as existing mobile handlers)
  const tokenPayload = {
    status:              true,
    user_id:             amemberUserId,
    firebase_uid:        firebaseUid,
    auth_provider:       expectedProvider,
    login:               amemberUser?.login || mongoProfile?.login || email,
    user_email:          email,
    hasActivePlan,
    userSubscriptionType,
    created_from:        "GPT",
  };

  const jwtToken  = generateToken(tokenPayload, secretKey, tokenExpiryTime);
  const fullName  = mongoProfile?.name || displayName || "";

  return { jwtToken, mongoProfile, email, fullName, isNewUser, amemberUserId, hasActivePlan };
}

// ── API 1B : POST /api/v2/auth/google ────────────────────────────────────────

/**
 * Unified Google auth (signup + login) for web & mobile.
 * Input: { firebaseIdToken: string, platform?: string }
 */
const v2GoogleAuth = async (req, res) => {
  /*
    #swagger.tags = ['V2 Auth & Onboarding']
    #swagger.summary = 'V2 Google Auth (Signup & Login)'
    #swagger.description = 'Unified Google authentication endpoint. Verifies a Firebase ID token and resolves or creates the user profile. Used by both web and mobile in V2.'
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: '#/components/schemas/v2GoogleAuthPayload' }
        }
      }
    }
    #swagger.responses[200] = {
      description: 'Successfully authenticated Google user',
      schema: { $ref: '#/components/schemas/v2AuthSuccessResponse' }
    }
  */
  try {
    const { firebaseIdToken, platform } = req.body || {};

    if (!firebaseIdToken) {
      return res.status(400).json({
        success: false, statusCode: 400,
        error: "firebaseIdToken is required.", code: "INVALID_INPUT",
      });
    }

    const { jwtToken, mongoProfile, email, fullName, isNewUser, amemberUserId, hasActivePlan } =
      await _v2ResolveFirebaseUser(firebaseIdToken, "google.com", "google", platform);

    const userId = mongoProfile?.user_id || `GPT-${amemberUserId}`;
    const isOnboarded = await _v2IsOnboarded(userId);

    return res.status(200).json(
      _v2BuildSuccessResponse(jwtToken, mongoProfile, amemberUserId, email, fullName, isNewUser, isOnboarded, hasActivePlan),
    );
  } catch (error) {
    console.error("[v2Auth/googleAuth] error:", error.response?.data || error.message || error);
    const isAxios = error.isAxiosError || (error.message && error.message.includes("status code"));
    const status = isAxios ? 500 : (error.status || 500);
    const errMsg = isAxios ? "We're having trouble logging you in right now. Please try again in a moment." : (error.message || "Google authentication failed.");
    
    return res.status(status).json({
      success: false, statusCode: status,
      error: errMsg,
      code: isAxios ? "AUTH_SERVICE_ERROR" : (error.code || "GOOGLE_AUTH_ERROR"),
    });
  }
};

// ── API 1C : POST /api/v2/auth/apple ─────────────────────────────────────────

/**
 * Unified Apple auth (signup + login) for web & mobile.
 * Input: { firebaseIdToken: string, platform?: string }
 */
const v2AppleAuth = async (req, res) => {
  /*
    #swagger.tags = ['V2 Auth & Onboarding']
    #swagger.summary = 'V2 Apple Auth (Signup & Login)'
    #swagger.description = 'Unified Apple authentication endpoint. Verifies a Firebase ID token and resolves or creates the user profile. Used by both web and mobile in V2.'
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: '#/components/schemas/v2AppleAuthPayload' }
        }
      }
    }
    #swagger.responses[200] = {
      description: 'Successfully authenticated Apple user',
      schema: { $ref: '#/components/schemas/v2AuthSuccessResponse' }
    }
  */
  try {
    const { firebaseIdToken, platform } = req.body || {};

    if (!firebaseIdToken) {
      return res.status(400).json({
        success: false, statusCode: 400,
        error: "firebaseIdToken is required.", code: "INVALID_INPUT",
      });
    }

    const { jwtToken, mongoProfile, email, fullName, isNewUser, amemberUserId, hasActivePlan } =
      await _v2ResolveFirebaseUser(firebaseIdToken, "apple.com", "apple", platform || "ios");

    const userId = mongoProfile?.user_id || `GPT-${amemberUserId}`;
    const isOnboarded = await _v2IsOnboarded(userId);

    return res.status(200).json(
      _v2BuildSuccessResponse(jwtToken, mongoProfile, amemberUserId, email, fullName, isNewUser, isOnboarded, hasActivePlan),
    );
  } catch (error) {
    console.error("[v2Auth/appleAuth] error:", error.response?.data || error.message || error);
    const isAxios = error.isAxiosError || (error.message && error.message.includes("status code"));
    const status = isAxios ? 500 : (error.status || 500);
    const errMsg = isAxios ? "We're having trouble logging you in right now. Please try again in a moment." : (error.message || "Apple authentication failed.");
    
    return res.status(status).json({
      success: false, statusCode: status,
      error: errMsg,
      code: isAxios ? "AUTH_SERVICE_ERROR" : (error.code || "APPLE_AUTH_ERROR"),
    });
  }
};

// ── API 2.1 : POST /api/v2/user/profile ─────────────────────────────────────

/**
 * Helper to sync the V2 profile back to aMember to prevent data loss.
 */
async function _v2UpdateAmemberProfile(amemberUserId, { firstName, lastName, phoneNumber }) {
  if (!amemberUserId) return;
  try {
    const url = `${baseUrl}/users/${amemberUserId}?_key=${apiKey}`;
    const params = new URLSearchParams();
    if (firstName) params.append("name_f", firstName);
    if (lastName) params.append("name_l", lastName);
    if (phoneNumber) params.append("phone", phoneNumber);
    
    await axios.put(url, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch (e) {
    console.error("[_v2UpdateAmemberProfile] error:", e.response?.data || e.message);
  }
}

/**
 * Save onboarding profile details (firstName, lastName, phoneNumber).
 * Requires JWT auth (applied at route level via authenticateJWT).
 */
const v2UpdateOnboardingProfile = async (req, res) => {
  /*
    #swagger.tags = ['V2 Auth & Onboarding']
    #swagger.summary = 'V2 Update Onboarding Profile'
    #swagger.description = 'Saves the user profile details (first name, last name, phone number) during step 2.1 of the V2 onboarding flow.'
    #swagger.security = [{ "BearerAuth": [] }]
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: '#/components/schemas/v2UpdateProfilePayload' }
        }
      }
    }
  */
  try {
    const { firstName, lastName, phoneNumber } = req.body || {};
    const userId = req.user?.user_id; // already "GPT-XXX" after authService decode

    if (!firstName || typeof firstName !== "string" || !firstName.trim()) {
      return res.status(400).json({
        success: false, statusCode: 400,
        error: "firstName is required.", code: "INVALID_INPUT",
      });
    }
    if (!lastName || typeof lastName !== "string" || !lastName.trim()) {
      return res.status(400).json({
        success: false, statusCode: 400,
        error: "lastName is required.", code: "INVALID_INPUT",
      });
    }
    let cleanPhone = "";
    if (phoneNumber && typeof phoneNumber === "string" && phoneNumber.trim()) {
      const digitCount = phoneNumber.replace(/\D/g, "").length;
      if (digitCount < 7 || digitCount > 15) {
        return res.status(400).json({
          success: false, statusCode: 400,
          error: "A valid phone number is required (7–15 digits).",
          code: "INVALID_PHONE_NUMBER",
        });
      }
      cleanPhone = phoneNumber.trim();
    }
    
    if (!userId) {
      return res.status(401).json({
        success: false, statusCode: 401,
        error: "Authentication required.", code: "AUTH_REQUIRED",
      });
    }

    const cleanFirst = firstName.trim();
    const cleanLast  = lastName.trim();

    const updated = await UserProfile.findOneAndUpdate(
      { user_id: userId },
      {
        $set: {
          name_f:      cleanFirst,
          name_l:      cleanLast,
          name:        `${cleanFirst} ${cleanLast}`.trim(),
          phoneNumber: cleanPhone,
        },
      },
      { new: true },
    );

    if (!updated) {
      return res.status(404).json({
        success: false, statusCode: 404,
        error: "User profile not found. Please sign in again.",
        code: "PROFILE_NOT_FOUND",
      });
    }

    // Critical: Sync back to aMember so subsequent logins don't overwrite this with stale data
    const amemberUserId = userId.replace("GPT-", "");
    await _v2UpdateAmemberProfile(amemberUserId, { 
      firstName: cleanFirst, 
      lastName: cleanLast, 
      phoneNumber: cleanPhone 
    });

    return res.status(200).json({
      success: true,
      statusCode: 200,
      data: {
        userId:      updated.user_id,
        firstName:   updated.name_f,
        lastName:    updated.name_l,
        fullName:    updated.name,
        phoneNumber: updated.phoneNumber,
      },
    });
  } catch (error) {
    console.error("[v2Auth/updateOnboardingProfile] error:", error);
    return res.status(500).json({
      success: false, statusCode: 500,
      error: "An unexpected error occurred. Please try again.",
      code: "INTERNAL_ERROR",
    });
  }
};

module.exports = {
  MobileSignup,
  GoogleSignup,
  GoogleLogin,
  AppleSignup,
  AppleLogin,
  DeleteAccount,
  AcceptMobileTerms,
  ForgotPassword,
  getMobileFreeTrial,
  getMobilePlans,
  getAmemberProducts,
  postAmemberInvoice,
  deleteAmemberInvoice,
  verifyApplePayment,
  verifyGooglePayment,
  restoreApplePurchases,
  restoreGooglePurchases,
  getSubscriptionStatus,
  getMobileSubscriptionDetails,
  handleAppleWebhook,
  handleGoogleWebhook,
  // ── V2 Auth (Step 1) ────────────────────────────────────────────────────────
  v2EmailAuth,
  v2GoogleAuth,
  v2AppleAuth,
  // ── V2 User (Step 2.1) ──────────────────────────────────────────────────────
  v2UpdateOnboardingProfile,
  // Exposed for unit testing only
  _v2BuildSuccessResponse,
  _v2ResolveFirebaseUser,
};
