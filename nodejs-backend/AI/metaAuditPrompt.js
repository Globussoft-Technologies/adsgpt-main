const { SchemaType } = require("@google/generative-ai");
const {
  ALLOWED_ACTION_TYPES,
  buildLLMActionCatalog,
} = require("../config/metaFixActions");

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    findings: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          severity: {
            type: SchemaType.STRING,
            enum: ["critical", "warning", "opportunity"],
          },
          entity_type: {
            type: SchemaType.STRING,
            enum: ["campaign", "adset", "ad"],
          },
          entity_id: { type: SchemaType.STRING },
          entity_name: { type: SchemaType.STRING },
          title: { type: SchemaType.STRING },
          reasoning: { type: SchemaType.STRING },
          fix: {
            type: SchemaType.OBJECT,
            properties: {
              action_type: {
                type: SchemaType.STRING,
                enum: ALLOWED_ACTION_TYPES,
              },
              params_json: { type: SchemaType.STRING },
              risk_level: {
                type: SchemaType.STRING,
                enum: ["low", "medium", "high"],
              },
              reversible: { type: SchemaType.BOOLEAN },
            },
            required: ["action_type", "params_json", "risk_level", "reversible"],
          },
        },
        required: [
          "severity",
          "entity_type",
          "entity_id",
          "entity_name",
          "title",
          "reasoning",
          "fix",
        ],
      },
    },
  },
  required: ["findings"],
};

function buildPrompt({ accountName, currency, campaignData, adsetData, adData }) {
  const catalog = buildLLMActionCatalog();

  return `You are a senior Meta Ads strategist performing a performance audit for account "${accountName}" (currency: ${currency}).

You will analyze normalized data for campaigns, ad sets, and ads over the last 14 days (with previous-period comparisons where available) and produce a list of actionable findings.

────────────────────────────────────────────────────
ANALYSIS PRINCIPLES
────────────────────────────────────────────────────
1. Focus on findings that warrant action. Do NOT list every metric — only issues or opportunities.
2. Every finding MUST include an executable fix from the allowed action catalog below. Do not invent action types.
3. Severity guide:
   - critical: wasted spend, policy risk, broken delivery, ROAS collapse, severe overpacing
   - warning: performance degradation, rising costs, fatigue signs, frequency drift
   - opportunity: scale candidates, fresh audiences, top-performer underfunding
4. Be specific in reasoning — cite exact metrics (spend, CTR, CPA, ROAS, frequency, etc.).
5. Reference the correct entity_id from the data. Do not hallucinate IDs.
6. For budget adjustments, express amounts in MINOR units (cents/paise) — multiply the currency amount by 100. E.g., $50/day = 5000.
7. For ADJUST_BUDGET, suggest a new value between 0.3x and 3x current. The server will clamp out-of-range values.
8. For targeting patches (NARROW/BROADEN_AUDIENCE), provide only the fragment to merge into the existing targeting object — not the full spec.
9. For schedule changes, use ISO 8601 timestamps.
10. params_json must be a VALID JSON string containing the params object for the chosen action.

────────────────────────────────────────────────────
ALLOWED FIX ACTIONS (pick exactly one per finding)
────────────────────────────────────────────────────
${catalog}

────────────────────────────────────────────────────
DATA — CAMPAIGNS
────────────────────────────────────────────────────
${JSON.stringify(campaignData, null, 2)}

────────────────────────────────────────────────────
DATA — AD SETS
────────────────────────────────────────────────────
${JSON.stringify(adsetData, null, 2)}

────────────────────────────────────────────────────
DATA — ADS
────────────────────────────────────────────────────
${JSON.stringify(adData, null, 2)}

────────────────────────────────────────────────────
OUTPUT
────────────────────────────────────────────────────
Return a JSON object matching the declared response schema. Do not include any commentary outside the JSON. Aim for 5-20 high-signal findings ordered naturally; the server will re-sort by severity.
`;
}

module.exports = {
  buildPrompt,
  responseSchema,
};
