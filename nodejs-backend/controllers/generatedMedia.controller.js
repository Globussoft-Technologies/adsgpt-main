const GeneratedMedia = require('../Module/generatedMedia/generated.media');
const {
  buildCreditLookupBranches,
  buildEffectiveCostStages,
} = require('../config/modelAggregation');

class GeneratedMediaController {

  /**
   * Backwards-compatible export — callers historically imported this method
   * directly. Delegates to the shared registry-derived helper so adding a
   * model never means editing this file.
   */
  static buildCreditLookupBranches() {
    return buildCreditLookupBranches();
  }

  /**
   * Internal method to save generated media
   */
  static async saveGeneratedMedia(data) {
    try {
      const { userId, model, type, image, video, credit_deduction, cost, duration } = data;

      if (!userId || !model) {
        return { success: false, message: "userId and model are required" };
      }

      const newMedia = new GeneratedMedia({
        userId,
        // user_name,
        model,
        type,
        image: image || "",
        video: video || "",
        credit_deduction: credit_deduction || 0,
        cost: cost || 0,
        duration: duration || 0
      });

      await newMedia.save();
      return { success: true, data: newMedia };

    } catch (error) {
      console.error("Internal Save Generated Media Error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all generated media for a specific user
   */
  static async getMediaByUser(req, res) {
  try {
    const { userId } = req.params;
      const { type, model, page = 1, limit = 20,from, to } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required"
      });
    }

    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const skip = (pageNumber - 1) * limitNumber;

    let filter = { userId };

    if (type) filter.type = type;
    if (model) filter.model = model;
       //date range
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    // Run media fetch + spending aggregation in parallel
    const [media, total, spendingAgg] = await Promise.all([
      GeneratedMedia.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNumber),
      GeneratedMedia.countDocuments(filter),

      // Spending aggregation — always on full userId scope (no type/model filter)
      // so the summary reflects ALL media regardless of current type filter
      GeneratedMedia.aggregate([
        {
          $match: {
            userId,
            ...(from || to ? {
              createdAt: {
                ...(from ? { $gte: new Date(from) } : {}),
                ...(to ? { $lte: new Date(to) } : {})
              }
            } : {})
          }
        },
        ...buildEffectiveCostStages(),
        {
          $group: {
            _id: "$model",
            credits: { $sum: "$effective_credits" },
            cost: { $sum: "$effective_cost" },
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            model: "$_id",
            cost: { $round: ["$cost", 2] },
            count: 1
          }
        }
      ])
    ]);

    // Build the spending summary from aggregation result
    // const userTotalCredits = spendingAgg.reduce((sum, m) => sum + m.credits, 0);
    const userTotalCost = parseFloat(spendingAgg.reduce((sum, m) => sum + m.cost, 0).toFixed(2));
    const userTotalCount = spendingAgg.reduce((sum, m) => sum + m.count, 0);

    return res.status(200).json({
      success: true,
      page: pageNumber,
      limit: limitNumber,
      total,
      hasMore: skip + media.length < total,
      spending: {
        userId,
        models: spendingAgg,       // [{ model, cost, count }]
        userTotalCost,
        userTotalCount
      },
      data: media
    });

  } catch (error) {
    console.error("Get Generated Media Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
}

  /**
   * GET /generated-media/library/:userId — slim picker endpoint.
   *
   * Returns only rows that have a usable asset URL, with pagination math
   * computed against THAT filtered set (so "Page X of Y · N total" never
   * lies to the user). One aggregation pipeline does it all:
   *
   *   1. $match — userId + type + asset URL must be non-empty.
   *      For images we accept ANY of: image.base_image_with_logo,
   *      image.base_image, OR a legacy plain-string `image`.
   *      For videos we accept video as a non-empty string OR video.url.
   *   2. $sort — newest first.
   *   3. $facet — paginated `data` slice + `meta` total count, single
   *      round-trip.
   *   4. $project (inside `data`) — picks the right URL per row using
   *      $cond/$ifNull so the response carries a resolved `url` field
   *      and the frontend renders <img src> directly.
   *
   * Returns: { _id, type, model, url, createdAt } per row. No cost,
   * credit, or spending aggregation — those live in /getMediaByUser.
   */
  static async getMediaLibrary(req, res) {
    try {
      const { userId } = req.params;
      const { type, page = 1, limit = 24 } = req.query;

      if (!userId) {
        return res
          .status(400)
          .json({ success: false, message: "userId is required" });
      }

      const pageNumber = Math.max(1, parseInt(page, 10) || 1);
      const limitNumber = Math.max(1, Math.min(100, parseInt(limit, 10) || 24));
      const skip = (pageNumber - 1) * limitNumber;

      const targetType = type === "video" ? "video" : "image";

      // Asset-URL match — at least one of the known shapes must hold a
      // non-empty string. `$type: 'string', $ne: ''` rejects nulls,
      // missing fields, empty strings, and objects in one go.
      const urlMatch =
        targetType === "video"
          ? {
              $or: [
                { video: { $type: "string", $ne: "" } },
                { "video.url": { $type: "string", $ne: "" } },
              ],
            }
          : {
              $or: [
                { image: { $type: "string", $ne: "" } },
                { "image.base_image_with_logo": { $type: "string", $ne: "" } },
                { "image.base_image": { $type: "string", $ne: "" } },
              ],
            };

      // URL projection expression — chooses the right field per row.
      // Mirrors the match above so anything that passed the filter
      // resolves to a non-empty string here.
      const urlProject =
        targetType === "video"
          ? {
              $cond: [
                { $eq: [{ $type: "$video" }, "string"] },
                "$video",
                { $ifNull: ["$video.url", null] },
              ],
            }
          : {
              $cond: [
                { $eq: [{ $type: "$image" }, "string"] },
                "$image",
                {
                  $ifNull: [
                    "$image.base_image_with_logo",
                    { $ifNull: ["$image.base_image", null] },
                  ],
                },
              ],
            };

      const pipeline = [
        { $match: { userId, type: targetType, ...urlMatch } },
        { $sort: { createdAt: -1 } },
        {
          $facet: {
            data: [
              { $skip: skip },
              { $limit: limitNumber },
              {
                $project: {
                  _id: 1,
                  type: 1,
                  model: 1,
                  createdAt: 1,
                  url: urlProject,
                },
              },
            ],
            meta: [{ $count: "total" }],
          },
        },
      ];

      const [result] = await GeneratedMedia.aggregate(pipeline);
      const data = result?.data || [];
      const total = result?.meta?.[0]?.total || 0;

      return res.status(200).json({
        success: true,
        page: pageNumber,
        limit: limitNumber,
        total,
        hasMore: skip + data.length < total,
        data,
      });
    } catch (error) {
      console.error("Get Media Library Error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  }

  /**
   * Get users who generated media
   */
 static async getUsersWithGeneratedMedia(req, res) {
  try {

    const users = await GeneratedMedia.aggregate([
      {
        $group: {
          _id: "$userId",
          generatedCount: { $sum: 1 }
        }
      },
      {
        $project: {
          user_id: "$_id",
          generatedCount: 1,
          _id: 0
        }
      }
    ]);

    return res.status(200).json({
      success: true,
      totalUsers: users.length,
      data: users
    });

  } catch (error) {
    console.error("Get Users With Generated Media Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
}

  /**
   * Get spending report for admin panel
   * Filters: userId, model, from, to
   */
  static async getSpendingReport(req, res) {
    try {
      const { userId, model, from, to } = req.query;

      let match = {};

      if (userId) match.userId = userId;
      if (model) match.model = model;
 
      if (from || to) {
        match.createdAt = {};
        if (from) match.createdAt.$gte = new Date(from);
        if (to) match.createdAt.$lte = new Date(to);
      }

      const report = await GeneratedMedia.aggregate([
        { $match: match },
        ...buildEffectiveCostStages(),
        {
          $group: {
            _id: {
              user: "$userId",
              model: "$model"
            },
            totalCredits: { $sum: "$effective_credits" },
            totalCost: { $sum: "$effective_cost" },
            count: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: "$_id.user",
            models: {
              $push: {
                model: "$_id.model",
                credits: "$totalCredits",
                cost: "$totalCost",
                count: "$count"
              }
            },
            userTotalCredits: { $sum: "$totalCredits" },
            userTotalCost: { $sum: "$totalCost" },
            userTotalCount: { $sum: "$count" }
          }
        },
        {
          $project: {
            userId: "$_id",
            models: {
              $map: {
                input: "$models",
                as: "m",
                in: {
                  model: "$$m.model",
                  credits: "$$m.credits",
                  cost: { $round: ["$$m.cost", 2] },
                  count: "$$m.count"
                }
              }
            },
            userTotalCredits: 1,
            userTotalCost: { $round: ["$userTotalCost", 2] },
            userTotalCount: 1,
            _id: 0
          }
        },
        { $sort: { userTotalCost: -1 } }
      ]);

      return res.status(200).json({
        success: true,
        data: report
      });

    } catch (error) {
      console.error("Get Spending Report Error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message
      });
    }
  }

}

module.exports = GeneratedMediaController;