const dayjs = require("dayjs");

const MOCK_ACCOUNT_IDS = ["7984091200", "1023579450", "5551234567", "9998887777"];

const mockAccounts = [
  {
    id: "1023579450",
    name: "aroohi enterprises (102-357-9450)",
    status: "ENABLED",
    rawStatus: "ENABLED",
    currency: "INR",
    timezone: "Asia/Calcutta",
    isManager: false,
    isTestAccount: false,
    loginCustomerId: "1023579450",
  },
  {
    id: "7984091200",
    name: "AdsGPT Demo Account",
    status: "ENABLED",
    rawStatus: "ENABLED",
    currency: "USD",
    timezone: "America/New_York",
    isManager: true,
    isTestAccount: true,
    loginCustomerId: "7984091200",
  },
  {
    id: "5551234567",
    name: "Client Beta Account",
    status: "PAUSED",
    rawStatus: "PAUSED",
    currency: "EUR",
    timezone: "Europe/London",
    isManager: false,
    isTestAccount: false,
    loginCustomerId: "5551234567",
  },
  {
    id: "9998887777",
    name: "Suspended Test Account",
    status: "PRODUCTION_BLOCKED",
    rawStatus: "SUSPENDED",
    currency: "USD",
    timezone: "America/Los_Angeles",
    isManager: false,
    isTestAccount: true,
    loginCustomerId: "9998887777",
  },
];

const mockCampaigns = [
  {
    id: "238314767648",
    name: "Summer Sale Search Campaign",
    status: "Enabled",
    primaryStatus: "ELIGIBLE",
    servingStatus: "SERVING",
    channelType: "Search",
    objective: "Search",
    biddingStrategy: "Manual Cpc",
    budgetMicros: 50000000,
    budget: "$50.00",
    budgetPeriod: "DAILY",
    adGroups: [
      {
        id: "195103467343",
        name: "Running Shoes",
        status: "Enabled",
        type: "SEARCH_STANDARD",
        targetCpa: null,
        targetRoas: null,
        campaignId: "238314767648",
        campaignName: "Summer Sale Search Campaign",
      },
      {
        id: "195103467344",
        name: "Sports Apparel",
        status: "Enabled",
        type: "SEARCH_STANDARD",
        targetCpa: null,
        targetRoas: null,
        campaignId: "238314767648",
        campaignName: "Summer Sale Search Campaign",
      },
    ],
  },
  {
    id: "238314767649",
    name: "Brand Awareness Display",
    status: "Enabled",
    primaryStatus: "ELIGIBLE",
    servingStatus: "SERVING",
    channelType: "Display",
    objective: "Display",
    biddingStrategy: "Target Cpm",
    budgetMicros: 30000000,
    budget: "$30.00",
    budgetPeriod: "DAILY",
    adGroups: [
      {
        id: "195103467345",
        name: "Retargeting",
        status: "Enabled",
        type: "DISPLAY_STANDARD",
        targetCpa: null,
        targetRoas: null,
        campaignId: "238314767649",
        campaignName: "Brand Awareness Display",
      },
    ],
  },
  {
    id: "238314767650",
    name: "Holiday Promo - Paused",
    status: "Paused",
    primaryStatus: "PAUSED",
    servingStatus: "NONE",
    channelType: "Search",
    objective: "Search",
    biddingStrategy: "Target Cpa",
    budgetMicros: 20000000,
    budget: "$20.00",
    budgetPeriod: "DAILY",
    adGroups: [],
  },
];

const mockAdGroups = [
  {
    id: "195103467343",
    name: "Running Shoes",
    status: "Enabled",
    type: "SEARCH_STANDARD",
    targetCpa: null,
    targetRoas: null,
    campaignId: "238314767648",
    campaignName: "Summer Sale Search Campaign",
  },
  {
    id: "195103467344",
    name: "Sports Apparel",
    status: "Enabled",
    type: "SEARCH_STANDARD",
    targetCpa: null,
    targetRoas: null,
    campaignId: "238314767648",
    campaignName: "Summer Sale Search Campaign",
  },
  {
    id: "195103467345",
    name: "Retargeting",
    status: "Enabled",
    type: "DISPLAY_STANDARD",
    targetCpa: null,
    targetRoas: null,
    campaignId: "238314767649",
    campaignName: "Brand Awareness Display",
  },
];

const mockAds = [
  {
    id: "ad-rsa-001",
    name: "Running Shoes RSA 1",
    status: "Enabled",
    type: "RESPONSIVE_SEARCH_AD",
    finalUrls: ["https://www.example.com/running-shoes"],
    adGroupId: "195103467343",
    adGroupName: "Running Shoes",
    campaignId: "238314767648",
    campaignName: "Summer Sale Search Campaign",
    content: {
      headlines: [
        "Buy Running Shoes Online",
        "Top Brands at Best Prices",
        "Free Shipping Over $50",
        "Shop Running Shoes Now",
        "Huge Summer Sale On",
      ],
      descriptions: [
        "Shop the best running shoes online. Trusted by thousands of athletes worldwide.",
        "Get top brands at unbeatable prices. Free shipping on orders over $50.",
      ],
    },
    policySummary: {
      approvalStatus: "APPROVED",
      reviewStatus: "REVIEWED",
    },
    metrics: {
      clicks: 320,
      impressions: 12400,
      ctr: 2.58,
      averageCpc: 0.85,
      costMicros: 272000000,
      conversions: 18,
      costPerConversion: 15.11,
    },
  },
  {
    id: "ad-rsa-002",
    name: "Running Shoes RSA 2",
    status: "Enabled",
    type: "RESPONSIVE_SEARCH_AD",
    finalUrls: ["https://www.example.com/running-shoes/sale"],
    adGroupId: "195103467343",
    adGroupName: "Running Shoes",
    campaignId: "238314767648",
    campaignName: "Summer Sale Search Campaign",
    content: {
      headlines: [
        "Running Shoes Sale",
        "Up to 40% Off Today",
        "Shop Now Pay Later",
        "Best Sellers In Stock",
      ],
      descriptions: [
        "Massive discounts on top running shoe brands. Limited time offer.",
        "Shop now and pay later with our easy installment plans.",
      ],
    },
    policySummary: {
      approvalStatus: "APPROVED",
      reviewStatus: "REVIEWED",
    },
    metrics: {
      clicks: 210,
      impressions: 9800,
      ctr: 2.14,
      averageCpc: 0.92,
      costMicros: 193200000,
      conversions: 12,
      costPerConversion: 16.1,
    },
  },
  {
    id: "ad-rda-001",
    name: "Retargeting Display Ad",
    status: "Enabled",
    type: "RESPONSIVE_DISPLAY_AD",
    finalUrls: ["https://www.example.com/offers"],
    adGroupId: "195103467345",
    adGroupName: "Retargeting",
    campaignId: "238314767649",
    campaignName: "Brand Awareness Display",
    content: {
      headlines: ["Come Back & Save", "Exclusive Offers Just For You"],
      descriptions: [
        "We noticed you left something behind. Come back and complete your purchase today.",
      ],
      marketingImages: [],
      logoImages: [],
      businessName: "AdsGPT Demo Store",
    },
    policySummary: {
      approvalStatus: "APPROVED",
      reviewStatus: "REVIEWED",
    },
    metrics: {
      clicks: 95,
      impressions: 28000,
      ctr: 0.34,
      averageCpc: 0.45,
      costMicros: 42750000,
      conversions: 5,
      costPerConversion: 8.55,
    },
  },
];

// Mirrors datePresetToRange() in googleAdController — returns exact day count
// so mock chart rows cover the same calendar window as real GAQL queries.
function resolveDays(preset) {
  const today = dayjs();
  const quarter = Math.floor(today.month() / 3);
  const thisQStart = today.startOf("year").add(quarter * 3, "month");
  const lastQStart = thisQStart.subtract(3, "month");
  const map = {
    today:        1,
    yesterday:    1,
    last_3d:      3,
    last_7d:      7,
    last_14d:     14,
    last_28d:     28,
    last_30d:     30,
    last_90d:     90,
    this_month:   today.date(),
    last_month:   today.subtract(1, "month").daysInMonth(),
    this_quarter: today.diff(thisQStart, "day") + 1,
    last_quarter: thisQStart.diff(lastQStart, "day"),
    this_year:    today.diff(today.startOf("year"), "day") + 1,
    last_year:    today.subtract(1, "year").endOf("year").diff(today.subtract(1, "year").startOf("year"), "day") + 1,
    lifetime:     365 * 3,
    maximum:      365 * 3,
  };
  return map[preset] || 30;
}

// Generate chart data for a given number of days
function buildDailyRows(days) {
  // Use a seeded-ish value per day so the data looks stable on re-fetch
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dayjs().subtract(i, "day");
    const seed = d.date() + d.month() * 31;
    const spend = parseFloat(((seed % 30) + 10 + Math.random() * 5).toFixed(2));
    const conversions = Math.floor((seed % 4) + Math.random() * 2);
    const clicks = Math.floor((seed % 40) + 20 + Math.random() * 20);
    const impressions = Math.floor(clicks / (0.01 + (seed % 3) * 0.005 + 0.005));
    rows.push({
      name: d.format("D MMM"),
      fullDate: d.format("YYYY-MM-DD"),
      date: d.format("YYYY-MM-DD"),
      spend,
      conversions,
      clicks,
      cpa: conversions > 0 ? parseFloat((spend / conversions).toFixed(2)) : 0,
      impressions,
      ctr: parseFloat(((clicks / impressions) * 100).toFixed(2)),
      cpc: parseFloat((spend / (clicks || 1)).toFixed(2)),
      cpm: parseFloat(((spend / (impressions || 1)) * 1000).toFixed(2)),
      conversionValue: parseFloat((conversions * 30).toFixed(2)),
      viewThroughConversions: 0,
    });
  }
  return rows;
}

function googleMockMiddleware(req, res, next) {
  const originalJson = res.json;
  const isGetAccounts = req.path === "/get-ad-accounts";

  const requestedAccountId =
    req.query.adAccountId ||
    req.query.customerId ||
    req.body?.adAccountId ||
    req.body?.customerId;

  const isMockAccount = MOCK_ACCOUNT_IDS.includes(requestedAccountId);

  if (isGetAccounts) {
    res.json = function (body) {
      if (body && body.status && Array.isArray(body.adAccounts)) {
        mockAccounts.forEach((mockAcc) => {
          if (!body.adAccounts.find((a) => a.id === mockAcc.id)) {
            body.adAccounts.push(mockAcc);
          }
        });
        body.count = body.adAccounts.length;
        body.hasNoAccount = body.adAccounts.length === 0;
      } else if (body && body.status === true && !body.adAccounts) {
        body.adAccounts = [...mockAccounts];
        body.count = mockAccounts.length;
        body.hasNoAccount = false;
      }
      return originalJson.call(this, body);
    };
    return next();
  }

  if (!isMockAccount) {
    return next();
  }

  const path = req.path;

  // ── Campaigns ──────────────────────────────────────────────────────────────
  if (path === "/get-campaigns") {
    const adAccountId = requestedAccountId;
    if (adAccountId) {
      return res.status(200).json({
        status: true,
        campaigns: mockCampaigns,
        count: mockCampaigns.length,
        accountId: adAccountId,
        loginCustomerId: adAccountId,
      });
    }
    return res.status(200).json({
      status: true,
      data: [
        {
          accountId: "1023579450",
          loginCustomerId: "1023579450",
          campaigns: mockCampaigns,
          campaignCount: mockCampaigns.length,
        },
      ],
      totalAccounts: 1,
      totalCampaigns: mockCampaigns.length,
      totalAdGroups: mockAdGroups.length,
    });
  }

  // ── Ad Groups ──────────────────────────────────────────────────────────────
  if (path === "/get-ad-groups") {
    const cmpId = req.query.campaignId;
    const groups = cmpId
      ? mockAdGroups.filter((g) => g.campaignId === cmpId)
      : mockAdGroups;
    return res.status(200).json({
      status: true,
      adGroups: groups,
      count: groups.length,
      accountId: requestedAccountId,
      campaignId: cmpId || null,
      loginCustomerId: requestedAccountId,
    });
  }

  // ── Ads ────────────────────────────────────────────────────────────────────
  if (path === "/get-campaign-ads") {
    const cmpId = req.query.campaignId;
    const ads = cmpId
      ? mockAds.filter((a) => a.campaignId === cmpId)
      : mockAds;
    return res.status(200).json({
      status: true,
      ads,
      count: ads.length,
      accountId: requestedAccountId,
      campaignId: cmpId || null,
      loginCustomerId: requestedAccountId,
    });
  }

  if (path === "/get-ad-group-ads") {
    const agId = req.query.adGroupId;
    const ads = agId ? mockAds.filter((a) => a.adGroupId === agId) : mockAds;
    return res.status(200).json({
      status: true,
      ads,
      count: ads.length,
      accountId: requestedAccountId,
      adGroupId: agId || null,
      loginCustomerId: requestedAccountId,
    });
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  if (path === "/get-dashboard-data") {
    const chartData = buildDailyRows(resolveDays(req.query.datePreset));
    const totalSpend = parseFloat(
      chartData.reduce((s, r) => s + r.spend, 0).toFixed(2)
    );
    const totalConversions = chartData.reduce((s, r) => s + r.conversions, 0);
    return res.status(200).json({
      status: true,
      stats: {
        totalSpend,
        totalConversions,
        avgCpa:
          totalConversions > 0
            ? parseFloat((totalSpend / totalConversions).toFixed(2))
            : 0,
        activeCampaigns: 2,
      },
      chartData,
    });
  }

  // ── Analytics ──────────────────────────────────────────────────────────────
  if (path === "/get-analytics-data") {
    const allRows = buildDailyRows(resolveDays(req.query.datePreset));
    const chartData = allRows.map((r) => ({ name: r.name, spend: r.spend, clicks: r.clicks }));
    const totSpend = parseFloat(allRows.reduce((s, r) => s + r.spend, 0).toFixed(2));
    const totImpressions = allRows.reduce((s, r) => s + r.impressions, 0);
    const totClicks = allRows.reduce((s, r) => s + r.clicks, 0);
    const totConversions = allRows.reduce((s, r) => s + r.conversions, 0);
    const totConversionsValue = allRows.reduce((s, r) => s + r.conversionValue, 0);
    const totViewThroughConversions = allRows.reduce((s, r) => s + r.viewThroughConversions, 0);

    const avgCtr = totImpressions > 0 ? parseFloat(((totClicks / totImpressions) * 100).toFixed(2)) : 0;
    const avgCpc = totClicks > 0 ? parseFloat((totSpend / totClicks).toFixed(2)) : 0;
    const avgCpm = totImpressions > 0 ? parseFloat(((totSpend / totImpressions) * 1000).toFixed(2)) : 0;

    const currReach = totImpressions ? Math.round(totImpressions * 0.85) : 0;
    const currFreq = currReach > 0 ? parseFloat((totImpressions / currReach).toFixed(2)) : 0;

    return res.status(200).json({
      status: true,
      stats: {
        spend: { val: totSpend, change: 12.4 },
        impressions: { val: totImpressions, change: 8.1 },
        clicks: { val: totClicks, change: 5.7 },
        ctr: { val: avgCtr, change: -0.3 },
        cpc: { val: avgCpc, change: -3.2 },
        cpm: { val: avgCpm, change: 2.1 },
        reach: { val: currReach, change: 7.9 },
        frequency: { val: currFreq, change: 0.2 },
      },
      chartData,
      actions: [
        { action_type: "conversions", value: totConversions },
        { action_type: "conversions_value", value: parseFloat(totConversionsValue.toFixed(2)) },
        { action_type: "view_through_conversions", value: totViewThroughConversions }
      ]
    });
  }

  // ── Insights ───────────────────────────────────────────────────────────────
  if (path === "/get-insights") {
    const level = req.query.level || "account";
    const cmpId = req.query.campaignId;
    const agId = req.query.adGroupId;
    const rows = buildDailyRows(resolveDays(req.query.datePreset)).map((r) => {
      const row = {
        date: r.date,
        spend: r.spend,
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: r.ctr,
        cpc: r.cpc,
        cpm: r.cpm,
        conversions: r.conversions,
        conversionValue: r.conversionValue,
        cpa: r.cpa,
        viewThroughConversions: 0,
      };
      if (level === "campaign" || cmpId) {
        row.campaignId = cmpId || "238314767648";
        row.campaignName = "Summer Sale Search Campaign";
      }
      if (level === "adgroup" || agId) {
        row.campaignId = cmpId || "238314767648";
        row.campaignName = "Summer Sale Search Campaign";
        row.adGroupId = agId || "195103467343";
        row.adGroupName = "Running Shoes";
      }
      if (level === "ad") {
        row.campaignId = cmpId || "238314767648";
        row.campaignName = "Summer Sale Search Campaign";
        row.adGroupId = agId || "195103467343";
        row.adGroupName = "Running Shoes";
        row.adId = "ad-rsa-001";
      }
      return row;
    });
    return res.status(200).json({ status: true, level, insights: rows });
  }

  // ── Audit ──────────────────────────────────────────────────────────────────
  if (path === "/audit") {
    return res.status(200).json({
      status: true,
      summary: { critical: 1, warning: 2, opportunity: 3 },
      findings: [
        {
          rule_id: "GAUD-001",
          severity: "critical",
          entity_type: "ad",
          entity_id: "ad-rsa-002",
          entity_name: "Running Shoes RSA 2",
          message: "Ad has low Quality Score — improve headline relevance",
        },
        {
          rule_id: "GAUD-002",
          severity: "warning",
          entity_type: "campaign",
          entity_id: "238314767648",
          entity_name: "Summer Sale Search Campaign",
          message: "Daily budget may be limiting impressions during peak hours",
        },
        {
          rule_id: "GAUD-003",
          severity: "warning",
          entity_type: "adgroup",
          entity_id: "195103467344",
          entity_name: "Sports Apparel",
          message: "Ad group has no active ads",
        },
        {
          rule_id: "GAUD-004",
          severity: "opportunity",
          entity_type: "campaign",
          entity_id: "238314767649",
          entity_name: "Brand Awareness Display",
          message: "Enable responsive display ads to increase reach",
        },
        {
          rule_id: "GAUD-005",
          severity: "opportunity",
          entity_type: "campaign",
          entity_id: "238314767648",
          entity_name: "Summer Sale Search Campaign",
          message: "Add sitelink extensions to improve CTR",
        },
        {
          rule_id: "GAUD-006",
          severity: "opportunity",
          entity_type: "adgroup",
          entity_id: "195103467343",
          entity_name: "Running Shoes",
          message: "Add at least 3 RSAs per ad group for better coverage",
        },
      ],
    });
  }

  // ── Mutations (create / update / delete) ───────────────────────────────────
  if (
    path === "/create-campaign" ||
    path === "/create-ad-group" ||
    path === "/ads" ||
    path === "/ads/create" ||
    path === "/update-status" ||
    path === "/delete-campaign"
  ) {
    return res
      .status(200)
      .json({ status: true, message: "Mock action successful", data: { mock: true } });
  }

  if (path === "/upload-image") {
    return res.status(200).json({
      status: true,
      assetResourceName: `customers/${requestedAccountId}/assets/mock-image-123`,
    });
  }

  if (path.startsWith("/ads/") && path !== "/ads/create") {
    return res.status(200).json({ status: true, ad: mockAds[0] });
  }

  if (path === "/check-account") {
    return res
      .status(200)
      .json({ status: true, isAccessible: true, accountStatus: "ENABLED" });
  }

  next();
}

module.exports = googleMockMiddleware;
