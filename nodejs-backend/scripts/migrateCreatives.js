const path = require("path");
// Load .env from the backend root so the script works regardless of the cwd
// it's launched from (e.g. when run from scripts/).
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");
const logger = require("../utils/logger");

// Import models
const ImageGeneration = require("../Module/imageGeneration/imageModel");

// ============================================================
// SAFETY CHECK: Prevent migration on production databases
// ============================================================
const validateEnvironment = () => {
  const mode = process.env.MODE || "";
  const mongoUrl = process.env.MONGO_CONNECTION_STRING || "";

  // List of production indicators to block
  const productionKeywords = [
    "prod",
    "production",
    "adsgpt.io",
    "poweradspy.com",
    "mongodb.net", // Atlas production cluster
  ];

  const isProduction = productionKeywords.some((keyword) =>
    mongoUrl.toLowerCase().includes(keyword)
  );

  if (isProduction || mode.toUpperCase() === "PROD") {
    console.error("\n❌ SAFETY BLOCK: PRODUCTION DATABASE DETECTED!");
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error(`MODE: ${mode}`);
    console.error(`DATABASE: ${mongoUrl}`);
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error(
      "\n⚠️  This migration script is BLOCKED from running on PRODUCTION."
    );
    console.error("⚠️  To run on production, you must:");
    console.error("   1. Create a separate, reviewed migration script");
    console.error("   2. Add explicit --force-prod flag");
    console.error("   3. Back up the database first");
    console.error("\nAborted for safety.\n");
    process.exit(1);
  }

  logger.info(`✓ Environment check passed: MODE=${mode}, DB=localhost`);
};

// Connect to MongoDB
const connectDB = async () => {
  try {
    const mongoUrl =
      process.env.MONGO_CONNECTION_STRING || process.env.MONGODB_URI;

    if (!mongoUrl) {
      throw new Error("MONGO_CONNECTION_STRING or MONGODB_URI not set in .env");
    }

    await mongoose.connect(mongoUrl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    logger.info("✓ MongoDB connected for migration");
    logger.info(`  Database: ${mongoUrl}`);
  } catch (error) {
    logger.error("MongoDB connection error:", error);
    process.exit(1);
  }
};

// Convert aspect ratio format: "ASPECT_9_16" -> "9:16"
const convertAspectRatio = (aspectRatio) => {
  if (!aspectRatio) return "1:1";

  const mapping = {
    ASPECT_9_16: "9:16",
    ASPECT_1_1: "1:1",
    ASPECT_16_9: "16:9",
    ASPECT_2_3: "2:3",
    ASPECT_3_2: "3:2",
    "9:16": "9:16",
    "1:1": "1:1",
    "16:9": "16:9",
    "2:3": "2:3",
    "3:2": "3:2",
  };

  return mapping[aspectRatio] || "1:1";
};

// Map model names from adCreative to standard models
const mapModel = (model) => {
  const mapping = {
    "ADSGPT-2.0": "gemini-3-pro-image-preview",
    "ADSGPT-3.0": "gpt-image-1.5",
    "ADSGPT-1.0": "imagen",
  };

  return mapping[model] || "gemini-3.1-flash-image-preview";
};

const mapModelLabel = (model) => {
  const mapping = {
    "ADSGPT-2.0": "Nano Banana Pro",
    "ADSGPT-3.0": "OpenAI 1.5",
    "ADSGPT-1.0": "Imagen",
  };

  return mapping[model] || model || "Unknown Model";
};

// Transform adCreative conversation to image generation records
const transformAdCreativeToImageGen = (adCreativeDoc) => {
  const records = [];

  try {
    // Extract only bot conversations with ads
    const botConversations = adCreativeDoc.conversations.filter(
      (conv) =>
        conv.type === "bot" && Array.isArray(conv.ads) && conv.ads.length > 0
    );

    if (botConversations.length === 0) {
      logger.warn(`No bot ads found for adCreative ${adCreativeDoc._id}`);
      return records;
    }

    // Track all previously generated images for reference
    const allPreviousImages = [];

    // Process each bot conversation
    botConversations.forEach((botConv, convIndex) => {
      const inputs = botConv.inputs || {};

      // Process each ad in the conversation
      botConv.ads.forEach((ad, adIndex) => {
        // Older convos (e.g. ADSGPT-1.0 multi-image) store image_ad as an
        // array; newer ones as a string. Normalize to a string so the
        // /creatives guard doesn't throw on arrays and abort the whole doc.
        const imageAd = Array.isArray(ad.image_ad)
          ? ad.image_ad[0]
          : ad.image_ad;
        if (typeof imageAd !== "string" || !imageAd.startsWith("/creatives")) {
          logger.warn(
            `Skipping invalid image for adCreative ${
              adCreativeDoc._id
            } - conversation ${convIndex} ad ${adIndex}: ${JSON.stringify(
              ad.image_ad
            )}`
          );
          return;
        }
        const aspectRatio = convertAspectRatio(
          ad.aspect_ratio || inputs.aspect_ratio
        );

        const record = {
          userId: adCreativeDoc.userId,
          status: "completed",
          error: null,

          // Inputs
          inputs: {
            type: "ai_ads", // adCreative maps to ai_ads
            model: mapModel(inputs.model),
            modelLabel: mapModelLabel(inputs.model),
            numberOfImages: inputs.num_images || 1,
            aspectRatio: aspectRatio,
            aspectRatioPerImage: [
              {
                aspectRatio: aspectRatio,
                numberOfImages: inputs.num_images || 1,
              },
            ],

            // Prompt/instructions
            userPrompt: inputs.prompt || botConv.start_message || "",

            // Brand info
            brandName: inputs.brand_name || "",
            brandDescription: inputs.brand_description || "",
            brandLogo: inputs.brand_logo || ad.logo || "",
            brandImages: inputs.brandImages || [],
            brandColors: inputs.color_palette || [],

            // Reference images - include all previously generated images from this session
            referenceImages: [
              ...(inputs.ReferenceImages || []),
              ...allPreviousImages, // Include all previous variations
            ],
            competitorAd: inputs.competitorReferenceImage || "",

            // Other fields
            prompt: inputs.prompt || "",
            targetPlatforms: inputs.targetPlatforms || [],
          },

          // Results
          results: [
            {
              generatedImageUrl: imageAd || ad?.base_image || "",
              aspectRatio: aspectRatio,
              prompt: inputs.prompt || "",
              promptTokens: 0,
              completionTokens: 0,
              imageBytes: 0,
              error: null,
              status: "completed",
            },
          ],

          // Metadata
          creativeType: "ai_ads",
          model: mapModel(inputs.model),
          taskId: `migrated_${adCreativeDoc._id}_${convIndex}_${adIndex}`,

          // Timing
          timing: {
            generationMs: 0,
            s3UploadMs: 0,
            totalMs: 0,
          },
          queuedAt: adCreativeDoc.createdAt || new Date(),
          completedAt: adCreativeDoc.updatedAt || new Date(),

          // Migration marker
          isMigrated: true,

          // Timestamps
          createdAt: adCreativeDoc.createdAt || new Date(),
          updatedAt: adCreativeDoc.updatedAt || new Date(),
        };

        records.push(record);

        // Add this generated image to the reference pool for next variations
        if (imageAd || ad.base_image) {
          allPreviousImages.push(imageAd || ad.base_image);
        }
      });
    });
  } catch (error) {
    logger.error(`Error transforming adCreative ${adCreativeDoc._id}:`, error);
  }

  return records;
};

// Main migration function
const migrateAdCreativeData = async () => {
  console.log("[Migration] Starting...");

  // Validate environment BEFORE connecting
  validateEnvironment();
  console.log("[Migration] Environment validated");

  await connectDB();
  console.log("[Migration] Database connected");

  try {
    logger.info("\n" + "=".repeat(50));
    logger.info("🚀 Starting adCreative to ImageGeneration migration...");
    logger.info("=".repeat(50) + "\n");

    // Get collection directly from MongoDB for adCreative records
    const db = mongoose.connection.db;
    const adCreativeCollection = db.collection("histories"); // adCreative data stored in histories collection

    // Find all adCreative records (not already migrated)
    console.log("[Migration] Querying database for unmigrated records...");
    const adCreativeRecords = await adCreativeCollection
      .find({
        type: "adCreative",
        // userId: "GPT-1835",
      })
      .toArray();

    console.log(
      `[Migration] Found ${adCreativeRecords.length} adCreative records to migrate`
    );
    logger.info(
      `Found ${adCreativeRecords.length} adCreative records to migrate`
    );

    if (adCreativeRecords.length === 0) {
      logger.info("No records to migrate");
      await mongoose.connection.close();
      return;
    }

    let successCount = 0;
    let errorCount = 0;
    let totalRecordsCreated = 0;

    // Process each adCreative record
    for (const adCreativeDoc of adCreativeRecords) {
      try {
        console.log(
          `[Migration] Processing adCreative ${adCreativeDoc._id}...`
        );
        const transformedRecords = transformAdCreativeToImageGen(adCreativeDoc);

        if (transformedRecords.length === 0) {
          logger.warn(
            `No valid records to create from adCreative ${adCreativeDoc._id}`
          );
          continue;
        }

        // Insert transformed records into ImageGeneration
        const insertResult = await ImageGeneration.insertMany(
          transformedRecords,
          {
            ordered: false,
          }
        );

        successCount++;
        totalRecordsCreated += insertResult.length;

        logger.info(
          `✓ Migrated adCreative ${adCreativeDoc._id} -> Created ${insertResult.length} image generation records`
        );

        // Mark original as migrated
        await adCreativeCollection.updateOne(
          { _id: adCreativeDoc._id },
          { $set: { isMigrated: true } }
        );
      } catch (error) {
        errorCount++;
        logger.error(
          `✗ Error migrating adCreative ${adCreativeDoc._id}:`,
          error.message
        );
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log("📊 MIGRATION SUMMARY");
    console.log("=".repeat(50));
    console.log(
      `Total adCreative records processed: ${adCreativeRecords.length}`
    );
    console.log(`✓ Successfully migrated: ${successCount}`);
    console.log(`✗ Failed: ${errorCount}`);
    console.log(
      `📦 Total ImageGeneration records created: ${totalRecordsCreated}`
    );
    console.log("=".repeat(50) + "\n");

    logger.info("\n" + "=".repeat(50));
    logger.info("📊 MIGRATION SUMMARY");
    logger.info("=".repeat(50));
    logger.info(
      `Total adCreative records processed: ${adCreativeRecords.length}`
    );
    logger.info(`✓ Successfully migrated: ${successCount}`);
    logger.info(`✗ Failed: ${errorCount}`);
    logger.info(
      `📦 Total ImageGeneration records created: ${totalRecordsCreated}`
    );
    logger.info("=".repeat(50) + "\n");

    await mongoose.connection.close();
    console.log("✓ Migration complete and database connection closed.");
    logger.info("✓ Migration complete and database connection closed.\n");
  } catch (error) {
    logger.error("❌ Migration error:", error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

// Run migration
migrateAdCreativeData();
