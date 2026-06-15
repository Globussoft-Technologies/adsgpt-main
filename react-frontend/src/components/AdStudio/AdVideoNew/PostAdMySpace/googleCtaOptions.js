// Google's accepted CTA enum is narrower than Meta's. Source: the
// DISPLAY-ad section of the create-ads spec
// (`google files docs/22-create-ads.md`) — same list applies to
// DEMAND_GEN / VIDEO. ORDER_NOW + VISIT_SITE used to live here but
// aren't in Google's enum; the backend was rejecting them. SHOP_NOW
// and SIGN_UP were missing and have been added back.
const GOOGLE_CTA_OPTIONS = [
  'LEARN_MORE',
  'SHOP_NOW',
  'SIGN_UP',
  'GET_QUOTE',
  'APPLY_NOW',
  'CONTACT_US',
  'SUBSCRIBE',
  'DOWNLOAD',
  'BOOK_NOW',
  'GET_OFFER',
];

export default GOOGLE_CTA_OPTIONS;
