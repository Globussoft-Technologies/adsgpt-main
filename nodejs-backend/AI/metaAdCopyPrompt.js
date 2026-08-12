const { Type } = require("../services/ai/geminiClient");

const CTA_ENUM = [
  "LEARN_MORE",
  "SHOP_NOW",
  "SIGN_UP",
  "SUBSCRIBE",
  "CONTACT_US",
  "DOWNLOAD",
  "BOOK_NOW",
  "BOOK_TRAVEL",
  "GET_QUOTE",
  "APPLY_NOW",
  "GET_OFFER",
  // "GET_DETAILS" is not a real Meta CTA enum — corrected to "SEE_DETAILS"
  // 2026-07-08 (real hit, subcode-less #100 rejection listing Meta's full
  // valid enum set; see wizardSchema.js's CTA_LABELS for the full story).
  "SEE_DETAILS",
  "GET_SHOWTIMES",
  "ORDER_NOW",
  "WATCH_MORE",
  "LISTEN_NOW",
  "PLAY_GAME",
  "REQUEST_TIME",
  // "VIEW_MENU" is not a real Meta CTA enum — corrected to "SEE_MENU"
  // 2026-07-08 (same wrong-key-right-label mistake as GET_DETAILS/
  // SEE_DETAILS above, found the same day).
  "SEE_MENU",
  "INQUIRE_NOW",
  "SEND_UPDATES",
  "GET_PROMOTIONS",
  "MESSAGE_PAGE",
  "INSTAGRAM_MESSAGE",
  "VIEW_INSTAGRAM_PROFILE",
  "LIKE_PAGE",
  "WHATSAPP_MESSAGE",
  "CALL_NOW",
  "INSTALL_MOBILE_APP",
  "USE_APP",
  "USE_MOBILE_APP",
  "NO_BUTTON",
];


const responseSchema = {
     type:Type.OBJECT,
     properties:{
          primary_text: {type:Type.STRING},
          headline:{type:Type.STRING},
          description:{type:Type.STRING},
          call_to_action:{type:Type.STRING,enum:CTA_ENUM}
     },
     required:[
          "primary_text",
          "headline",
          "description",
          "call_to_action",
     ]
}

function buildAdCopyPrompt({prompt}){
      return `You are a senior Meta (Facebook/Instagram) Ads copywriter. Write ONE
high-converting ad creative for the product, offer, or brand described below.

BRIEF:
"""
${prompt}
"""
COPY PRINCIPLES:
- Infer the brand, product, and most likely target audience from the brief, and
  match the tone to that audience.
- If details are missing, make reasonable, realistic assumptions and write
  FINISHED copy. Never output bracketed placeholders like [Brand Name].
- Lead with the single strongest benefit or hook — no filler, no clichés.
- Plain text only. Do NOT use emojis.
- Do not invent specific prices, discounts, statistics, or claims that are not
  stated or clearly implied by the brief.

  
FIELD RULES:
- primary_text: the caption shown ABOVE the image. Hook the reader fast;
  <= 90 characters or fewer is ideal so it isn't truncated in the feed.
- headline: the bold line under the image. <= 30 characters. One clear value proposition.
- description: the small supporting line under the headline. <= 30 characters.
- call_to_action: choose EXACTLY ONE value from this list, whichever best
  matches the intent of the copy:
  ${CTA_ENUM.join(", ")}.

CONSTRAINTS:
- Write in the same language as the brief.
- Do not invent prices, discounts, or claims not implied by the brief.
- Return ONLY a JSON object matching the declared schema. No markdown, no commentary.`;
}

module.exports = { buildAdCopyPrompt, responseSchema, CTA_ENUM };