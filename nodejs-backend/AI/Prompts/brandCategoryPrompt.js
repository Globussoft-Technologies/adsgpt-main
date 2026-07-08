const { CATEGORY_NAMES } = require('../../utils/categoryTaxonomy');

// Prompt for classifying a brand into exactly one of the 45 canonical
// categories (or UNKNOWN). Used only for EXISTING brands that predate DS
// sending a category. New brands get their category from DS directly.
function buildBrandCategoryPrompt({ brandName, brandDescription, websiteUrl, keywords, targetAudiences }) {
  const keywordLine = Array.isArray(keywords) && keywords.length
    ? keywords.map(k => (typeof k === 'string' ? k : k?.term)).filter(Boolean).slice(0, 15).join(', ')
    : 'Not provided';
  const audienceLine = Array.isArray(targetAudiences) && targetAudiences.length
    ? targetAudiences.join(', ')
    : 'Not provided';

  return `You are classifying an advertising brand into ONE industry category.

Brand Name: ${brandName || 'Not provided'}
Brand Description: ${brandDescription || 'Not provided'}
Website: ${websiteUrl || 'Not provided'}
Keywords: ${keywordLine}
Target Audience: ${audienceLine}

Choose the SINGLE best-fitting category for this brand from this exact list:
${CATEGORY_NAMES.map(c => `- ${c}`).join('\n')}

RULES:
1. Return EXACTLY ONE category, spelled exactly as it appears in the list above.
2. Pick the category that best describes what the brand SELLS or DOES.
3. If no category clearly fits, or you are not confident, return "UNKNOWN".
4. Do not invent categories or return anything outside the list (plus "UNKNOWN").

Return ONLY valid JSON (no markdown, no commentary) in this exact shape:
{ "category": "Real Estate" }`;
}

module.exports = { buildBrandCategoryPrompt };
