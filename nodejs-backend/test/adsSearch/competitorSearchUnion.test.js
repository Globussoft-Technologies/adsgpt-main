#!/usr/bin/env node

const assert = require('node:assert/strict');
const {
  __test: {
    PLATFORM_CONFIGS,
    buildContentDiscoveryClauses,
    resolvePlatformsToSearch,
    buildSortClauses,
  },
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

test('creates independent brand, keyword phrase, and category clauses', () => {
  const clauses = buildContentDiscoveryClauses(
    ['chocolate bars', 'best chocolate'],
    'Cadbury',
    'Consumer Packaged Goods',
    ['ad_title', 'ad_text'],
    ['category', 'industry'],
  );

  assert.equal(clauses.length, 4);
  assert.equal(clauses[0].multi_match._name, 'brand_name_match');
  assert.equal(clauses[0].multi_match.query, 'Cadbury');
  assert.equal(clauses[0].multi_match.type, 'phrase');
  assert.deepEqual(clauses[0].multi_match.fields, ['ad_title', 'ad_text']);
  assert.equal(clauses[1].multi_match._name, 'keyword_match_0');
  assert.equal(clauses[1].multi_match.query, 'chocolate bars');
  assert.equal(clauses[1].multi_match.type, 'phrase');
  assert.equal(clauses[2].multi_match.query, 'best chocolate');
  assert.equal(clauses[2].multi_match.type, 'phrase');
  assert.equal(clauses[3].bool._name, 'category_industry_match');
  assert.equal(clauses[3].bool.must[0].multi_match.type, 'phrase');
  assert.deepEqual(clauses[3].bool.must[0].multi_match.fields, ['category', 'industry']);
  assert.equal(clauses[3].bool.must[1].bool.minimum_should_match, 1);
});

test('does not turn a saved keyword phrase into generic token matches', () => {
  const keywordOnly = buildContentDiscoveryClauses(
    ['best chocolate'],
    '',
    '',
    ['title', 'text'],
    ['category'],
  );
  const categoryOnly = buildContentDiscoveryClauses(
    [],
    'Nike',
    'Fashion',
    ['title', 'text'],
    ['category'],
  );

  assert.equal(keywordOnly[0].multi_match.query, 'best chocolate');
  assert.equal(keywordOnly[0].multi_match.type, 'phrase');
  assert.equal(keywordOnly[0].multi_match.operator, undefined);
  assert.equal(categoryOnly[1].bool._name, 'category_industry_match');
  assert.deepEqual(categoryOnly[1].bool.must[0].multi_match.fields, ['category']);
});

test('isolates a selected platform and de-duplicates multi-platform selections', () => {
  assert.deepEqual(resolvePlatformsToSearch('facebook'), ['facebook']);
  assert.deepEqual(resolvePlatformsToSearch(['instagram']), ['instagram']);
  assert.deepEqual(resolvePlatformsToSearch('facebook,instagram,facebook'), [
    'facebook',
    'instagram',
  ]);
  assert.deepEqual(resolvePlatformsToSearch('all'), Object.keys(PLATFORM_CONFIGS));
});

test('uses the PowerAdSpy-style ad id as a stable pagination tiebreaker', () => {
  assert.deepEqual(buildSortClauses(PLATFORM_CONFIGS.facebook, 'date', 'desc'), [
    { 'facebook_ad.last_seen': { order: 'desc' } },
    { 'facebook_ad.id': { order: 'desc', unmapped_type: 'keyword' } },
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
