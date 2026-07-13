const mongoose = require("mongoose");

const StatusSchema = {
  type: String,
  enum: ["draft", "in-progress", "success", "error", "edit-in-progress"],
  default: "draft",
};

const BrandInfoSchema = new mongoose.Schema(
  {
    brandName: { type: String, default: "" },
    brandDescription: { type: String, default: "" },
    brandLogo: { type: [String], default: [] },
    brandVoice: { type: [String], default: [] },
    category: { type: String, default: "" },
    brandGuidelines: {
      toneOfVoice: { type: String, default: "" },
      dos: { type: [String], default: [] },
      donts: { type: [String], default: [] },
      colorPalette: { type: [String], default: [] },
    },
    type: { type: String, default: "brandInfo" },
    status: StatusSchema,
  },
  { _id: false }
);

const ObjectiveSchema = new mongoose.Schema(
  {
    primaryObjective: { type: String, default: "" },
    promotionalInfo: { type: [String], default: [] },
    coreIdea: { type: String, default: "" },
    callToAction: { type: [String], default: [] },
    additionalGuidelines: { type: String, default: "" },
    targetAudience: { type: [String], default: [] },
    type: { type: String, default: "objectives" },
    status: StatusSchema,
  },
  { _id: false }
);

const AssetSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["image", "video", "svg", "gif"],
    },
    urls: { type: [String], default: [] },
  },
  { _id: false }
);

const ResultEntrySchema = new mongoose.Schema(
  {
    status: { type: Number, default: "" },
    data: { type: String, default: "" },
    error: { type: String, default: null },
    timestamp: { type: Date, default: Date.now },
    prompt: { type: String, default: "" },
    jobId: { type: String, default: null },
  },
  { _id: false }
);
const textResultEntrySchema = new mongoose.Schema(
  {
    status: { type: Number, default: "" },
    data: { type: mongoose.Schema.Types.Mixed, default:""},
    error: { type: String, default: null },
    timestamp: { type: Date, default: Date.now },
    jobId: { type: String, default: null },
  },
  { _id: false }
);
const PlatformSchema = new mongoose.Schema(
  {
    platformName: {
      type: String,
      enum: [
        "meta",
        "google",
        "tiktok",
        "snapchat",
        "linkedin",
        "twitter",
        "pinterest",
        "reddit",
        "whatsapp",
        "youtube"
      ],
    },
    creativeRatios: {
      type: [String],
      default: [],
    },
  },
  { _id: false }
);

const ServiceSchema = new mongoose.Schema(
  {
    serviceName: {
      type: String,
      enum: ["text", "image", "video"],
      required: true,
    },
    serviceParams: {
      quantity: { type: Number, default: 0 },
      model: { type: String, default: "auto" }
    },
    generated: { type: Number, default: 0 },
  },
  { _id: false }
);

const CreativeSchema = new mongoose.Schema(
  {
    creativeId: {
      type: String,
      required: true,
    },
    imageUrl: {
      type: String,
      required: true,
      trim: true
    },
    headline: {
      type: String,
      required: true,
      trim: true
    },
    message: {
      type: String,
      required: true,
      trim: true
    },
    linkUrl: {
      type: String,
      required: true,
      trim: true
    },
    callToAction: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      default: "",
      trim: true
    },
    platform: {
      type: String,
      default: "",
      trim: true
    },
  },
  { _id: false }
);

// Content the user adds manually in the preview — kept under a single
// `customCreatives` key ({ images, copies }), separate from AI-generated
// `results`, and written only when the user Saves.
//
// Images: device upload, external link, or picked from the app library.
const CustomImageSchema = new mongoose.Schema(
  {
    data: { type: String, default: "" }, // S3 key ("/creatives/…") or full URL
    source: {
      type: String,
      enum: ["upload", "link", "app"],
      default: "upload",
    },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Copies the user adds in the preview (AI-drafted and/or hand-written — both
// are freely editable, so we don't distinguish the origin).
const CustomCopySchema = new mongoose.Schema(
  {
    primaryText: { type: String, default: "" },
    headline: { type: String, default: "" },
    description: { type: String, default: "" },
    platform: { type: String, default: "meta" },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const AdFactoryLaunchSchema = new mongoose.Schema(
  {
    adAccountId: {
      type: String,
      default: ""
    },

    pageId: {
      type: String,
      default: ""
    },

    campaignId: {
      type: String,
      default: ""
    },

    adSetId: {
      type: String,
      default: ""
    },

    status: StatusSchema,

    launchedAt: {
      type: Date
    },

    type: {
      type: String,
      default: "adFactoryLaunch"
    }
  },
  { _id: false }
);

const GoogleAdFactoryLaunchSchema = new mongoose.Schema(
  {
    adAccountId: {
      type: String,
      default: ""
    },

    campaignId: {
      type: String,
      default: ""
    },

    adGroupId: {
      type: String,
      default: ""
    },

    status: StatusSchema,

    launchedAt: {
      type: Date
    },

    type: {
      type: String,
      default: "googleAdFactoryLaunch"
    }
  },
  { _id: false }
);


const CampaignSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },

    metadata: {
      campaignId: { type: String, unique: true },
      campaignName: { type: String, required: true },
      type: { type: String, default: "metadata" },
      jobId: { type: String, default: null },
    },
    brandInfo: { type: BrandInfoSchema, default: {} },

    objectives: { type: ObjectiveSchema, default: {} },

    assets: {
      keyVisuals: { type: AssetSchema, default: () => ({}) },
      type: { type: String, default: "assets" },
      status: StatusSchema,
    },

    distribution: {
      platforms: [PlatformSchema],
      type: { type: String, default: "distribution" },
      status: StatusSchema,
    },

    services: {
      servicesSelected: [ServiceSchema],
      type: { type: String, default: "services" },
      status: StatusSchema,
    },
    results: {
      text: { type: [textResultEntrySchema], default: [] },
      image: { type: [ResultEntrySchema], default: [] },
      video: { type: [ResultEntrySchema], default: [] },
      type: { type: String, default: "result" },
      status: StatusSchema,
    },
    creatives: {
      type: [CreativeSchema],
      default: [],
      status:StatusSchema,
    },

    // Manually-added preview content (images + copies), synced on Save.
    customCreatives: {
      images: { type: [CustomImageSchema], default: [] },
      copies: { type: [CustomCopySchema], default: [] },
    },


    fbMetaData: {
      type: AdFactoryLaunchSchema,
      default: {}
    },

    googleMetaData: {
      type: GoogleAdFactoryLaunchSchema,
      default: {}
    },

    status: StatusSchema,
    history: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "CampaignHistory"
      }
    ]
  },
  { timestamps: true }
);

CampaignSchema.pre("save", function (next) {
  if (!this.metadata.campaignId) {
    this.metadata.campaignId = this._id.toString();
  }
  next();
});

module.exports = mongoose.model("Campaign", CampaignSchema);