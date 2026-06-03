const crypto = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
  buildAdCopyPrompt,
  responseSchema,
} = require("../../AI/metaAdCopyPrompt");
const { generateAdCopySchema } = require("../../Validations/meta.validator");
const UnifiedCreditController = require("../UnifiedCreditController");
const logger = require("../../utils/logger");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

exports.generateAdCopy = async (req, res) => {
  const userId = req.user.user_id;

  const { error, value } = generateAdCopySchema.validate(req.body || {});

  if (error) {
    return res.status(400).json({
      status: false,
      error: error.details[0].message,
    });
  }

  const cost = UnifiedCreditController.getModelDeduction("ADSGPT-TEXT");
  console.log("Cost of this ", cost);

  const reservationKey = `adcopy-${crypto.randomUUID()}`;

  const freeze = await UnifiedCreditController.freezeCredits({
    userId,
    reservationKey,
    amount: cost,
    meta: {
      service_type: "ad_copy_meta",
    },
  });

  if (!freeze.ok) {
    if (freeze.reason === "INSUFFICIENT")
      return res.status(402).json({
        status: false,
        error: "Insufficient credits.",
        required: freeze.required,
        remaining: freeze.remaining,
      });
    return res
      .status(409)
      .json({
        status: false,
        error: "Could not reserve credits, please retry.",
      });
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.8,
      },
    });

    const result = await model.generateContent(
      buildAdCopyPrompt({
        prompt: value.prompt,
      }),
    );

    const raw = result?.response?.text?.() || "";

    let adCopy;
    try {
      adCopy = JSON.parse(raw);
    } catch (e) {
      await UnifiedCreditController.releaseCredits(reservationKey);
      logger.error(`[ad-copy-gen] invalid JSON from Gemini: ${e.message}`);
      return res
        .status(502)
        .json({
          status: false,
          error: "AI returned invalid output, please retry.",
        });
    }

    await UnifiedCreditController.settleCredits(reservationKey);
    return res.status(200).json({
      status: true,
      adCopy,
      creditsCharged: cost,
    });
  } catch (err) {
    await UnifiedCreditController.releaseCredits(reservationKey);
    logger.error(
      `[ad-copy-gen] generation failed: ${err.stack || err.message}`,
    );
    return res
      .status(500)
      .json({
        status: false,
        error: "Failed to generate ad copy",
        details: err.message,
      });
  }
};
