const { GoogleGenerativeAI } = require('@google/generative-ai');
const brandNameLists = require('../Module/brandNames/brandNamesSchema');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const responseSchema = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          audienceName: { type: 'string' },
          interests: { type: 'array', items: { type: 'string' } },
          geographic: { type: 'string' },
          ageRange: { type: 'string' },
          gender: { type: 'string' },
          reasoning: { type: 'string' },
        },
        required: ['audienceName', 'interests', 'geographic', 'ageRange', 'gender', 'reasoning'],
      },
      minItems: 3,
      maxItems: 3,
    },
  },
  required: ['suggestions'],
};

function buildAudiencePrompt({ brandName, brandDescription, region, websiteUrl }) {
  return `You are a digital advertising strategist with deep expertise in audience research.

Analyze this brand and identify 3 distinct audience segments most likely to convert for this brand:

Brand Name: ${brandName}
Brand Description: ${brandDescription || 'Not provided'}
Primary Audience Region: ${region || 'Not specified'}
Website: ${websiteUrl || 'Not provided'}

For each audience segment provide:
- audienceName: A specific descriptive name (e.g., "Urban fitness enthusiasts aged 25–35")
- interests: 4-6 interest keywords that define this audience (e.g. hobbies, topics, behaviours)
- geographic: Specific region, city, or metro area where this audience is concentrated
- ageRange: Age band (e.g., "25-34")
- gender: "All", "Male", or "Female"
- reasoning: One sentence explaining why this audience is a strong fit for the brand

Return exactly 3 ranked audience segments. Rank from highest to lowest expected conversion potential.`;
}

const getAudienceSuggestions = async (req, res) => {
  const { userId, brandId, force = false } = req.body;

  if (!userId || !brandId) {
    return res.status(400).json({ message: 'userId and brandId are required' });
  }

  try {
    const user = await brandNameLists.findOne({ user_id: userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const brand = user.brands.find((b) => b.id === brandId);
    if (!brand) return res.status(404).json({ message: 'Brand not found' });

    // Return cached if available and not forcing refresh
    if (!force && brand.audienceSuggestions?.length === 3) {
      return res.status(200).json({ suggestions: brand.audienceSuggestions, cached: true });
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.4,
      },
    });

    const prompt = buildAudiencePrompt({
      brandName: brand.brandName,
      brandDescription: brand.brandDescription,
      region: brand.region,
      websiteUrl: brand.websiteUrl,
    });

    const llmResult = await model.generateContent(prompt);
    const rawText = llmResult?.response?.text?.() || '';

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      return res.status(502).json({ message: 'LLM returned invalid JSON', details: err.message });
    }

    const suggestions = parsed?.suggestions || [];
    if (suggestions.length !== 3) {
      return res.status(502).json({ message: 'LLM did not return exactly 3 suggestions' });
    }

    // Cache in DB
    brand.audienceSuggestions = suggestions;
    user.markModified('brands');
    await user.save();

    return res.status(200).json({ suggestions, cached: false });
  } catch (err) {
    console.error('getAudienceSuggestions error:', err);
    return res.status(500).json({ message: err.message || 'Failed to generate audience suggestions' });
  }
};

module.exports = { getAudienceSuggestions };
