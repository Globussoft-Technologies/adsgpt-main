const mobileStorePlans = Object.freeze({
  ios: Object.freeze([
    { level: 1, productId: "io.adsgpt.app.subscription.scale.monthly2" },
    { level: 2, productId: "io.adsgpt.app.subscription.growth.monthly" },
    { level: 3, productId: "io.adsgpt.app.subscription.creator.monthly" },
    { level: 4, productId: "io.adsgpt.app.subscription.individual.monthly" },
    { level: 4, productId: "io.adsgpt.app.subscription.individual.annual" },
    { level: 5, productId: "io.adsgpt.app.subscription.starter.monthly" },
    { level: 5, productId: "io.adsgpt.app.subscription.starter.annual" },
  ]),
  // Temporary Google Play IDs. Replace these with the final Play Console
  // product IDs when they are available.
  android: Object.freeze([
    { level: 1, productId: "io.adsgpt.app.subscription.scale.monthly2" },
    { level: 2, productId: "io.adsgpt.app.subscription.growth.monthly" },
    { level: 3, productId: "io.adsgpt.app.subscription.creator.monthly" },
    { level: 4, productId: "io.adsgpt.app.subscription.individual.monthly" },
    { level: 4, productId: "io.adsgpt.app.subscription.individual.annual" },
    { level: 5, productId: "io.adsgpt.app.subscription.starter.monthly" },
    { level: 5, productId: "io.adsgpt.app.subscription.starter.annual" },
  ]),
});

module.exports = mobileStorePlans;
