const creditConfig = {
  development: {
    // * 1 day plans
    8: { name: "Free 7 days", credits: 35, durationDays: 7 },

    // * 30 day plans
    25: { name: "Basic 30 days", credits: 250, durationDays: 30 },
    23: { name: "Starter 30 days", credits: 500, durationDays: 30 },
    2: { name: "Individual 30 days", credits: 1000, durationDays: 30 },
    3: { name: "Creator 30 days", credits: 2000, durationDays: 30 },
    5: { name: "Growth 30 days", credits: 4100, durationDays: 30 },
    9: { name: "Scale 30 days", credits: 6200, durationDays: 30 },

    // * 1 year plans
    24: { name: "Starter 1 year", credits: 6000, durationDays: 365 },
    12: { name: "Individual 1 year", credits: 13200, durationDays: 365 },

    // * Test plan
    26: { name: "Test Plan", credits: 100 },
  },
  production: {
    // * 1 day plans
    8: { name: "Free 7 days", credits: 35, durationDays: 7 },
    19: { name: "Free 7 days", credits: 35, durationDays: 7 },

    // * 30 day plans
    26: { name: "Basic 30 days", credits: 250, durationDays: 30 },
    20: { name: "Starter days", credits: 500, durationDays: 30 },
    2: { name: "Individual 30 days", credits: 1000, durationDays: 30 },
    23: { name: "Creator 30 days", credits: 2000, durationDays: 30 },
    24: { name: "Growth 30 days", credits: 4100, durationDays: 30 },
    25: { name: "Scale 30 days", credits: 6200, durationDays: 30 },

    // * 1 year plans
    21: { name: "Starter 1 year", credits: 6000, durationDays: 365 },
    9: { name: "Individual 1 year", credits: 13200, durationDays: 365 },

    // * Test plan
    27: { name: "Test Plan", credits: 100 },
  },
};

module.exports = creditConfig;
