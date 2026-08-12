const { generateJson, MODELS } = require('../services/ai/geminiClient');
const brandNameLists = require('../Module/brandNames/brandNamesSchema');
const { buildBrandCategoryPrompt } = require('../AI/Prompts/brandCategoryPrompt');
const {
  CATEGORY_VERSION,
  isValidCategory,
} = require('../utils/categoryTaxonomy');

// How many brands to classify concurrently in the background warm-up. Kept
// low so one active user with many un-classified brands can't burst the
// Gemini rate limit.
const CLASSIFY_CONCURRENCY = 3;

// A PENDING category job older than this is considered stale (process crashed
// / hung mid-classify) and is allowed to re-run. Mirrors the discovery job.
const STALE_PENDING_MS = 10 * 60 * 1000; // 10 minutes

function isStalePending(job) {
  if (!job || job.status !== 'PENDING') return false;
  if (!job.startedAt) return true;
  return Date.now() - new Date(job.startedAt).getTime() > STALE_PENDING_MS;
}

// A brand needs classification when it has no valid category AND there isn't a
// fresh (non-stale) PENDING job already running at the current version. A DONE
// job at the current version with a valid category is skipped (idempotent).
function needsClassify(brand) {
  if (!brand) return false;
  if (isValidCategory(brand.category)) return false;
  const job = brand.categoryJob;
  if (job && job.status === 'PENDING' && !isStalePending(job)) return false; // in-flight
  return true;
}

// ── Structured output schema for Gemini ─────────────────────────────────
// NOTE: we deliberately do NOT use an `enum` here. The Generative Language
// API rejects an enum'd responseSchema with an immediate 400 (this is the one
// thing that differs from the working competitor-discovery call). The 45-value
// constraint is enforced by the prompt (which lists them) + the isValidCategory
// post-filter below, so a plain string schema is both sufficient and reliable.
const responseSchema = {
  type: 'object',
  properties: {
    category: { type: 'string' },
  },
  required: ['category'],
};

// Pure Gemini call — no DB writes. Returns a valid category string or null
// (null = model unsure / value not in the 45). Throws on an API/parse error
// so the caller can record a FAILED job.
async function classifyBrandCategory(brand) {
  const prompt = buildBrandCategoryPrompt({
    brandName: brand.brandName,
    brandDescription: brand.brandDescription,
    websiteUrl: brand.websiteUrl,
    keywords: brand.keywords,
    targetAudiences: brand.targetAudiences,
  });

  let parsed;
  try {
    ({ json: parsed } = await generateJson({
      model: MODELS.FAST,
      prompt,
      responseSchema,
      temperature: 0,
      timeoutMs: 30000,
    }));
  } catch (err) {
    // Callers record this on the brand's categoryJob as FAILED.
    console.log(err.message);
    throw err;
  }

  return isValidCategory(parsed?.category) ? parsed.category : null;
}

// Run async tasks with a bounded concurrency (no external deps).
async function runPool(items, worker, concurrency) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

// ── Single-brand classify (BLOCKING) — used by the on-select endpoint ─────
// Loads the user, classifies one brand if needed, persists, and returns the
// resolved category (or null). Idempotent: returns immediately without a
// Gemini call if the brand is already classified at the current version.
async function enrichBrandCategory(userId, brandId) {
  const user = await brandNameLists.findOne({ user_id: userId });
  if (!user) return null;
  const brand = user.brands.find(b => b.id === brandId);
  if (!brand) return null;

  if (!needsClassify(brand)) return brand.category ?? null;

  brand.categoryJob = {
    status: 'PENDING',
    startedAt: new Date(),
    completedAt: null,
    errorMessage: null,
    categoryVersion: CATEGORY_VERSION,
  };
  user.markModified('brands');
  await user.save();

  try {
    const category = await classifyBrandCategory(brand);
    brand.category = category; // may be null (unsure)
    brand.categoryJob = {
      status: 'DONE',
      startedAt: brand.categoryJob.startedAt,
      completedAt: new Date(),
      errorMessage: null,
      categoryVersion: CATEGORY_VERSION,
    };
    user.markModified('brands');
    await user.save();
    return category;
  } catch (err) {
    brand.categoryJob = {
      status: 'FAILED',
      startedAt: brand.categoryJob?.startedAt || new Date(),
      completedAt: new Date(),
      errorMessage: err.message,
      categoryVersion: CATEGORY_VERSION,
    };
    user.markModified('brands');
    await user.save();
    return null;
  }
}

// ── Background warm-up (FIRE-AND-FORGET) — used by get-lists ───────────────
// Classifies all of a user's brands that need it. Persists PENDING for the
// whole batch up front (so a concurrent get-lists sees the guard and skips),
// then classifies with bounded concurrency and saves the results once.
async function enrichUserBrands(userId) {
  try {
    const user = await brandNameLists.findOne({ user_id: userId });
    if (!user) return;

    const needy = user.brands.filter(needsClassify);
    if (needy.length === 0) return;

    // 1. Persist PENDING for the whole batch so concurrent requests skip these.
    const now = new Date();
    needy.forEach((brand) => {
      brand.categoryJob = {
        status: 'PENDING',
        startedAt: now,
        completedAt: null,
        errorMessage: null,
        categoryVersion: CATEGORY_VERSION,
      };
    });
    user.markModified('brands');
    await user.save();

    // 2. Classify with bounded concurrency, mutating the in-memory docs.
    await runPool(needy, async (brand) => {
      try {
        const category = await classifyBrandCategory(brand);
        brand.category = category;
        brand.categoryJob = {
          status: 'DONE',
          startedAt: brand.categoryJob.startedAt,
          completedAt: new Date(),
          errorMessage: null,
          categoryVersion: CATEGORY_VERSION,
        };
      } catch (err) {
        brand.categoryJob = {
          status: 'FAILED',
          startedAt: brand.categoryJob?.startedAt || new Date(),
          completedAt: new Date(),
          errorMessage: err.message,
          categoryVersion: CATEGORY_VERSION,
        };
      }
    }, CLASSIFY_CONCURRENCY);

    // 3. Single save for all results.
    user.markModified('brands');
    await user.save();
  } catch (err) {
    // Fire-and-forget: never throw into the caller (the get-lists response
    // has already been sent). Swallow after logging.
    // eslint-disable-next-line no-console
    console.warn(`[brandCategory] enrichUserBrands failed for ${userId}: ${err.message}`);
  }
}

// ── Express handler for the on-select blocking classify ──────────────────
// POST /adsgpt/brand/:brandId/ensure-category  { userId }
// Returns the resolved category (classifying synchronously if needed).
async function ensureCategoryHandler(req, res) {
  try {
    const { brandId } = req.params;
    const userId = req.body?.userId || req.query?.userId;
    if (!userId || !brandId) {
      return res.status(400).json({ message: 'userId and brandId are required' });
    }
    const category = await enrichBrandCategory(userId, brandId);
    return res.status(200).json({ brandId, category: category ?? null });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[brandCategory] ensure-category failed: ${err.message}`);
    return res.status(500).json({ message: 'Failed to resolve brand category' });
  }
}

module.exports = {
  needsClassify,
  isStalePending,
  classifyBrandCategory,
  enrichBrandCategory,
  enrichUserBrands,
  ensureCategoryHandler,
};
