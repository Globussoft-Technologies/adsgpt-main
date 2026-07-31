const mobileStorePlans = Object.freeze({
  ios: Object.freeze([
    { level: 1, productId: "io.adsgpt.app.subscription.scale.monthly2", badge: null },
    { level: 2, productId: "io.adsgpt.app.subscription.growth.monthly", badge: null },
    { level: 3, productId: "io.adsgpt.app.subscription.creator.monthly", badge: "Most Popular" },
    { level: 4, productId: "io.adsgpt.app.subscription.individual.monthly", badge: null },
    { level: 4, productId: "io.adsgpt.app.subscription.individual.annual", badge: null },
    { level: 5, productId: "io.adsgpt.app.subscription.starter.monthly", badge: null },
    { level: 5, productId: "io.adsgpt.app.subscription.starter.annual", badge: null },
  ]),
  // Temporary Google Play IDs. Replace these with the final Play Console
  // product IDs when they are available.
  android: Object.freeze([
    { level: 1, productId: "io.adsgpt.app.subscription.scale.monthly2", badge: null },
    { level: 2, productId: "io.adsgpt.app.subscription.growth.monthly", badge: null },
    { level: 3, productId: "io.adsgpt.app.subscription.creator.monthly", badge: "Most Popular" },
    { level: 4, productId: "io.adsgpt.app.subscription.individual.monthly", badge: null },
    { level: 4, productId: "io.adsgpt.app.subscription.individual.annual", badge: null },
    { level: 5, productId: "io.adsgpt.app.subscription.starter.monthly", badge: null },
    { level: 5, productId: "io.adsgpt.app.subscription.starter.annual", badge: null },
  ]),
});

module.exports = mobileStorePlans;
