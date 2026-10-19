import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV, parseCSVWithHeaders } from '../src/lib/csv.js';
import { KEYWORD_FIELDS, COMPETITOR_FIELDS, OUR_PAGE_FIELDS, guessMapping, importKeywordRows, importSimpleRows } from '../src/lib/importer.js';
import { defaultState } from '../src/lib/state.js';
import { analyse, clusterIntent, recommendationsCSV, recommendationsMarkdown, keywordsCSV } from '../src/lib/pipeline.js';
import { mergeDuplicateGroup } from '../src/lib/normalize.js';

const read = f => readFileSync(new URL('../sample-data/' + f, import.meta.url), 'utf8');
function sampleState() {
  const k = parseCSVWithHeaders(read('keywords-sample.csv'));
  const s = defaultState();
  s.keywords = importKeywordRows(k.rows, guessMapping(k.headers, KEYWORD_FIELDS), 1).records;
  const c = parseCSVWithHeaders(read('competitors-sample.csv'));
  const p = parseCSVWithHeaders(read('our-pages-sample.csv'));
  s.competitors = importSimpleRows(c.headers, c.rows, COMPETITOR_FIELDS).items;
  s.ourPages = importSimpleRows(p.headers, p.rows, OUR_PAGE_FIELDS).items;
  s.isSample = true;
  return s;
}

test('cluster intent = majority, ties broken transactional > commercial > informational > navigational', () => {
  assert.equal(clusterIntent(['informational', 'informational', 'commercial']), 'informational');
  assert.equal(clusterIntent(['informational', 'commercial']), 'commercial');
  assert.equal(clusterIntent(['unclassified', 'unclassified']), 'unclassified');
  assert.equal(clusterIntent(['unclassified', 'navigational']), 'navigational');
});

test('sample data: import, intents, duplicates', () => {
  const s = sampleState();
  assert.equal(s.keywords.length, 77);
  assert.equal(s.competitors.length, 19);
  assert.equal(s.ourPages.length, 10);
  const a = analyse(s);
  assert.deepEqual(a.stats.intentCounts, { informational: 29, commercial: 26, transactional: 5, navigational: 4, unclassified: 13 });
  assert.equal(a.stats.withVolume, 72); // 5 sample rows deliberately lack volume
  assert.equal(a.duplicates.length, 3);
  assert.deepEqual(a.duplicates.map(d => d.kind), ['exact', 'near', 'near']);
  // the quoted keyword with a comma survived CSV parsing
  assert.ok(s.keywords.some(k => k.keyword === 'time tracking, invoicing and billing'));
});

test('sample data: every keyword is in exactly one cluster; missing inputs are never invented', () => {
  const s = sampleState();
  const a = analyse(s);
  const ids = a.clusters.flatMap(c => c.members.map(m => m.id));
  assert.equal(ids.length, s.keywords.length);
  assert.equal(new Set(ids).size, s.keywords.length);
  // "productivity" has no volume, difficulty, rank and no intent rule: only the gap factor (untapped = 0.6) is usable.
  const prod = a.scoreById.get('c:productivity');
  assert.equal(prod.factors.volume.value, null);
  assert.equal(prod.factors.difficulty.value, null);
  assert.equal(prod.factors.intent.value, null);
  assert.equal(prod.factors.rank.value, null);
  assert.equal(prod.score, 60);
  assert.equal(prod.coverage, 0.15);
  // "fernleaf mobile app download": navigational (0.2) + untapped (0.6) -> (20×0.2 + 15×0.6) / 35 = 37.1
  const mob = a.scoreById.get('c:fernleaf mobile app download');
  assert.equal(a.summaries.get('c:fernleaf mobile app download').intent, 'navigational');
  assert.equal(mob.score, 37.1);
  assert.deepEqual(a.gaps.unmatchedTopics.map(t => t.topic).sort(), ['four day work week', 'gps time tracking', 'project budgeting']);
});

test('merging duplicates removes rows and keeps volumes un-summed', () => {
  const s = sampleState();
  let a = analyse(s);
  for (const g of a.duplicates) s.keywords = mergeDuplicateGroup(s.keywords, g.ids).keywords;
  assert.equal(s.keywords.length, 73);
  a = analyse(s);
  assert.equal(a.duplicates.length, 0);
  const tts = s.keywords.find(k => k.keyword === 'time tracking software');
  assert.equal(tts.volume, 9900);
  assert.equal(tts.mergedFrom.length, 2);
});

test('exports: recommendations CSV/Markdown and processed keywords CSV', () => {
  const s = sampleState();
  const a = analyse(s);
  const rows = parseCSV(recommendationsCSV(a));
  assert.equal(rows.length, a.clusters.length + 1);
  assert.equal(rows[0][0], 'priority');
  assert.ok(rows.some(r => r.includes('missing input')));
  const scores = rows.slice(1).map(r => (r[4] === '' ? -1 : Number(r[4])));
  assert.deepEqual(scores, scores.slice().sort((x, y) => y - x), 'sorted by score');
  const md = recommendationsMarkdown(s, a, { limit: 5 });
  assert.match(md, /Illustrative sample/);
  assert.equal(md.split('\n').filter(l => /^\| \d/.test(l)).length, 5);
  const kw = parseCSV(keywordsCSV(s, a));
  assert.equal(kw.length, 78);
  assert.deepEqual(kw[0].slice(0, 3), ['keyword', 'normalised', 'volume']);
});

test('empty state analyses without errors', () => {
  const a = analyse(defaultState());
  assert.equal(a.clusters.length, 0);
  assert.equal(a.scores.length, 0);
  assert.equal(a.stats.keywords, 0);
});
