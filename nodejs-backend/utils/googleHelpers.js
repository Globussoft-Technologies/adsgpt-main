function formatBudget(amountMicros, currency) {
  const value = amountMicros ? Number(amountMicros) / 1e6 : 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
  }).format(value);
}

// Google Ads campaign status enum
// 2 = ENABLED, 3 = PAUSED, 4 = REMOVED
function formatStatus(statusEnum) {
  const map = {
    2: "ACTIVE",
    3: "PAUSED",
    4: "REMOVED",
    ENABLED: "ACTIVE",
    PAUSED: "PAUSED",
    REMOVED: "REMOVED",
  };
  return map[statusEnum] || map[String(statusEnum).toUpperCase()] || null;
}

// Google Ads bidding strategy enum
function formatBiddingStrategy(val) {
  const map = {
    2: "MANUAL_CPC",
    3: "MANUAL_CPM",
    4: "PAGE_ONE_PROMOTED",
    6: "TARGET_SPEND",
    7: "TARGET_CPA",
    8: "TARGET_ROAS",
    9: "MAXIMIZE_CONVERSIONS",
    10: "MAXIMIZE_CONVERSION_VALUE",
    11: "TARGET_IMPRESSION_SHARE",
    14: "MANUAL_CPV",
    16: "COMMISSION",
    17: "ENHANCED_CPC",
    MANUAL_CPC: "MANUAL_CPC",
    MANUAL_CPM: "MANUAL_CPM",
    TARGET_SPEND: "TARGET_SPEND",
    TARGET_CPA: "TARGET_CPA",
    TARGET_ROAS: "TARGET_ROAS",
    MAXIMIZE_CONVERSIONS: "MAXIMIZE_CONVERSIONS",
    MAXIMIZE_CONVERSION_VALUE: "MAXIMIZE_CONVERSION_VALUE",
    TARGET_IMPRESSION_SHARE: "TARGET_IMPRESSION_SHARE",
    MANUAL_CPV: "MANUAL_CPV",
    COMMISSION: "COMMISSION",
    ENHANCED_CPC: "ENHANCED_CPC",
  };
  return map[val] || map[String(val).toUpperCase()] || null;
}

// Google Ads advertising channel type enum
function formatChannelType(val) {
  const map = {
    2: "SEARCH",
    3: "DISPLAY",
    4: "SHOPPING",
    5: "HOTEL",
    6: "VIDEO",
    7: "MULTI_CHANNEL",
    8: "LOCAL",
    9: "SMART",
    10: "PERFORMANCE_MAX",
    11: "LOCAL_SERVICES",
    12: "DISCOVERY",
    13: "TRAVEL",
    SEARCH: "SEARCH",
    DISPLAY: "DISPLAY",
    SHOPPING: "SHOPPING",
    HOTEL: "HOTEL",
    VIDEO: "VIDEO",
    MULTI_CHANNEL: "MULTI_CHANNEL",
    LOCAL: "LOCAL",
    SMART: "SMART",
    PERFORMANCE_MAX: "PERFORMANCE_MAX",
    LOCAL_SERVICES: "LOCAL_SERVICES",
    DISCOVERY: "DISCOVERY",
    TRAVEL: "TRAVEL",
  };
  return map[val] || map[String(val).toUpperCase()] || null;
}

function sanitizeId(val) {
  if (val == null) return null;
  const numeric = Number(String(val).replace(/[^\d]/g, ""));
  return Number.isNaN(numeric) ? null : numeric;
}

function formatAccountStatus(val) {
  const map = {
    2: "ENABLED",
    3: "PAUSED",
    4: "CANCELED",
    5: "SUSPENDED",
    6: "CLOSED",
    ENABLED: "ENABLED",
    PAUSED: "PAUSED",
    CANCELED: "CANCELED",
    SUSPENDED: "SUSPENDED",
    CLOSED: "CLOSED",
  };
  return map[val] || map[String(val).toUpperCase()] || "UNKNOWN";
}

module.exports = { formatBudget, formatStatus, formatAccountStatus, formatBiddingStrategy, formatChannelType, sanitizeId };
