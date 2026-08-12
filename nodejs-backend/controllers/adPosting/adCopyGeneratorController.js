const crypto = require("crypto");
const { generateJson, MODELS } = require("../../services/ai/geminiClient");
const {
  buildAdCopyPrompt,
  responseSchema,
} = require("../../AI/metaAdCopyPrompt");
const { generateAdCopySchema } = require("../../Validations/meta.validator");
const UnifiedCreditController = require("../UnifiedCreditController");
const logger = require("../../utils/logger");

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
    let adCopy;
    try {
      ({ json: adCopy } = await generateJson({
        model: MODELS.FAST,
        prompt: buildAdCopyPrompt({
          prompt: value.prompt,
        }),
        responseSchema,
        temperature: 0.8,
      }));
    } catch (e) {
      // Anything that isn't a bad-output error is a genuine call failure —
      // rethrow so the outer catch releases credits and returns 500.
      if (e.code !== "GEMINI_INVALID_JSON") throw e;
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
