// Canonical brand/template category vocabulary — SINGLE SOURCE OF TRUTH.
//
// These are the 45 top-level category names from category_structure.json
// (repo root). Both prompt templates and brand.category MUST use exactly
// these strings so a brand can be matched to its templates by simple string
// equality. DS (autofill / analyze APIs) is asked to return one of these;
// anything else is treated as "no category".
//
// Prompt templates are currently seeded for only 9 of these 45 (see
// promptTemplateSeed.json). Brands classified into the other 36 fall back to
// the General template list until those categories are seeded — no code
// change needed once seeded.

const CATEGORY_NAMES = [
  "Ad Safety Risk",
  "Adult Products and Services",
  "Alcohol",
  "Business and Industrial",
  "Cannabis",
  "Clothing and Accessories",
  "Collectables and Antiques",
  "Computer Software",
  "Consumer Electronics",
  "Consumer Packaged Goods",
  "Cosmetic Services",
  "Crypto",
  "Culture and Fine Arts",
  "Dating",
  "Debated Sensitive Social Issue",
  "Dieting and Weightloss",
  "Durable Goods",
  "Education and Careers",
  "Events and Performances",
  "Family and Parenting",
  "Finance and Insurance",
  "Fitness Activities",
  "Food and Beverage Services",
  "Gambling",
  "Gifts and Holiday Items",
  "Green/Eco",
  "Health and Medical Services",
  "Home and Garden Services",
  "Legal Services",
  "Media",
  "Metals",
  "Non-Profits",
  "Personal/Consumer Telecom",
  "Pet Ownership",
  "Pharmaceuticals",
  "Politics",
  "Real Estate",
  "Religion and Spirituality",
  "Retail",
  "Sexual Health",
  "Sporting Goods",
  "Tobacco",
  "Travel and Tourism",
  "Vehicles",
  "Weapons and Ammunition",
];

// Bump this when the classifier logic changes and every brand should be
// re-classified. Existing brands re-classify lazily on their user's next
// activity (version mismatch => needsClassify true). Seeding new template
// categories does NOT require a bump.
const CATEGORY_VERSION = "v1";

const CATEGORY_NAME_SET = new Set(CATEGORY_NAMES);

// True only for an exact match against the 45. Guards DS-supplied values and
// classifier output; anything else is stored as null (= "no category").
function isValidCategory(name) {
  return typeof name === "string" && CATEGORY_NAME_SET.has(name);
}

module.exports = {
  CATEGORY_NAMES,
  CATEGORY_VERSION,
  isValidCategory,
};
