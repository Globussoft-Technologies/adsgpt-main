const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { SignedDataVerifier, Environment } = require("@apple/app-store-server-library");
const { google } = require("googleapis");
const { generateToken } = require("../../services/authService");
const UserProfile = require("../../Module/user/userProfileModel");
const MobileStoreTransaction = require("../../Module/mobilePayments/mobileStoreTransactionModel");
const MobileStoreWebhookEvent = require("../../Module/mobilePayments/mobileStoreWebhookEventModel");
const { fetchUserDataByName, syncUserProfile } = require("./authController");

const apiKey = process.env.AMEMBER_API_KEY;
const baseUrl = process.env.AMEMBER_BASE_API_URL;
const secretKey = process.env.JWT_SECRET_KEY;
const tokenExpiryTime = process.env.TOKEN_EXPIRY_TIME || 1440;

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
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

function emailToLogin(email) {
  const prefix = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "_");
  return `${prefix}_${Math.floor(1000 + Math.random() * 9000)}`;
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

async function createAmemberUser({ login, email, password, firstName, lastName }) {
  const url = `${baseUrl}/users`;
  const params = new URLSearchParams({
    _key: apiKey,
    login: login.toLowerCase(),
    email: email.toLowerCase(),
    pass: password,
    name_f: firstName || "",
    name_l: lastName || "",
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

async function getAmemberProducts() {
  if (!amemberProductsCache || Date.now() > amemberProductsCacheExpiry) {
    try {
      const apiHost = baseUrl || "https://adsgpt-dev.poweradspy.com/amember/api";
      const res = await axios.get(`${apiHost}/products?_key=${apiKey}`);
      let prods = res.data;
      if (prods && typeof prods === "object" && !Array.isArray(prods)) prods = Object.values(prods);
      if (Array.isArray(prods)) {
        amemberProductsCache = prods;
        amemberProductsCacheExpiry = Date.now() + 5 * 60 * 1000;
      }
    } catch (e) {
      console.error("[mobileController] fetch products error:", e.message);
    }
  }
  return amemberProductsCache || [];
}

async function matchAmemberProduct(storeProductId) {
  const prods = await getAmemberProducts();
  const targetId = String(storeProductId || "").trim();

  const matched = prods.find((p) => {
    if (!p) return false;
    const appleId = String(p.apple_product_id || "").trim();
    const googleId = String(p.google_product_id || "").trim();
    const productId = String(p.product_id || "").trim();
    return appleId === targetId || googleId === targetId || productId === targetId;
  });

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
  const publicId = `${platform}_${canonicalTransactionId}`;
  const paysysId = platform === "ios" ? "app-store" : "google-play";
  const beginDateStr = formatDateForAmember(purchasedAt);
  const expireDateStr = formatDateForAmember(expiresAt);
  const formattedAmount = (amount || 19.99).toFixed(2);

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
  return res.data;
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
    const { email, password, firstName, lastName, platform } = req.body;
    if (!email || !password) {
      return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "Email and password are required." });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanLogin = cleanEmail;

    const { mongoProfile, amemberUser } = await findUserByEmailOrFirebaseUid({ email: cleanEmail });
    if (mongoProfile || amemberUser) {
      const amemberUserId = amemberUser?.user_id || mongoProfile?.amember_user_id;
      const userData = await fetchUserDataByName(amemberUser?.login || mongoProfile?.login || cleanLogin);
      const active = userData?.ok ? isPlanActive(userData) : false;

      if (!active) {
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

    const newAmemberUser = await createAmemberUser({ login: cleanLogin, email: cleanEmail, password, firstName, lastName });
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
    const { firebaseIdToken, firstName, lastName, platform, email: bodyEmail } = req.body;
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

    return res.status(200).json({
      ok: true,
      token: jwtToken,
      isNewUser: false,
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
    const { firebaseIdToken, firstName, lastName, platform, email: bodyEmail } = req.body;
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
      existingDeletedProfile.platform = platform || "";
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
        email,
        created_from: "GPT",
        amember_user_id: amemberUserId,
        firebase_uid: firebaseUid,
        loginProviders: ["apple"],
        last_login_at: new Date(),
        platform: platform || "",
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
      auth_provider: "apple.com",
      login: userData?.login || mongoProfile?.login,
      user_email: email,
      hasActivePlan: active,
      userSubscriptionType: userData?.subscriptions || {},
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
      const issuerId = process.env.APPLE_ISSUER_ID || "PLACEHOLDER";
      const keyId = process.env.APPLE_KEY_ID || "PLACEHOLDER";
      const bundleId = process.env.APPLE_BUNDLE_ID || "io.adsgpt.app";
      const envStr = process.env.APPLE_ENVIRONMENT || "Production";
      const environment = envStr.toLowerCase() === "sandbox" ? Environment.SANDBOX : Environment.PRODUCTION;
      const rootCerts = [];
      const verifier = new SignedDataVerifier(rootCerts, false, environment, bundleId, undefined);
      decoded = await verifier.verifyAndDecodeTransaction(signedTransaction);
    } catch (e) {
      console.error("[verifyApplePayment] JWS verification failed:", e.message);
      return res.status(403).json({ ok: false, code: "STORE_PROOF_INVALID", error: "Invalid App Store signature." });
    }

    const productId = decoded.productId;
    const transactionId = String(decoded.transactionId);
    const originalTransactionId = String(decoded.originalTransactionId || transactionId);
    const purchaseDate = decoded.purchaseDate ? new Date(decoded.purchaseDate) : new Date();
    const expiresDate = decoded.expiresDate ? new Date(decoded.expiresDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const isTrial = decoded.offerType === 2; // Apple offerType 2 = Free Trial
    let amount = isTrial ? 0.00 : (decoded.price ? (decoded.price / 1000.0) : 19.99);

    let existingTx = await MobileStoreTransaction.findOne({ canonical_transaction_id: transactionId });
    const matchedProduct = await matchAmemberProduct(productId);

    if (!existingTx) {
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
        console.error("[verifyApplePayment] aMember invoice failed:", invoiceErr.message);
        return res.status(422).json({
          ok: false,
          code: "AMEMBER_SYNC_FAILED",
          error: "Your payment was verified by Apple, but our billing system failed to update your account. Please try restoring your purchases in a few minutes or contact support."
        });
      }

      existingTx = await MobileStoreTransaction.create({
        user_id: `GPT-${amemberUserId}`,
        amember_user_id: amemberUserId,
        platform: "ios",
        canonical_transaction_id: transactionId,
        original_transaction_id: originalTransactionId,
        store_product_id: productId,
        event_type: "initial_purchase",
        amount,
        currency: decoded.currency || "USD",
        amember_invoice_id: `ios_${transactionId}`,
        purchased_at: purchaseDate,
        expires_at: expiresDate,
        raw_payload: decoded,
        meta: { env: process.env.APPLE_ENVIRONMENT || "Production" },
      });
    }

    let userProfile = await UserProfile.findOne({ amember_user_id: amemberUserId });
    const userData = await fetchUserDataByName(userProfile?.login || req.user?.login);
    if (userData?.ok) {
      await syncUserProfile(userData);
      userProfile = await UserProfile.findOne({ amember_user_id: amemberUserId });
    }

    const tokenPayload = {
      status: true,
      user_id: amemberUserId,
      login: userProfile?.login || req.user?.login,
      user_email: userProfile?.email || req.user?.user_email,
      hasActivePlan: true,
      userSubscriptionType: { [matchedProduct.amember_product_id]: formatDateForAmember(expiresDate) },
      created_from: "GPT",
    };

    const jwtToken = generateToken(tokenPayload, secretKey, tokenExpiryTime);

    return res.status(200).json({
      ok: true,
      token: jwtToken,
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
        userSubscriptionType: { [matchedProduct.amember_product_id]: formatDateForAmember(expiresDate) },
      },
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

    const canonicalTxId = purchaseToken;
    let existingTx = await MobileStoreTransaction.findOne({ canonical_transaction_id: canonicalTxId });
    const matchedProduct = await matchAmemberProduct(productId);

    let isTrial = false;
    let amount = 19.99;
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
      // Attempt to parse dynamic pricing if available in a full implementation, fallback for now if missing
    }

    if (isTrial) {
      amount = 0.00;
    }

    if (!existingTx) {
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
        console.error("[verifyGooglePayment] aMember invoice failed:", invoiceErr.message);
        return res.status(422).json({
          ok: false,
          code: "AMEMBER_SYNC_FAILED",
          error: "Your payment was verified by Google, but our billing system failed to update your account. Please try restoring your purchases in a few minutes or contact support."
        });
      }

      existingTx = await MobileStoreTransaction.create({
        user_id: `GPT-${amemberUserId}`,
        amember_user_id: amemberUserId,
        platform: "android",
        canonical_transaction_id: canonicalTxId,
        original_transaction_id: canonicalTxId,
        store_product_id: productId,
        event_type: "initial_purchase",
        amount,
        currency: "USD",
        amember_invoice_id: `android_${canonicalTxId}`,
        purchased_at: now,
        expires_at: expiresDate,
        raw_payload: subscriptionState,
        meta: { packageName },
      });
    }

    let userProfile = await UserProfile.findOne({ amember_user_id: amemberUserId });
    const userData = await fetchUserDataByName(userProfile?.login || req.user?.login);
    if (userData?.ok) {
      await syncUserProfile(userData);
      userProfile = await UserProfile.findOne({ amember_user_id: amemberUserId });
    }

    const tokenPayload = {
      status: true,
      user_id: amemberUserId,
      login: userProfile?.login || req.user?.login,
      user_email: userProfile?.email || req.user?.user_email,
      hasActivePlan: true,
      userSubscriptionType: { [matchedProduct.amember_product_id]: formatDateForAmember(expiresDate) },
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
        userSubscriptionType: { [matchedProduct.amember_product_id]: formatDateForAmember(expiresDate) },
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
    #swagger.description = 'Reconciles active StoreKit 2 entitlements for the currently authenticated user.'
    #swagger.security = [{ "BearerAuth": [] }]
    #swagger.responses[200] = {
      description: 'Purchases restored'
    }
  */
  try {
    const rawUserId = req.user?.user_id || req.user?.amember_user_id;
    const amemberUserId = String(rawUserId).replace(/^GPT-/, "");

    // Check if the user has any active subscriptions in the DB
    const activeTx = await MobileStoreTransaction.findOne({
      amember_user_id: amemberUserId,
      platform: "ios",
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

const getSubscriptionStatus = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Get Subscription Status'
    #swagger.description = 'Returns the active subscription state for the logged-in user.'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const rawUserId = req.user?.user_id || req.user?.amember_user_id;
    const amemberUserId = String(rawUserId).replace(/^GPT-/, "");

    const userProfile = await UserProfile.findOne({ amember_user_id: amemberUserId });
    const userData = await fetchUserDataByName(userProfile?.login || req.user?.login);
    const active = userData?.ok ? isPlanActive(userData) : false;

    return res.status(200).json({
      ok: true,
      hasActivePlan: active,
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

// ── Webhooks Handlers ────────────────────────────────────────────────────────

const handleAppleWebhook = async (req, res) => {
  try {
    const { signedPayload } = req.body;
    if (!signedPayload) return res.status(400).json({ ok: false, error: "signedPayload is required" });

    let decoded;
    try {
      const bundleId = process.env.APPLE_BUNDLE_ID || "io.adsgpt.app";
      const envStr = process.env.APPLE_ENVIRONMENT || "Production";
      const environment = envStr.toLowerCase() === "sandbox" ? Environment.SANDBOX : Environment.PRODUCTION;
      const verifier = new SignedDataVerifier([], false, environment, bundleId, undefined);
      decoded = await verifier.verifyAndDecodeNotification(signedPayload);
    } catch (err) {
      console.error("[handleAppleWebhook] JWS verification failed:", err.message);
      return res.status(401).json({ ok: false, error: "Forged webhook payload." });
    }

    const eventId = decoded.notificationUUID || `apple_evt_${Date.now()}`;
    const notificationType = decoded.notificationType;

    const existing = await MobileStoreWebhookEvent.findOne({ event_id: eventId });
    if (existing) return res.status(200).json({ ok: true, message: "Duplicate event ignored." });

    await MobileStoreWebhookEvent.create({
      platform: "ios",
      event_id: eventId,
      event_type: notificationType,
      state: "processed",
      raw_payload: decoded,
    });

    if (decoded.data && decoded.data.signedTransactionInfo) {
      try {
        const bundleId = process.env.APPLE_BUNDLE_ID || "io.adsgpt.app";
        const envStr = process.env.APPLE_ENVIRONMENT || "Production";
        const environment = envStr.toLowerCase() === "sandbox" ? Environment.SANDBOX : Environment.PRODUCTION;
        const verifier = new SignedDataVerifier([], false, environment, bundleId, undefined);
        const txInfo = await verifier.verifyAndDecodeTransaction(decoded.data.signedTransactionInfo);

        const originalTransactionId = String(txInfo.originalTransactionId);

        if (notificationType === "DID_RENEW") {
          const expiresDate = new Date(txInfo.expiresDate);
          const purchaseDate = new Date(txInfo.purchaseDate);

          await MobileStoreTransaction.updateMany(
            { original_transaction_id: originalTransactionId },
            { $set: { expires_at: expiresDate, event_type: "renewal", canonical_transaction_id: String(txInfo.transactionId) } }
          );

          const existingTx = await MobileStoreTransaction.findOne({ original_transaction_id: originalTransactionId });
          if (existingTx && existingTx.amember_user_id) {
            const matchedProduct = await matchAmemberProduct(existingTx.store_product_id);
            await postAmemberInvoice({
              amemberUserId: existingTx.amember_user_id,
              canonicalTransactionId: String(txInfo.transactionId),
              platform: "ios",
              storeProductId: existingTx.store_product_id,
              matchedProduct,
              amount: existingTx.amount || 19.99,
              currency: existingTx.currency || "USD",
              purchasedAt: purchaseDate,
              expiresAt: expiresDate,
            });
          }
        } else if (notificationType === "EXPIRED" || notificationType === "REFUND" || notificationType === "REVOKE") {
          await MobileStoreTransaction.updateMany(
            { original_transaction_id: originalTransactionId },
            { $set: { expires_at: new Date() } }
          );

          if (notificationType === "REFUND" || notificationType === "REVOKE") {
            const existingTx = await MobileStoreTransaction.findOne({ original_transaction_id: originalTransactionId });
            if (existingTx && existingTx.canonical_transaction_id) {
              await deleteAmemberInvoice("ios", existingTx.canonical_transaction_id);
            }
          }
        }
      } catch (err) {
        console.error("[handleAppleWebhook] Failed to process transaction info:", err.message);
      }
    }

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
            await postAmemberInvoice({
              amemberUserId: existingTx.amember_user_id,
              canonicalTransactionId: purchaseToken,
              platform: "android",
              storeProductId: existingTx.store_product_id,
              matchedProduct,
              amount: existingTx.amount || 19.99,
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
      return res.status(502).json({
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

const getMobilePlans = async (req, res) => {
  /*
    #swagger.tags = ['Mobile Native Auth & Payments']
    #swagger.summary = 'Get mobile subscription plans'
    #swagger.description = 'Confirms the authenticated MongoDB and aMember identity, then returns direct aMember products matched by Apple / Google Store Product IDs for the native paywall.'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
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

    const platform = (req.query.platform || "ios").toLowerCase();
    if (platform !== "ios" && platform !== "android") {
      return res.status(400).json({
        ok: false,
        code: "INVALID_PLATFORM",
        error: `Unsupported platform: ${platform}. Use 'ios' or 'android'.`,
      });
    }

    const prods = await getAmemberProducts();
    const productField = platform === "ios" ? "apple_product_id" : "google_product_id";

    // Direct aMember product export — filter products that have a store product ID set for target platform
    const dynamicProds = prods.filter(
      (p) => p && p[productField] && String(p[productField]).trim() !== ""
    );

    let plans = [];
    if (dynamicProds.length > 0) {
      plans = dynamicProds.map((p) => {
        const storeProductId = String(p[productField]).trim();
        const amemberProductId = parseInt(p.product_id, 10);
        const storeProductIdLower = storeProductId.toLowerCase();
        const titleLower = (p.title || "").toLowerCase();
        const isAnnual =
          storeProductIdLower.includes("annual") ||
          storeProductIdLower.includes("year") ||
          titleLower.includes("annual") ||
          titleLower.includes("year");

        return {
          productId: storeProductId,
          amemberProductId,
          tier: p.title || "Subscription",
          fallbackTitle: p.title || "Subscription Plan",
          badge: isAnnual ? "Best Value" : null,
          platform,
          // Direct dynamic credit export raw from aMember REST API product record
          credit: p.credit || p.credits || p.credits_quota || null,
          amemberProduct: p,
        };
      });
    }

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
    await axios.get(url);

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

module.exports = {
  MobileSignup,
  GoogleSignup,
  GoogleLogin,
  AppleSignup,
  AppleLogin,
  DeleteAccount,
  AcceptMobileTerms,
  ForgotPassword,
  getMobilePlans,
  getAmemberProducts,
  postAmemberInvoice,
  deleteAmemberInvoice,
  verifyApplePayment,
  verifyGooglePayment,
  restoreApplePurchases,
  restoreGooglePurchases,
  getSubscriptionStatus,
  handleAppleWebhook,
  handleGoogleWebhook,
};
