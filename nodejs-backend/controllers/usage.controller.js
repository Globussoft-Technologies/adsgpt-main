const Usage = require("../Module/usage/usage.model");
const GeneratedMedia = require("../Module/generatedMedia/generated.media");
const modelPricingConfig = require("../config/modelPricingConfig");
const GeneratedCount = require("../Module/generatedCount/generatedCountSchema");
const { imageEntries, videoEntries, findModel, getExtraDeduction } = require("../config/modelRegistry");
const { SURFACE_CATALOG, SURFACE_SLUGS } = require("../config/surfaceCatalog");

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
function creditsFor(entry) {
  const raw = parseFloat(process.env[entry.creditEnvVar]);
  return Number.isFinite(raw) ? raw : entry.creditDefault;
}

function unitLabelFor(type) {
  return type === "video" ? "CREDITS/SECOND" : "CREDITS/IMAGE";
}

// Flat catalog row (no-media / full-catalog response). Byte-compatible with the
// historical { label, value } shape — `credits` is internal, used only to sort.
function rowFor(entry) {
  const credits = creditsFor(entry);
  return { label: entry.label, credits, value: `${credits} ${unitLabelFor(entry.type)}` };
}

// Surface-aware row — adds canonical, numeric credits/sec and the surface's
// allowed durations + aspect ratios so the frontend can build its pickers.
function surfaceRowFor(entry, caps, media) {
  let credits = creditsFor(entry);
  if (media && Array.isArray(entry.extraDeduction)) {
    credits += getExtraDeduction(entry.canonicalKey, media);
  }
  
  const creditField = entry.type === "video" ? "creditsPerSecond" : "creditsPerImage";
  const row = {
    canonical: entry.canonicalKey,
    label: entry.label,
    type: entry.type,
    value: `${credits} ${unitLabelFor(entry.type)}`,
    [creditField]: credits,
    credits, // internal sort key, stripped before sending
    durations: caps.durations || [],
    aspectRatios: caps.aspectRatios || [],
  };
  
  return row;
}

const sortByCredits = (a, b) => a.credits - b.credits;

/**
 * GET /usage/model-credit-value?type=&media=
 *
 *  type   "all" (default) | "image" | "video" — which model groups to populate.
 *  media  optional surface slug (ai_ads | ugc | broll | avatar | clone).
 *         When present, only that surface's models are returned, each enriched
 *         with durations[] + aspectRatios[]. When absent, the full catalog is
 *         returned exactly as before (back-compat).
 */
const getModelCreditDeduction = async (req, res) => {
  /* #swagger.auto = false
     #swagger.tags = ['Usage']
     #swagger.summary = 'Model credit values (catalog + per-surface)'
     #swagger.path = '/usage/model-credit-value'
     #swagger.method = 'get'
     #swagger.description = 'Returns the per-unit credit cost of each enabled generation model. <br/><br/>**No params** → full catalog, back-compatible shape: `{ imageModels:[{label,value}], videoModels:[{label,value}] }` (value is a string like "7 CREDITS/IMAGE" / "4 CREDITS/SECOND"), sorted cheapest-first. <br/><br/>**`media` set** → only the models offered on that AdStudio video surface, each row enriched with `canonical`, numeric `creditsPerSecond`, and the surface-specific `durations[]` + `aspectRatios[]` so the frontend can build its pickers. Per-unit credits read from env (creditEnvVar) with a registry fallback. <br/><br/>**`type`** narrows which group is populated. All current surfaces are video, so `type=image` together with a `media` slug yields an empty list.'
     #swagger.parameters['type'] = { in: 'query', required: false, type: 'string', enum: ['all','image','video'], description: 'Which model groups to populate. Defaults to all.' }
     #swagger.parameters['media'] = { in: 'query', required: false, type: 'string', enum: ['ai_ads','ugc','broll','avatar','clone'], description: 'Optional AdStudio video surface. When set, returns only the models for that surface, enriched with durations and aspectRatios.' }
     #swagger.responses[200] = {
       description: 'Model credit configuration. Example shows a per-surface response (media=ugc&type=video). The no-media response instead returns flat { label, value } rows under imageModels/videoModels.',
       content: { "application/json": { example: {
         success: true,
         message: "Model credit configuration fetched successfully",
         data: {
           media: "ugc",
           imageModels: [],
           videoModels: [
             { canonical: "seedance_fast", label: "Seedance 2.0 Fast", type: "video", value: "3 CREDITS/SECOND", creditsPerSecond: 3, durations: [8,12], aspectRatios: ["9:16","16:9"] },
             { canonical: "veo-3.1-fast", label: "Veo 3.1 fast", type: "video", value: "4 CREDITS/SECOND", creditsPerSecond: 4, durations: [8], aspectRatios: ["9:16","16:9"] },
             { canonical: "kling_3.0", label: "Kling 3.0", type: "video", value: "4 CREDITS/SECOND", creditsPerSecond: 4, durations: [8,12], aspectRatios: ["9:16","16:9","1:1"] }
           ]
         }
       } } }
     }
     #swagger.responses[400] = {
       description: 'Unknown media slug.',
       content: { "application/json": { example: { success: false, message: 'Unknown media surface "foo". Valid surfaces: ai_ads, ugc, broll, avatar, clone' } } }
     }
     #swagger.responses[401] = { description: 'Missing token' }
     #swagger.responses[403] = { description: 'Invalid or expired token' }
     #swagger.responses[500] = {
       description: 'Server error',
       content: { "application/json": { example: { success: false, message: "Internal server error" } } }
     }
  */
  try {
    const { type = "all", media } = req.query;
    const wantImage = type === "all" || type === "image";
    const wantVideo = type === "all" || type === "video";

    // ─── Surface-filtered catalog ──────────────────────────────────────────
    if (media) {
      const surface = SURFACE_CATALOG[media];
      if (!surface) {
        return res.status(400).json({
          success: false,
          message: `Unknown media surface "${media}". Valid surfaces: ${SURFACE_SLUGS.join(", ")}`,
        });
      }

      const imageModels = [];
      const videoModels = [];

      for (const [canonical, caps] of Object.entries(surface)) {
        const entry = findModel(canonical);
        // Skip unknown or disabled models — keeps the surface in lockstep with
        // the registry's enabled flag (no dead pickers).
        if (!entry || entry.enabled === false) continue;
        const isVideo = entry.type === "video";
        if (isVideo ? !wantVideo : !wantImage) continue;
        (isVideo ? videoModels : imageModels).push(surfaceRowFor(entry, caps, media));
      }

      imageModels.sort(sortByCredits);
      videoModels.sort(sortByCredits);

      return res.status(200).json({
        success: true,
        message: "Model credit configuration fetched successfully",
        data: {
          media,
          imageModels: imageModels.map(({ credits, ...row }) => row),
          videoModels: videoModels.map(({ credits, ...row }) => row),
        },
      });
    }

    // ─── Full catalog (no media) — back-compatible { label, value } shape ──
    const imageModels = wantImage
      ? imageEntries({ activeOnly: true })
          .map(rowFor)
          .sort(sortByCredits)
          .map(({ label, value }) => ({ label, value }))
      : [];

    const videoModels = wantVideo
      ? videoEntries({ activeOnly: true })
          .map(rowFor)
          .sort(sortByCredits)
          .map(({ label, value }) => ({ label, value }))
      : [];

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
