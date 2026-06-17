const KEYWORD_VERSION = 'v3';

function buildCompetitorDiscoveryPrompt({ brandName, brandDescription, websiteUrl, region }) {
  return `You are a competitive intelligence analyst for digital advertising.

Analyze the brand below and return ONLY a JSON object with two arrays: "competitors" and "keywords".

Brand Name: ${brandName}
Brand Description: ${brandDescription || 'Not provided'}
Website: ${websiteUrl || 'Not provided'}
Region: ${region || 'Global'}

═══════════ COMPETITORS ═══════════
List 15-20 brands that DIRECTLY compete with this brand — i.e. they make or sell
similar products/services to the same target customers. Order them most-direct-first
(highest relevanceScore first).

STRICT RULES — follow exactly:
1. Use the SHORT, OFFICIAL BRAND NAME the company actually advertises under.
   GOOD: "Dell", "HP", "Lenovo", "Asus", "Apple"
   BAD:  "Dell Technologies Inc." (legal name), "Dell XPS" (product line)
2. Include ONLY genuine product/brand rivals.
3. NEVER include any of the following (these are NOT competitors):
   - Marketplaces, multi-brand retailers, or e-commerce platforms that resell
     many brands — e.g. Amazon, Flipkart, Croma, Reliance Digital, Snapdeal,
     Myntra, Ajio, TataCliq, Meesho, JioMart, Vijay Sales, Walmart, Best Buy, eBay.
   - Resellers, distributors, affiliates, coupon / deal / review / comparison sites.
   - The brand itself, its own sub-brands, or its parent company.
   - Generic or unrelated brands.
4. If unsure whether something is a true competitor or just a seller/channel, LEAVE IT OUT.
5. ADVERTISER VARIANTS (rare): a few competitors advertise under MORE than one
   industry-relevant name. For those, add EACH variant as its OWN separate
   competitor object (reuse the same domain & a similar relevanceScore). Example:
   for an audio/electronics brand, include BOTH { "name": "Sony" } and
   { "name": "Sony Electronics" } as two entries — but NOT "Sony LIV" (different
   industry). Do this ONLY in the rare cases where the brand genuinely advertises
   under a different name; MOST competitors need just ONE entry. Never duplicate
   the same name.

Each competitor: { "name", "domain" (best guess, e.g. "dell.com"), "relevanceScore" (0-100) }

═══════════ KEYWORDS ═══════════
List 10-15 search/ad keywords that these COMPETITORS would bid on or target
(not the brand's own name). Focus on competitor product and category terms.

Each keyword: { "term", "category": one of ["brand","product","general","intent"],
"volume": one of ["high","medium","low"] or null }

═══════════ OUTPUT ═══════════
Return ONLY valid JSON in this exact shape (no markdown, no commentary). Most
competitors are a single entry; only special cases like "Sony" get a 2nd variant entry:
{
  "competitors": [
    { "name": "Dell", "domain": "dell.com", "relevanceScore": 95 },
    { "name": "Sony", "domain": "sony.com", "relevanceScore": 80 },
    { "name": "Sony Electronics", "domain": "sony.com", "relevanceScore": 80 }
  ],
  "keywords": [
    { "term": "business laptops", "category": "product", "volume": "high" }
  ]
}`;
}

module.exports = { buildCompetitorDiscoveryPrompt, KEYWORD_VERSION };
