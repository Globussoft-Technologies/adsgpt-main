const KEYWORD_VERSION = 'v1';

function buildCompetitorDiscoveryPrompt({ brandName, brandDescription, websiteUrl, region }) {
  return `You are a competitive intelligence analyst for digital advertising.

Analyze the following brand and return a JSON object with two arrays: "competitors" and "keywords".

Brand Name: ${brandName}
Brand Description: ${brandDescription || 'Not provided'}
Website: ${websiteUrl || 'Not provided'}
Region: ${region || 'Global'}

For competitors, provide 20-25 brands that compete directly or indirectly. Be thorough and include:
- Direct competitors (same product/category)
- Indirect competitors (alternative solutions)
- Emerging/new brands in the space
- Include: name, domain (best guess), relevanceScore (0-100)

For keywords, provide 15-25 search/ad keywords that these COMPETITORS (not the brand itself) would actually bid on or target. Focus on competitor-specific terms, not the brand's own name or products. Include:
- term: The keyword phrase
- category: One of ["brand", "product", "general", "intent"]
- volume: Estimated search volume ["high", "medium", "low"] if inferrable, else null

Return ONLY valid JSON in this exact shape:
{
  "competitors": [
    { "name": "...", "domain": "...", "relevanceScore": 95 }
  ],
  "keywords": [
    { "term": "...", "category": "product", "volume": "high" }
  ]
}`;
}

module.exports = { buildCompetitorDiscoveryPrompt, KEYWORD_VERSION };
