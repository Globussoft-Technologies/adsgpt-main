// ─── Schedule sub-schema ──────────────────────────────────────────────────────

exports.autopilotSchedule = {
  frequency: "custom",
  startDate: "2026-06-01T00:00:00.000Z",
  endDate: "2026-12-31T00:00:00.000Z",
  customFrequency: {
    repeatEvery: 1,
    repeatUnit: "week",
    repeatOnDays: ["monday", "thursday"],
  },
  timezone: "America/New_York",
};

// ─── Meta targets sub-schema ──────────────────────────────────────────────────

exports.autopilotTargets = {
  meta: {
    adAccountId: "act_1234567890",
    pageId: "987654321",
    campaignId: "23456789012345",
    adSetId: "34567890123456",
    leadFormId: "45678901234567",
  },
};

// ─── Create job ───────────────────────────────────────────────────────────────

exports.createAutopilotJobPayload = {
  campaignId: "6630f1a2b3c4d5e6f7890abc",
  schedule: {
    frequency: "custom",
    customFrequency: {
      repeatEvery: 2,
      repeatUnit: "week",
      repeatOnDays: ["monday", "thursday"],
    },
    startDate: "2026-06-01T00:00:00.000Z",
    endDate: "2026-12-31T00:00:00.000Z",
    timezone: "America/New_York",
  },
  pairsPerCycle: 2,
  model: "gpt-4o",
  callToAction: ["Shop Now", "Learn More"],
  destinationUrl: "https://brand.com/summer-sale",
  targets: {
    meta: {
      adAccountId: "act_1234567890",
      pageId: "987654321",
      campaignId: "23456789012345",
      adSetId: "34567890123456",
      leadFormId: "45678901234567",
    },
  },
};

// ─── Update job ───────────────────────────────────────────────────────────────

exports.updateAutopilotJobPayload = {
  pairsPerCycle: 3,
  callToAction: ["Buy Now"],
  destinationUrl: "https://brand.com/new-landing",
};

// ─── Response schemas ─────────────────────────────────────────────────────────

exports.autopilotJobResponse = {
  success: true,
  data: {
    _id: "6630f1a2b3c4d5e6f7890abc",
    userId: "user_abc123",
    campaignId: "6630f1a2b3c4d5e6f7890abc",
    status: "active",
    schedule: {
      frequency: "custom",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-12-31T00:00:00.000Z",
      customFrequency: {
        repeatEvery: 2,
        repeatUnit: "week",
        repeatOnDays: ["monday", "thursday"],
      },
      timezone: "America/New_York",
      cronExpression: "0 9 * * 1,4",
      nextRunAt: "2026-06-02T09:00:00.000Z",
      lastRunAt: null,
    },
    pairsPerCycle: 2,
    model: "gpt-4o",
    callToAction: ["Shop Now", "Learn More"],
    destinationUrl: "https://brand.com/summer-sale",
    targets: {
      meta: {
        adAccountId: "act_1234567890",
        pageId: "987654321",
        campaignId: "23456789012345",
        adSetId: "34567890123456",
        leadFormId: "45678901234567",
      },
    },
    totalRuns: 3,
    failedRuns: 0,
    runHistory: [],
    createdAt: "2026-05-19T10:00:00.000Z",
    updatedAt: "2026-05-19T10:00:00.000Z",
  },
};

exports.autopilotJobListResponse = {
  success: true,
  total: 42,
  page: 1,
  data: [
    {
      _id: "6630f1a2b3c4d5e6f7890abc",
      userId: "user_abc123",
      campaignId: {
        _id: "6630f1a2b3c4d5e6f7890abc",
        metadata: { name: "Summer Campaign" },
        brandInfo: { brandName: "Acme" },
        distribution: {},
        status: "published",
      },
      status: "active",
      schedule: { frequency: "weekly", timezone: "America/New_York" },
      pairsPerCycle: 2,
      totalRuns: 3,
      failedRuns: 0,
      createdAt: "2026-05-19T10:00:00.000Z",
    },
  ],
};

exports.autopilotRunHistoryResponse = {
  success: true,
  total: 3,
  failedRuns: 0,
  page: 1,
  data: [
    {
      runId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      startedAt: "2026-05-19T09:00:00.000Z",
      completedAt: "2026-05-19T09:02:14.000Z",
      status: "success",
      metaAdId: "120213456789012",
      googleAdId: null,
      platformAdIds: {},
      error: null,
    },
    {
      runId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      startedAt: "2026-05-12T09:00:00.000Z",
      completedAt: "2026-05-12T09:01:55.000Z",
      status: "partial",
      metaAdId: null,
      googleAdId: null,
      platformAdIds: {},
      error: "Meta API rate limit exceeded",
    },
  ],
};
