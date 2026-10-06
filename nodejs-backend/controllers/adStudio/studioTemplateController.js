const { getBrandTemplates, StudioTemplateError } = require('../../services/adStudio/studioTemplates');
const { startStudioImageRender, renderPrice, StudioRenderError } = require('../../services/adStudio/studioImageRender');
const logger = require('../../utils/logger');

// Shown to the user as-is; the raw reason stays in `error` for support.
const USER_MESSAGES = {
  BRAND_NOT_FOUND: 'This brand could not be found. Please pick another brand.',
  NO_CONTEXT: 'Add a description or product images to this brand in BrandIQ to see matched templates.',
  NO_DESCRIPTION: 'Add a description to this brand in BrandIQ to get video templates.',
};
const FALLBACK_MESSAGE = "Couldn't load templates right now. Please try again in a moment.";
const RENDER_FALLBACK_MESSAGE = "Couldn't start the image right now. Please try again in a moment.";

/**
 * GET /adsgpt/ad-studio/templates?brandId&media=image|video[&refresh=1][&skip=N]  (skip: next page, image or video)
 *
 * Called by the Ad Creative / Ad Video home galleries (FE thunk
 * fetchStudioTemplates). The user id comes from the JWT only — it scopes the
 * brand lookup, so one user can never request templates for another's brand.
 */
exports.getTemplates = async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  const { brandId, media, refresh, skip } = req.validatedQuery;

  try {
    const data = await getBrandTemplates({ userId: String(userId), brandId, media, refresh, skip });
    return res.status(200).json(data);
  } catch (error) {
    if (error instanceof StudioTemplateError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code,
        user_message: USER_MESSAGES[error.code] || FALLBACK_MESSAGE,
      });
    }
    logger.error(`[adStudio.templates] unexpected failure: ${error?.message}`);
    return res.status(500).json({ error: 'internal error', code: 'INTERNAL', user_message: FALLBACK_MESSAGE });
  }
};

/**
 * POST /adsgpt/ad-studio/templates/generate
 * body: { brandId, templateId, templateUrl, productImageUrls[1..3], prompt? }  (no model/ratio — ADS-R003)
 *
 * Called by the "Recreate this ad" modal (ImageTemplateModal). Answers 201 with
 * the pending ImageGeneration record as soon as DS has accepted the job — the
 * same moment imageController.generateImage answers — so the client plays the
 * genie into My Space, where the loader card waits for the `imageCreated` socket.
 */
exports.generate = async (req, res) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  try {
    const { image } = await startStudioImageRender({
      userId: String(userId),
      ...req.validatedBody,
    });
    return res.status(201).json({ success: true, data: image });
  } catch (error) {
    if (error instanceof StudioRenderError) {
      return res.status(error.status).json({
        success: false,
        error: error.message,
        code: error.code,
        user_message: error.status >= 500 ? RENDER_FALLBACK_MESSAGE : error.message,
      });
    }
    logger.error(`[adStudio.render] unexpected failure: ${error?.message}`);
    return res.status(500).json({ success: false, error: 'internal error', code: 'INTERNAL', user_message: FALLBACK_MESSAGE });
  }
};

/**
 * GET /adsgpt/ad-studio/templates/render-price → { credits }
 *
 * What one template render costs — the SAME function the charge uses
 * (studioImageRender.renderPrice: Nano Banana 2 at the medium tier, from the
 * model config). Shown on the "Recreate this ad" Generate button, so the
 * number the user sees is the number they are charged. `credits: null` when
 * pricing is unavailable (the render would be refused with NO_PRICE too).
 */
exports.renderPrice = (req, res) => {
  const credits = renderPrice();
  return res.status(200).json({ credits: credits > 0 ? credits : null });
};
