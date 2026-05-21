const Usage = require("../Module/usage/usage.model");
const GeneratedMedia = require("../Module/generatedMedia/generated.media");
const modelPricingConfig = require("../config/modelPricingConfig");
const GeneratedCount = require("../Module/generatedCount/generatedCountSchema");
const { imageEntries, videoEntries } = require("../config/modelRegistry");

const createUsage = async (req, res) => {
  try {
    const { userId, usage } = req.body;

    if (!userId || !usage) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const {
      serviceName,
      model,
      total_tokens,
      input_tokens,
      output_tokens,
      input_tokens_details = {},
      image_url = "",  // Single image URL — Python sends one request per image
    } = usage;

    if (!serviceName || !model) {
      return res.status(400).json({
        success: false,
        message: "serviceName and model are required",
      });
    }

    if (
      total_tokens === undefined ||
      input_tokens === undefined ||
      output_tokens === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid usage payload",
      });
    }

    // ─── Identify if this is an adFactory image service ───────────────────
    // NOTE: adCreativeImage is NOT included here — Python does NOT send tokens for adCreative.
    //       adCreative images are saved to GeneratedMedia from the socket handler instead.
    const isAdFactoryImageService =
      serviceName === "adFactoryImage" ||
      serviceName === "ad_factory";

    // ─── Calculate cost from tokens (only for adFactory image services) ────
    // Formula: (input_tokens × input_price/M) + (output_tokens × output_price/M)
    const totalCost = isAdFactoryImageService
      ? modelPricingConfig.getImageCost(model, input_tokens, output_tokens)
      : 0;

    // ─── STEP 1: Save raw token data to Usage (audit log) ─────────────────
    await Usage.findOneAndUpdate(
      { userId },
      {
        $push: {
          usages: {
            serviceName,
            model,
            total_tokens,
            input_tokens,
            output_tokens,
            input_tokens_details: {
              text_tokens: input_tokens_details.text_tokens || 0,
              image_tokens: input_tokens_details.image_tokens || 0,
            },
            image_url,  // single URL per hit
          },
        },
      },
      { upsert: true }
    );

    // ─── STEP 2: Smart Update cost for existing AdFactory record ─────────
    // Since images are saved in adFactory.js (callback) first with $0 cost,
    // we now update that existing record with the real token-based cost.
    if (isAdFactoryImageService) {
      // NOTE: We don't save to GeneratedMedia count here anymore to avoid double counting
      // in the statistics. However, we still need to store the COST for spending reports.
      // We will update the existing GeneratedMedia record (saved in adFactory.js or adStudio.js).
      await GeneratedMedia.findOneAndUpdate(
        { userId, image: image_url, source: "adFactory" },
        { $set: { cost: totalCost } }
      );
    }

    return res.status(201).json({
      success: true,
      message: "Usage created successfully",
    });
  } catch (error) {
    console.error("Create Usage Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};



const getUserGenerationStats = async (req, res) => {
  try {
    const { userId } = req.params;
    const { from, to } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    // Date range logic   const doc = await Usage.findOne({ userId });

    // if (!doc || !doc.usages || doc.usages.length === 0) {
    //   return res.status(200).json({
    //     success: true,
    //     userId,
    //     total_images: 0,
    //     data: [],
    //   });
    // }

    const fromDate = from
      ? new Date(`${from}T00:00:00.000Z`)
      : new Date("1970-01-01T00:00:00.000Z");

    const toDate = to
      ? new Date(`${to}T23:59:59.999Z`)
      : new Date();

    const mediaMatchQuery = {
      userId,
      createdAt: { $gte: fromDate, $lte: toDate },
    };

    // 1. Fetch Image Counts from the NEW GeneratedCount module
    const imageStats = await GeneratedCount.aggregate([
      { $match: { userId, createdAt: { $gte: fromDate, $lte: toDate } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          image_count: { $sum: 1 },
        },
      },
    ]);

    // 2. Fetch Video Counts from the standard GeneratedMedia module (as requested)
    const videoStats = await GeneratedMedia.aggregate([
      { $match: { ...mediaMatchQuery, type: "video" } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          video_count: { $sum: 1 },
        },
      },
    ]);

    // 3. Overall Totals
    const [total_images, total_videos] = await Promise.all([
      GeneratedCount.countDocuments({ userId, createdAt: { $gte: fromDate, $lte: toDate } }),
      GeneratedMedia.countDocuments({ ...mediaMatchQuery, type: "video" }),
    ]);

    // 4. Merge results by date
    const mergedData = {};
    imageStats.forEach((item) => {
      mergedData[item._id] = { 
        date: item._id, 
        image_count: item.image_count, 
        video_count: 0 
      };
    });
    videoStats.forEach((item) => {
      if (!mergedData[item._id]) {
        mergedData[item._id] = { 
          date: item._id, 
          image_count: 0, 
          video_count: item.video_count 
        };
      } else {
        mergedData[item._id].video_count = item.video_count;
      }
    });

    const data = Object.values(mergedData).sort((a, b) => a.date.localeCompare(b.date));

    return res.status(200).json({
      success: true,
      userId,
      total_images,
      total_videos,
      data,
    });
  } catch (error) {
    console.error("getUserGenerationStats error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// `creditDefault` here matches the historical `|| 0` fallback in the old
// hardcoded array — image entries default to 0 credits if env unset, video
// entries fall back to whatever the registry says (matches the old
// `parseFloat(... || N)` defaults that were already aligned with the registry).
function rowFor(entry, unitLabel) {
  const raw = parseFloat(process.env[entry.creditEnvVar]);
  const credits = Number.isFinite(raw) ? raw : entry.creditDefault;
  return { label: entry.label, credits, value: `${credits} ${unitLabel}` };
}

const getModelCreditDeduction = async (_req, res) => {
  try {
    const imageModels = imageEntries({ activeOnly: true })
      .map((e) => rowFor(e, "CREDITS/IMAGE"))
      .sort((a, b) => a.credits - b.credits)
      .map(({ label, value }) => ({ label, value }));

    const videoModels = videoEntries({ activeOnly: true })
      .map((e) => rowFor(e, "CREDITS/SECOND"))
      .sort((a, b) => a.credits - b.credits)
      .map(({ label, value }) => ({ label, value }));

    return res.status(200).json({
      success: true,
      message: "Model credit configuration fetched successfully",
      data: { imageModels, videoModels },
    });
  } catch (error) {
    console.error("getModelCreditDeduction Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};






module.exports = { createUsage, getUserGenerationStats, getModelCreditDeduction };
