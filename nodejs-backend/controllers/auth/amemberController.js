require('dotenv').config();
const axios = require('axios');
const dayjs = require('dayjs');
const { v4: uuidv4 } = require('uuid'); // make sure to run: npm install uuid
const { getFromAmemberUserDetails, fetchUserDataByName, fetchUserDataByName_Email } = require('./authController');
const UserProfile = require('../../Module/user/userProfileModel');

const APIKEY = process.env.AMEMBER_API_KEY;
const AMEMBER_URL = process.env.AMEMBER_BASE_API_URL;
const PRODUCT_ID = process.env.AMEMBER_PRODUCT_ID; // e.g., 8
const PLAN_DURATION_DAYS = parseInt(process.env.AMEMBER_PLAN_DURATION_DAYS || "7"); // fallback 7 days

const updateUserDetails = async (req, res) => {
    const { user_id, ...dynamicObject } = req.body;

    if (!user_id) {
        return res.status(400).json({ error: 'Missing required user_id field' });
    }

    const url = `${AMEMBER_URL}/users/${user_id}?_key=${APIKEY}`;
    const fields = new URLSearchParams(dynamicObject); // Spread dynamicObject into key-value pairs

    try {
        const response = await axios.put(url, fields.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        res.status(200).json(response.data);
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to update user details' });
    }
};


const createUserDetails = async (req,res) => {
    const url = `${AMEMBER_URL}/users`;
    const fields = new URLSearchParams({
        _key: APIKEY, 
        ...req.body,
    });

    try {
        const response = await axios.post(url, fields, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        res.status(200).json(response.data);
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to update user details' });
    }
}


function generateUserBody(userName, email) {
    const uniqueId = uuidv4().split("-")[0]; // short unique suffix
const optionalUsername = `user_${uniqueId}`;
    const optionalEmail = `${optionalUsername}@example.com`;
  
    return {
      login: userName ??optionalUsername ,
      pass: `Pass@${Math.floor(Math.random() * 100000)}`,
      email: email ?? optionalEmail,
      name_f: "Auto",
      name_l: "Generated",
    };
  }
  
  /**
   * Utility: Retry wrapper with exponential backoff
   */
  async function withRetry(fn, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === retries - 1) throw error;
        const wait = delay * Math.pow(2, i);
        console.warn(`Retrying in ${wait}ms...`);
        await new Promise(res => setTimeout(res, wait));
      }
    }
  }
  
  const createUser = async (req, res) => {
    try {  
      const userUrl = `${AMEMBER_URL}/users`;
      const accessUrl = `${AMEMBER_URL}/access`;
      const userName = req?.query?.name;
      const email = req?.query?.email;
  
      const beginDate = dayjs().format("YYYY-MM-DD");
      const expireDate = dayjs().add(PLAN_DURATION_DAYS, "day").format("YYYY-MM-DD");
  
      const checkUserData = await fetchUserDataByName_Email(userName, res, email);
  
      // ❌ User exists -> stop creation
      if (checkUserData.exists) {
        if (checkUserData.type === "email") {
          return res.status(403).json({
            success: false,
            message: "An account with the same email already exists.",
            error: "User creation failed: duplicate email"
          });
        }
  
        if (checkUserData.type === "login") {
          
            return res.status(403).json({
            success: false,
            message: `Username ${userName} is already taken. Please choose another username`,
            error: "User creation failed: duplicate username"
          });
        }
      }
  
      // 🟢 Create User Block
      const body = generateUserBody(userName, email);
  
      const userResponse = await withRetry(() => {
        const userFields = new URLSearchParams({ _key: APIKEY, ...body });
        return axios.post(userUrl, userFields, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      });
  
      const userData = userResponse.data;
      const userId = userData?.[0]?.user_id;
      const finalUserName = userData?.[0]?.login || body.login;
  
      if (!userId) throw new Error("User creation failed: user_id missing");
  
      // Assign plan
      await withRetry(() => {
        const accessFields = new URLSearchParams({
          _key: APIKEY,
          user_id: userId,
          product_id: PRODUCT_ID,
          begin_date: beginDate,
          expire_date: expireDate,
        });
  
        return axios.post(accessUrl, accessFields, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      });
  
      req.userName = finalUserName;
  
      return await getFromAmemberUserDetails(req, res, true);
  
    } catch (error) {
      const errMsg = error?.response?.data || error.message;
  
      console.error("❌ Error creating user or assigning plan:", errMsg);
  
      if (String(errMsg).includes("already exists")) {
        return res.status(409).json({
          success: false,
          message: "Username or email already exists.",
        });
      }
  
      return res.status(500).json({
        success: false,
        message: "Failed to create user or assign plan",
        error: errMsg,
      });
    }
  };



const getUserDetails = async (req,res) => {
    
    try {
        const userId = req.params.id;
        const url = `${AMEMBER_URL}/users/${userId}?_key=${APIKEY}`;
        const response = await axios.get(url);

        res.status(200).json(response.data);
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to update user details' });
    }
}

const extractUsers = (data) =>
    Object.entries(data || {})
        .filter(([key, value]) =>
            !key.startsWith("_") && typeof value === "object" && value !== null
        )
        .map(([, value]) => value);

const resolveStatusFilter = (status) => {
    if (status === "active") return "1";
    if (status === "inactive") return "0";
    return null;
};

const getAllUsers = async (req, res) => {
    try {
        const rawPage = parseInt(req.query.page ?? "1", 10);
        const rawLimit = parseInt(req.query.limit ?? "50", 10);

        const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
        const limit = Math.min(
            500,
            Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50
        );

        const search = req.query.search ? String(req.query.search).trim() : "";
        const statusFilter = resolveStatusFilter(req.query.status);

        // Search path: aMember AND-joins filters, so to do OR across fields we
        // fire one request per field, merge, and dedupe. Capped at 500 per
        // field (aMember page max) — plenty for admin searches.
        if (search) {
            const fields = ["login", "email", "name_f", "name_l"];
            const FETCH_LIMIT = 500;

            const results = await Promise.all(
                fields.map(async (field) => {
                    const p = new URLSearchParams({
                        _key: APIKEY,
                        _count: String(FETCH_LIMIT),
                        _page: "0",
                    });
                    p.append(`_filter[${field}]`, search);
                    if (statusFilter !== null) {
                        p.append("_filter[status]", statusFilter);
                    }
                    const r = await axios.get(
                        `${AMEMBER_URL}/users?${p.toString()}`
                    );
                    return extractUsers(r.data);
                })
            );

            const byId = new Map();
            for (const list of results) {
                for (const u of list) {
                    byId.set(String(u.user_id), u);
                }
            }
            const merged = Array.from(byId.values()).sort(
                (a, b) => Number(a.user_id) - Number(b.user_id)
            );

            const total = merged.length;
            const start = (page - 1) * limit;
            const slice = merged.slice(start, start + limit);

            return res.status(200).json({
                success: true,
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit) || 1,
                count: slice.length,
                users: slice,
            });
        }

        // No search: server-side pagination straight from aMember.
        const params = new URLSearchParams({
            _key: APIKEY,
            _count: String(limit),
            _page: String(page - 1),
        });
        if (statusFilter !== null) {
            params.append("_filter[status]", statusFilter);
        }

        const url = `${AMEMBER_URL}/users?${params.toString()}`;
        const response = await axios.get(url);
        const data = response.data || {};

        const total = Number.isFinite(Number(data._total))
            ? Number(data._total)
            : null;
        const users = extractUsers(data);

        res.status(200).json({
            success: true,
            page,
            limit,
            total,
            totalPages: total !== null ? Math.ceil(total / limit) : null,
            count: users.length,
            users,
        });
    } catch (error) {
        console.error(
            "Error fetching users list:",
            error.response ? error.response.data : error.message
        );
        res.status(500).json({
            success: false,
            error: "Failed to fetch users list",
        });
    }
};

const getProducts = async (req,res) => {
    
    try {
        const url = `${AMEMBER_URL}/products?_key=${APIKEY}`;
        const response = await axios.get(url);

        res.status(200).json(response.data);
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to update user details' });
    }
}

const PAGE_SIZE = 100; 
const fetchPaginatedData = async (endpoint) => {
    let allData = [];
    let page = 0;
    let totalRecords = 0;

    do {
        const response = await axios.get(`${AMEMBER_URL}/${endpoint}?_key=${APIKEY}&_count=${PAGE_SIZE}&_page=${page}`);
        const data = response.data;

        if (page === 0 && data._total) {
            totalRecords = data._total;
        }

        const records = Object.values(data).filter(record => typeof record === "object");
        allData = [...allData, ...records];

        page++;
    } while (allData.length < totalRecords);

    return allData;
};

const getUsersStats = async (req,res) => {
    try {
        const users = await fetchPaginatedData("users");
        const accessRecords = await fetchPaginatedData("access");
        let activeUsers = 0, expiredUsers = 0, idleUsers = 0, recurringUsers = 0;
        const now = Date.now();

        // Maps for fast lookups
        const userAccessMap = new Map();
        const userTransactionMap = new Map();
        const userInvoiceMap = new Map(); // NEW: Tracks multiple invoices per user

        accessRecords.forEach(record => {
            if (!record.expire_date) return;

            const userId = String(record.user_id);

            if (!userAccessMap.has(userId)) userAccessMap.set(userId, []);
            userAccessMap.get(userId).push(record);

            // Track transactions
            if (record.transaction_id) {
                if (!userTransactionMap.has(userId)) userTransactionMap.set(userId, new Set());
                userTransactionMap.get(userId).add(record.transaction_id);
            }

            // Track multiple invoices
            if (record.invoice_id) {
                if (!userInvoiceMap.has(userId)) userInvoiceMap.set(userId, new Set());
                userInvoiceMap.get(userId).add(record.invoice_id);
            }
        });

        users.forEach(user => {
            const userId = String(user.user_id);
            const subscriptions = userAccessMap.get(userId) || [];

            if (subscriptions.length === 0) {
                idleUsers++;
                return;
            }

            let hasActiveSubscription = false;
            let hasRecurringSubscription = false;
            let hasExpiredSubscriptions = false;

            subscriptions.forEach(sub => {
                const expireDate = new Date(sub.expire_date).getTime();

                if (!isNaN(expireDate)) {
                    if (expireDate > now) hasActiveSubscription = true;
                    else hasExpiredSubscriptions = true;
                }

                // Improved recurring check: Multiple transactions OR invoices
                if ((userTransactionMap.has(userId) && userTransactionMap.get(userId).size > 1) || 
                    (userInvoiceMap.has(userId) && userInvoiceMap.get(userId).size > 1) || 
                    sub.invoice_payment_id) {
                    hasRecurringSubscription = true;
                }
            });

            if (hasActiveSubscription) activeUsers++;
            else if (hasExpiredSubscriptions) expiredUsers++;

            if (hasRecurringSubscription) {
                recurringUsers++;
            }
        });

        // return { activeUsers, expiredUsers, idleUsers, recurringUsers };
        res.status(200).json({ activeUsers, expiredUsers, idleUsers, recurringUsers })
    } catch (error) {
        // console.error(" Error fetching user stats:", error.message);
        // return null;
        res.status(400).json({ error: error.message })
    }
}

// ─── DELETE /adsgpt/amember/delete-account ───────────────────────────────────
// Self-service account deletion. Identity comes from the verified JWT (req.user),
// never from the request body, so a user can only delete their own account.
//
// Flow:
//   1. Hard-delete the user in aMember (authoritative). This permanently revokes
//      access — check-access returns not-ok afterward, which is what blocks any
//      future login. If it fails we abort and leave the local profile untouched
//      so the two systems never disagree.
//   2. Soft-delete the local Mongo profile (keep the document + related data for
//      audit; just mark is_deleted / deleted_at / delete_reason).
const deleteUserAccount = async (req, res) => {
    /*  #swagger.tags = ['User Management']
        #swagger.summary = 'Delete own account (self-service)'
        #swagger.description = 'Hard-deletes the callers aMember account, then soft-deletes the local profile (sets is_deleted, deleted_at, delete_reason). Identity is taken from the JWT, never the request body. If the aMember delete fails, no local changes are made.'
        #swagger.security = [{ "BearerAuth": [] }]
        #swagger.requestBody = {
            required: false,
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            reason: { type: "string", example: "No longer needed" }
                        }
                    }
                }
            }
        }
        #swagger.responses[200] = { description: 'Account deleted in aMember and soft-deleted locally' }
        #swagger.responses[401] = { description: 'Missing Authorization token' }
        #swagger.responses[403] = { description: 'Invalid or expired token' }
        #swagger.responses[502] = { description: 'aMember delete failed; no local changes made' }
    */
    try {
        // authenticateJWT has already prefixed user_id to "GPT-<id>".
        const mongoKey = req.user?.user_id;
        const amemberId = String(mongoKey || "").replace(/^GPT-/, "");
        const reason = (req.body?.reason || "").toString().trim().slice(0, 500);

        if (!mongoKey || !amemberId) {
            return res.status(400).json({
                success: false,
                message: "Could not resolve user from token",
            });
        }

        // 1. Hard-delete in aMember (authoritative step).
        let amemberData;
        try {
            const amemberResp = await axios.delete(
                `${AMEMBER_URL}/users/${amemberId}?_key=${APIKEY}`,
            );
            amemberData = amemberResp.data;
            console.log(
                `[delete-account] aMember DELETE /users/${amemberId} →`,
                amemberResp.status,
                JSON.stringify(amemberData),
            );
        } catch (amemberErr) {
            const errMsg = amemberErr?.response?.data || amemberErr.message;
            console.error(
                `[delete-account] aMember delete threw for user ${amemberId}:`,
                errMsg,
            );
            return res.status(502).json({
                success: false,
                message: "Failed to delete account in aMember. No changes were made.",
                error: errMsg,
            });
        }

        // aMember can return HTTP 200 with an error IN THE BODY (e.g. bad _key,
        // or "record not found"). axios doesn't throw on that, so detect it here
        // and abort — otherwise we'd soft-delete locally while aMember still has
        // the user, and login would keep working.
        const amemberErrored =
            amemberData?.error === true ||
            amemberData?.ok === false ||
            (typeof amemberData === "string" && /error/i.test(amemberData));
        if (amemberErrored) {
            console.error(
                `[delete-account] aMember returned an error body for ${amemberId}:`,
                JSON.stringify(amemberData),
            );
            return res.status(502).json({
                success: false,
                message:
                    "aMember reported an error deleting the user. No local changes made.",
                amember: amemberData,
            });
        }

        // 2. Soft-delete the local profile (audit trail).
        const profile = await UserProfile.findOneAndUpdate(
            { user_id: mongoKey },
            {
                $set: {
                    is_deleted: true,
                    deleted_at: new Date(),
                    delete_reason: reason,
                },
            },
            { new: true },
        );

        if (!profile) {
            // aMember user was deleted but there was no local mirror (e.g. user
            // never completed a login that created the profile). Not an error.
            console.warn(
                `[delete-account] no local profile for ${mongoKey}; aMember user deleted anyway`,
            );
        }

        return res.status(200).json({
            success: true,
            message: "Account deleted successfully.",
            user_id: mongoKey,
            amember_deleted: true,
            soft_deleted: Boolean(profile),
            deleted_at: profile?.deleted_at || null,
        });
    } catch (error) {
        console.error(
            "[delete-account] error:",
            error?.response?.data || error.message,
        );
        return res.status(500).json({
            success: false,
            message: "Failed to delete account",
            error: error.message,
        });
    }
};

module.exports = {
    updateUserDetails,
    createUserDetails,
    getUserDetails,
    getAllUsers,
    getProducts,
    getUsersStats,
    createUser,
    deleteUserAccount
};