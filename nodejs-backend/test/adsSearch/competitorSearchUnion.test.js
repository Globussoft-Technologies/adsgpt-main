#!/usr/bin/env node

const assert = require('node:assert/strict');
const {
  __test: { PLATFORM_CONFIGS, buildContentDiscoveryClauses },
} = require('../../services/adsSearch/competitorSearch');

let passed = 0;

const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
};

console.log('selected-brand competitor ads union');

test('creates independent keyword and category/industry match clauses', () => {
  const clauses = buildContentDiscoveryClauses(
    'motorcycle roadster',
    'Vehicles',
    ['ad_title', 'ad_text'],
    ['category', 'industry', 'ad_title', 'ad_text'],
  );

  assert.equal(clauses.length, 2);
  assert.equal(clauses[0].multi_match._name, 'keyword_match');
  assert.equal(clauses[0].multi_match.operator, 'or');
  assert.deepEqual(clauses[0].multi_match.fields, ['ad_title', 'ad_text']);
  assert.equal(clauses[1].multi_match._name, 'category_industry_match');
  assert.equal(clauses[1].multi_match.operator, 'and');
  assert.deepEqual(
    clauses[1].multi_match.fields,
    ['category', 'industry', 'ad_title', 'ad_text'],
  );
});

test('omits only the discovery source whose selected-brand value is absent', () => {
  const keywordOnly = buildContentDiscoveryClauses(
    'running shoes',
    '',
    ['title', 'text'],
    ['category', 'title', 'text'],
  );
  const categoryOnly = buildContentDiscoveryClauses(
    '',
    'Fashion',
    ['title', 'text'],
    ['category', 'title', 'text'],
  );

  assert.deepEqual(keywordOnly.map((clause) => clause.multi_match._name), ['keyword_match']);
  assert.deepEqual(categoryOnly.map((clause) => clause.multi_match._name), [
    'category_industry_match',
  ]);
});

test('uses the supplied extended Facebook and Instagram keyword fields', () => {
  assert.ok(PLATFORM_CONFIGS.facebook.keywordFields.includes('facebook_translation.ad_text'));
  assert.ok(
    PLATFORM_CONFIGS.facebook.keywordFields.includes(
      'facebook_ad_variants.newsfeed_description_exactly',
    ),
  );
  assert.ok(PLATFORM_CONFIGS.instagram.keywordFields.includes('instagram_translation.ad_title'));
  assert.ok(
    PLATFORM_CONFIGS.instagram.keywordFields.includes(
      'instagram_translations.ar.newsfeed_description',
    ),
  );
});

test('defines keyword and category/industry coverage for every enabled platform', () => {
  for (const [platform, config] of Object.entries(PLATFORM_CONFIGS)) {
    assert.ok(config.keywordFields.length > 0, `${platform} needs keyword fields`);
    assert.ok(config.categoryFields.length > 0, `${platform} needs category/industry fields`);
  }
});

console.log(`\n${passed} passed`);
if (process.exitCode) console.error('FAILED');
