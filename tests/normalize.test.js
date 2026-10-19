import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKeyword, foldPlural, tokenize, tokenSetKey, findDuplicates, mergeDuplicateGroup } from '../src/lib/normalize.js';

test('normalisation: lowercase, trim, collapse whitespace, strip punctuation and diacritics', () => {
  assert.equal(normalizeKeyword('  Time-Tracking   Software! '), 'time tracking software');
  assert.equal(normalizeKeyword('Don’t miss: CAFÉ apps'), 'dont miss cafe apps');
  assert.equal(normalizeKeyword('time tracking, invoicing & billing'), 'time tracking invoicing billing');
  assert.equal(normalizeKeyword(''), '');
  assert.equal(normalizeKeyword(null), '');
});
test('simple plural folding', () => {
  const cases = { apps: 'app', agencies: 'agency', templates: 'template', hours: 'hour', classes: 'class', matches: 'match', boxes: 'box',
    business: 'business', status: 'status', analysis: 'analysis', news: 'news', sales: 'sales', gps: 'gps', bus: 'bus', '10s': '10s' };
  for (const [a, b] of Object.entries(cases)) assert.equal(foldPlural(a), b, a);
});
test('tokenize and token-set key are order- and plural-insensitive', () => {
  assert.deepEqual(tokenize('Timesheet Templates'), ['timesheet', 'template']);
  assert.deepEqual(tokenize('Timesheet Templates', { fold: false }), ['timesheet', 'templates']);
  assert.equal(tokenSetKey('time tracking apps'), tokenSetKey('app time tracking'));
});

const kws = [
  { id: 'k1', keyword: 'time tracking software', volume: 9900 },
  { id: 'k2', keyword: 'Time Tracking Software ', volume: null },
  { id: 'k3', keyword: 'time-tracking software', volume: 100 },
  { id: 'k4', keyword: 'timesheet template', volume: 12100 },
  { id: 'k5', keyword: 'timesheet templates', volume: 2400 },
  { id: 'k6', keyword: 'pomodoro timer', volume: 33100 }
];
test('finds exact and near duplicates', () => {
  const groups = findDuplicates(kws);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], { key: 'exact:time tracking software', kind: 'exact', ids: ['k1', 'k2', 'k3'], reason: 'Same normalised form: "time tracking software"' });
  assert.equal(groups[1].kind, 'near');
  assert.deepEqual(groups[1].ids, ['k4', 'k5']);
});
test('near duplicates need plural folding when it is turned off', () => {
  const groups = findDuplicates(kws, { fold: false });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'exact');
});
test('word-order variants are near duplicates; dismissed groups are skipped', () => {
  const g = findDuplicates([{ id: 'a', keyword: 'best crm app' }, { id: 'b', keyword: 'crm app best' }]);
  assert.equal(g[0].kind, 'near');
  assert.equal(findDuplicates([{ id: 'a', keyword: 'best crm app' }, { id: 'b', keyword: 'crm app best' }], { dismissed: [g[0].key] }).length, 0);
});
test('merge keeps the highest-volume row, fills missing fields, never sums volume', () => {
  const list = [
    { id: 'a', keyword: 'crm', volume: 100, difficulty: null, cpc: null, rank: null, url: '', mergedFrom: [] },
    { id: 'b', keyword: 'CRM', volume: 500, difficulty: null, cpc: 2.5, rank: null, url: '', mergedFrom: [] },
    { id: 'c', keyword: 'crm.', volume: null, difficulty: 40, cpc: 9, rank: 7, url: 'https://x.example.com', mergedFrom: [] },
    { id: 'd', keyword: 'other', volume: 1, difficulty: 1, cpc: 1, rank: 1, url: '', mergedFrom: [] }
  ];
  const r = mergeDuplicateGroup(list, ['a', 'b', 'c']);
  assert.equal(r.canonicalId, 'b');
  assert.deepEqual(r.removedIds, ['a', 'c']);
  assert.equal(r.keywords.length, 2);
  const m = r.keywords.find(k => k.id === 'b');
  assert.equal(m.volume, 500);
  assert.equal(m.cpc, 2.5, 'canonical value wins');
  assert.equal(m.difficulty, 40, 'filled from donor');
  assert.equal(m.rank, 7);
  assert.equal(m.url, 'https://x.example.com');
  assert.deepEqual(m.mergedFrom.map(x => x.keyword), ['crm', 'crm.']);
  assert.equal(list[1].difficulty, null, 'input is not mutated');
});
test('merge with all volumes missing keeps the first row', () => {
  const r = mergeDuplicateGroup([{ id: 'a', keyword: 'x', volume: null }, { id: 'b', keyword: 'X', volume: null }], ['a', 'b']);
  assert.equal(r.canonicalId, 'a');
  assert.equal(r.keywords[0].volume, null);
});
