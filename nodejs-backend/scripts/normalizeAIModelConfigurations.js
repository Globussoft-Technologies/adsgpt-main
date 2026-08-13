#!/usr/bin/env node

require("dotenv").config();

const connectMongoDB = require("../db/mongo");
const AIModelConfiguration = require("../Module/aiModel/aiModelConfiguration");

async function normalize() {
  await connectMongoDB();
  const result = await AIModelConfiguration.updateMany(
    { type: "image" },
    { $unset: { credits: 1, pricing: 1 } },
  );
  console.log(`Normalized ${result.modifiedCount ?? result.nModified ?? 0} image model configurations`);
}

if (require.main === module) {
  normalize()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("AI model configuration normalization failed:", error);
      process.exit(1);
    });
}

module.exports = normalize;
