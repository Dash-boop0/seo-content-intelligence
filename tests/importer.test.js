import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYWORD_FIELDS, COMPETITOR_FIELDS, OUR_PAGE_FIELDS, guessMapping, parseNumberCell, parseField, importKeywordRows, importSimpleRows, validateMapping } from '../src/lib/importer.js';

test('guesses mappings from common tool headers', () => {
  const m = guessMapping(['Search Term', 'Avg. Monthly Searches', 'KD', 'CPC (USD)', 'Position', 'Ranking URL'], KEYWORD_FIELDS);
  assert.deepEqual(m, { keyword: 0, volume: 1, difficulty: 2, cpc: 3, rank: 4, url: 5 });
  const m2 = guessMapping(['Keyword', 'Keyword Difficulty', 'Search Volume'], KEYWORD_FIELDS);
  assert.deepEqual(m2, { keyword: 0, volume: 2, difficulty: 1, cpc: -1, rank: -1, url: -1 });
});
test('keyword column is required', () => {
  const m = guessMapping(['Volume'], KEYWORD_FIELDS);
  assert.equal(validateMapping(m, KEYWORD_FIELDS).length, 1);
  assert.throws(() => importKeywordRows([['10']], m), /Keyword/);
});
test('number parsing understands separators, currency, percent and k/m', () => {
  assert.deepEqual(parseNumberCell('12,100'), { value: 12100, error: null });
  assert.deepEqual(parseNumberCell('1.2k'), { value: 1200, error: null });
  assert.deepEqual(parseNumberCell('$4.20'), { value: 4.2, error: null });
  assert.deepEqual(parseNumberCell('45%'), { value: 45, error: null });
  assert.deepEqual(parseNumberCell('2M'), { value: 2000000, error: null });
  for (const m of ['', ' ', '-', 'n/a', 'N/A', 'null']) assert.deepEqual(parseNumberCell(m), { value: null, error: null }, m);
  assert.equal(parseNumberCell('lots').value, null);
  assert.match(parseNumberCell('lots').error, /not a number/);
});
test('field validation rejects out-of-range values instead of guessing', () => {
  assert.equal(parseField('difficulty', '120').value, null);
  assert.match(parseField('difficulty', '120').error, /0–100/);
  assert.equal(parseField('volume', '-5').value, null);
  assert.equal(parseField('rank', '0').value, null);
  assert.equal(parseField('rank', '3.5').value, null);
  assert.equal(parseField('rank', '7').value, 7);
  assert.equal(parseField('volume', '1,234.6').value, 1235);
  assert.equal(parseField('cpc', '1.234').value, 1.23);
});
test('imports rows: missing stays null, bad values warn, empty keywords skipped', () => {
  const rows = [
    ['crm software', '1,000', '45', '', '12', 'https://a.example.com'],
    ['', '10', '1', '', '', ''],
    ['crm app', '', 'abc', '2.5', '', ''],
    ['  crm   tool ', 'n/a', '', '', '', '']
  ];
  const r = importKeywordRows(rows, { keyword: 0, volume: 1, difficulty: 2, cpc: 3, rank: 4, url: 5 }, 10);
  assert.equal(r.records.length, 3);
  assert.equal(r.skipped, 1);
  assert.equal(r.nextId, 13);
  assert.deepEqual(r.records[0], { id: 'k10', keyword: 'crm software', volume: 1000, difficulty: 45, cpc: null, rank: 12, url: 'https://a.example.com', intentOverride: null, mergedFrom: [] });
  assert.equal(r.records[1].volume, null);
  assert.equal(r.records[1].difficulty, null);
  assert.equal(r.records[2].keyword, 'crm tool');
  assert.deepEqual(r.warnings.map(w => [w.row, w.field]), [[3, 'keyword'], [4, 'difficulty']]);
});
test('unmapped optional columns are left missing', () => {
  const r = importKeywordRows([['a', '5']], { keyword: 0, volume: -1, difficulty: -1, cpc: -1, rank: -1, url: -1 });
  assert.equal(r.records[0].volume, null);
});
test('competitor and our-pages imports auto-detect columns and validate', () => {
  const c = importSimpleRows(['competitor_domain', 'url', 'topic'], [['x.example.com', 'https://x.example.com/a', 'crm'], ['', '', 'y']], COMPETITOR_FIELDS);
  assert.equal(c.items.length, 1);
  assert.equal(c.warnings.length, 1);
  assert.deepEqual(c.items[0], { domain: 'x.example.com', url: 'https://x.example.com/a', topic: 'crm' });
  const p = importSimpleRows(['url', 'title', 'primary_topic'], [['https://me.example.com', 'Home', 'crm']], OUR_PAGE_FIELDS);
  assert.deepEqual(p.items[0], { url: 'https://me.example.com', title: 'Home', topic: 'crm' });
  assert.throws(() => importSimpleRows(['foo'], [['x']], COMPETITOR_FIELDS), /Missing column/);
});
