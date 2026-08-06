// Clean-up for History drawer rows.
//
// The agent now sanitises the title and preview when it WRITES them
// (Agent/src/utils/db.py), but every conversation created before that still has
// the raw text stored — a generated-creative reply keeps its
// "![](/creatives/GPT-17/….webp)" embed, which reads as machine noise under a
// row. Rows are cheap to clean at render, so old history looks right
// immediately instead of needing a migration.
//
// Mirrors _strip_media_noise in db.py — keep the two in step.
const MD_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const MD_LINK = /\[([^\]]*)\]\([^)]*\)/g;
// The stored preview is cut at 200 chars, so the embed is often UNTERMINATED —
// "![](/creatives/GPT-" with no closing paren. The closed patterns above skip
// those entirely, which is exactly what was still leaking into the drawer.
const MD_OPEN = /!?\[[^\]]*\]\([^)]*$/;
const URL = /https?:\/\/\S+/gi;
const BARE_DOMAIN = /\bwww\.\S+/gi;
const MEDIA_PATH = /\/\S*\.(?:png|jpe?g|gif|webp|bmp|svg|mp4|webm|mov)\b\S*/gi;
// Stored-media paths that lost their extension to the same truncation.
const STORED_PATH = /\/(?:creatives|uploads|generated|media)\/\S*/gi;

export const cleanHistoryText = (text) =>
  String(text || '')
    .replace(MD_IMAGE, ' ')
    .replace(MD_LINK, '$1')
    .replace(MD_OPEN, ' ')
    .replace(URL, ' ')
    .replace(BARE_DOMAIN, ' ')
    .replace(MEDIA_PATH, ' ')
    .replace(STORED_PATH, ' ')
    .replace(/\s+/g, ' ')
    // Trim the punctuation a stripped link tends to leave stranded.
    .replace(/^[\s\-–—:,.]+|[\s\-–—:,.]+$/g, '');
