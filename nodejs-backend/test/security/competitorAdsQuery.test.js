#!/usr/bin/env node

const assert = require('node:assert/strict');
const {
  getCompetitorAdsQuery,
  searchCompetitorAdsQuery,
  validateCompetitorAdsQuery,
} = require('../../Validations/competitorAds.validator');

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

console.log('competitor ads query validation');

test('accepts every platform exposed by the competitor filter', () => {
  for (const platform of [
    'youtube',
    'facebook',
    'instagram',
    'linkedin',
    'gdn',
    'pinterest',
    'reddit',
  ]) {
    const { error } = getCompetitorAdsQuery.validate({ platform });
    assert.equal(error, undefined, `${platform} should be accepted`);
  }
});

test('accepts a comma-separated multi-platform selection', () => {
  const { error, value } = getCompetitorAdsQuery.validate({
    platform: 'facebook,pinterest,reddit',
  });
  assert.equal(error, undefined);
  assert.equal(value.platform, 'facebook,pinterest,reddit');
});

test('accepts category IDs, date filters, sorting, and bounded pagination', () => {
  const { error, value } = getCompetitorAdsQuery.validate({
    categoryId: '12,34',
    subCategoryId: ['56', '78'],
    dateFrom: '2026-01-01T00:00:00.000Z',
    dateTo: '2026-01-31T23:59:59.000Z',
    page: '2',
    pageSize: '100',
    sort: 'oldest',
    search: ' summer sale ',
    searchType: 'keyword',
  });

  assert.equal(error, undefined);
  assert.equal(value.page, 2);
  assert.equal(value.pageSize, 100);
  assert.equal(value.search, 'summer sale');
  assert.equal(value.searchType, 'keyword');
});

test('rejects unsupported platforms and oversized pages', () => {
  assert.ok(getCompetitorAdsQuery.validate({ platform: 'unknown' }).error);
  assert.ok(getCompetitorAdsQuery.validate({ platform: 'tiktok' }).error);
  assert.ok(getCompetitorAdsQuery.validate({ pageSize: 101 }).error);
  assert.ok(getCompetitorAdsQuery.validate({ searchType: 'anything' }).error);
  assert.ok(getCompetitorAdsQuery.validate({ search: 'x'.repeat(121) }).error);
});

test('independent search requires a non-empty bounded search term', () => {
  const { error, value } = searchCompetitorAdsQuery.validate({
    search: ' Nike ',
    searchType: 'competitor',
  });
  assert.equal(error, undefined);
  assert.equal(value.search, 'Nike');
  assert.ok(searchCompetitorAdsQuery.validate({}).error);
  assert.ok(searchCompetitorAdsQuery.validate({ search: '   ' }).error);
  assert.ok(searchCompetitorAdsQuery.validate({ search: 'x'.repeat(121) }).error);
});

test('middleware strips client-supplied identity from the query', () => {
  const req = { query: { userId: 'another-user', page: '1' } };
  let responseStatus;
  let nextCalled = false;
  const res = {
    status(status) {
      responseStatus = status;
      return this;
    },
    json() {},
  };

  validateCompetitorAdsQuery(req, res, () => {
    nextCalled = true;
  });

  assert.equal(responseStatus, undefined);
  assert.equal(nextCalled, true);
  assert.equal(req.query.userId, undefined);
  assert.equal(req.query.page, 1);
});

console.log(`\n${passed} passed`);
if (process.exitCode) console.error('FAILED');
