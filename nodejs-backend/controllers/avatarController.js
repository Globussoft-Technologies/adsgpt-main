const Avatar = require("../Module/videoGeneration/avatarModel");
const {
  avatarSchema,
  bulkAvatarSchema,
} = require("../Validations/avatarValidator");

/**
 * @desc Add single or bulk avatars
 * @route POST /video/avatars
 */
exports.addAvatars = async (req, res) => {
  try {
    /* #swagger.tags = ['Avatar Management']
       #swagger.summary = 'Add single or bulk avatars'
       #swagger.description = 'Accepts a single avatar object or an array of avatars.'
       #swagger.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: {
                        oneOf: [
                            { $ref: "#/components/schemas/Avatar" },
                            { 
                                type: 'array',
                                items: { $ref: "#/components/schemas/Avatar" }
                            }
                        ]
                    }
                }
            }
        } 
    */
    const data = req?.body?.avatars;

    // Validation
    const { error } = Array.isArray(data)
      ? bulkAvatarSchema.validate(data)
      : avatarSchema.validate(data);

    if (error) {
      return res
        .status(400)
        .json({ success: false, error: error.details[0].message });
    }

    if (Array.isArray(data)) {
      const avatars = await Avatar.insertMany(data);
      return res.status(201).json({
        success: true,
        message: `${avatars.length} avatars added successfully`,
        data: avatars,
      });
    } else {
      const avatar = new Avatar(data);
      await avatar.save();
      return res.status(201).json({
        success: true,
        message: "Avatar added successfully",
        data: avatar,
      });
    }
  } catch (err) {
    console.error("Error in addAvatars:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * @desc Get all avatars with filters
 * @route GET /video/avatars
 */
exports.getAllAvatars = async (req, res) => {
  try {
    /* #swagger.tags = ['Avatar Management']
       #swagger.summary = 'Get all avatars with optional filters'
       #swagger.parameters['age'] = { in: 'query', type: 'string' }
       #swagger.parameters['gender'] = { in: 'query', type: 'string' }
       #swagger.parameters['race'] = { in: 'query', type: 'string' }
       #swagger.parameters['industry'] = { in: 'query', type: 'string' }
       #swagger.parameters['outfit'] = { in: 'query', type: 'string' }
       #swagger.parameters['background'] = { in: 'query', type: 'string' }
       #swagger.parameters['lighting'] = { in: 'query', type: 'string' }
       #swagger.parameters['camera_distance'] = { in: 'query', type: 'string' }
       #swagger.parameters['expression'] = { in: 'query', type: 'string' }
       #swagger.parameters['aspect_ratio'] = { in: 'query', type: 'string' }
       #swagger.parameters['image_size'] = { in: 'query', type: 'string' }
    */
    const filters = {};
    const allowedFilters = [
      "age",
      "gender",
      "race",
      "industry",
      "outfit",
      "background",
      "lighting",
      "camera_distance",
      "expression",
      "aspect_ratio",
      "image_size",
    ];

    allowedFilters.forEach((key) => {
      const raw = req.query[key];
      if (raw === undefined || raw === "") return;

      // Support multi-select: ?gender=Male&gender=Female -> { $in: [...] }
      if (Array.isArray(raw)) {
        const vals = raw.filter((v) => v !== undefined && v !== "");
        if (vals.length === 1) filters[key] = vals[0];
        else if (vals.length > 1) filters[key] = { $in: vals };
      } else {
        filters[key] = raw;
      }
    });

    // Opt-in pagination: when `limit` is supplied, return a single page plus
    // total/hasMore meta (used by the infinite-scroll library). Without it the
    // full sorted list is returned, exactly as before.
    const limit = parseInt(req.query.limit, 10);
    if (Number.isFinite(limit) && limit > 0) {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const skip = (page - 1) * limit;

      const [avatars, total] = await Promise.all([
        Avatar.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit),
        Avatar.countDocuments(filters),
      ]);

      return res.json({
        success: true,
        count: avatars.length,
        total,
        page,
        limit,
        hasMore: skip + avatars.length < total,
        data: avatars,
      });
    }

    const avatars = await Avatar.find(filters).sort({ createdAt: -1 });

    res.json({
      success: true,
      count: avatars.length,
      data: avatars,
    });
  } catch (err) {
    console.error("Error in getAllAvatars:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * @desc Get all distinct avatar categories (industries)
 * @route GET /video/avatars/industries
 */
exports.getAvatarIndustries = async (req, res) => {
  try {
    /* #swagger.tags = ['Avatar Management']
       #swagger.summary = 'Get all distinct avatar categories (industries)'
       #swagger.description = 'Returns the list of distinct industry values present on saved avatars.'
    */
    const industries = await Avatar.distinct("industry");
    const categories = industries
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    res.json({
      success: true,
      count: categories.length,
      data: categories,
    });
  } catch (err) {
    console.error("Error in getAvatarIndustries:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * @desc Get distinct values for every filterable avatar field
 * @route GET /video/avatars/filters
 */
exports.getAvatarFilters = async (req, res) => {
  try {
    /* #swagger.tags = ['Avatar Management']
       #swagger.summary = 'Get distinct values for every filterable avatar field'
       #swagger.description = 'Returns { age:[...], gender:[...], ... } built from distinct DB values. aspect_ratio is intentionally excluded.'
    */
    const fields = [
      "age",
      "gender",
      "race",
      "industry",
      "outfit",
      "background",
      "lighting",
      "camera_distance",
      "expression",
      "image_size",
    ];

    const entries = await Promise.all(
      fields.map(async (field) => {
        const values = await Avatar.distinct(field);
        return [
          field,
          values.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))),
        ];
      })
    );

    res.json({
      success: true,
      data: Object.fromEntries(entries),
    });
  } catch (err) {
    console.error("Error in getAvatarFilters:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * @desc Get avatar by ID
 * @route GET /video/avatars/:id
 */
exports.getAvatarById = async (req, res) => {
  try {
    /* #swagger.tags = ['Avatar Management']
       #swagger.summary = 'Get avatar by ID'
       #swagger.parameters['id'] = { in: 'path', required: true, type: 'string' }
    */
    const { id } = req.params;
    const avatar = await Avatar.findById(id);

    if (!avatar) {
      return res
        .status(404)
        .json({ success: false, error: "Avatar not found" });
    }

    res.json({
      success: true,
      data: avatar,
    });
  } catch (err) {
    console.error("Error in getAvatarById:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * @desc Edit avatar by ID
 * @route PUT /video/avatars/:id
 */
exports.editAvatarById = async (req, res) => {
  try {
    /* #swagger.tags = ['Avatar Management']
       #swagger.summary = 'Edit avatar by ID'
       #swagger.parameters['id'] = { in: 'path', required: true, type: 'string' }
       #swagger.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/Avatar" }
                }
            }
        }
    */
    const { id } = req.params;

    // Validation
    const { error } = avatarSchema.validate(req.body, { allowUnknown: true });
    if (error) {
      return res
        .status(400)
        .json({ success: false, error: error.details[0].message });
    }

    const avatar = await Avatar.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!avatar) {
      return res
        .status(404)
        .json({ success: false, error: "Avatar not found" });
    }

    res.json({
      success: true,
      message: "Avatar updated successfully",
      data: avatar,
    });
  } catch (err) {
    console.error("Error in editAvatarById:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * @desc Delete avatar by ID
 * @route DELETE /video/avatars/:id
 */
exports.deleteAvatarById = async (req, res) => {
  try {
    /* #swagger.tags = ['Avatar Management']
       #swagger.summary = 'Delete avatar by ID'
       #swagger.parameters['id'] = { in: 'path', required: true, type: 'string' }
    */
    const { id } = req.params;
    const avatar = await Avatar.findByIdAndDelete(id);

    if (!avatar) {
      return res
        .status(404)
        .json({ success: false, error: "Avatar not found" });
    }

    res.json({
      success: true,
      message: "Avatar deleted successfully",
    });
  } catch (err) {
    console.error("Error in deleteAvatarById:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};
