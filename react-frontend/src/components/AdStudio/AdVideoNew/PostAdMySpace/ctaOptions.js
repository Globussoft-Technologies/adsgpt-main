// Single source of truth for the MySpace → Post Ad CTA list. Used by
// the compose step's dropdown AND by useGenerateAdCopy when validating
// the call_to_action the API returns — if those two ever drift, valid
// generated CTAs would silently fall back to LEARN_MORE.
const CTA_OPTIONS = [
  'LEARN_MORE',
  'SHOP_NOW',
  'SIGN_UP',
  'SUBSCRIBE',
  'CONTACT_US',
  'DOWNLOAD',
  'BOOK_NOW',
  'BOOK_TRAVEL',
  'GET_QUOTE',
  'APPLY_NOW',
  'GET_OFFER',
  // 'GET_DETAILS' is not a real Meta CTA enum — corrected to 'SEE_DETAILS'
  // 2026-07-08 (same wrong value found and fixed in the V2 wizard's
  // wizardSchema.js CTA_LABELS the same day).
  'SEE_DETAILS',
  'GET_SHOWTIMES',
  'ORDER_NOW',
  'WATCH_MORE',
  'LISTEN_NOW',
  'PLAY_GAME',
  'REQUEST_TIME',
  // 'VIEW_MENU' is not a real Meta CTA enum — corrected to 'SEE_MENU'
  // 2026-07-08 (same wrong-key-right-label mistake as GET_DETAILS above).
  'SEE_MENU',
  'INQUIRE_NOW',
  'SEND_UPDATES',
  'GET_PROMOTIONS',
  'MESSAGE_PAGE',
  'INSTAGRAM_MESSAGE',
  'VIEW_INSTAGRAM_PROFILE',
  'LIKE_PAGE',
  'WHATSAPP_MESSAGE',
  'CALL_NOW',
  'INSTALL_MOBILE_APP',
  'USE_APP',
  'USE_MOBILE_APP',
  'NO_BUTTON',
];

export default CTA_OPTIONS;
