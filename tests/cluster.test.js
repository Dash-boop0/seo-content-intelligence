import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coreTokens, jaccard, clusterKeywords, explainMember, headTerms, clusterOrder } from '../src/lib/cluster.js';

test('core tokens drop stopwords and intent modifiers, fold plurals, but never go empty', () => {
  assert.deepEqual(coreTokens('Best CRM Apps for Agencies'), ['agency', 'app', 'crm']);
  assert.deepEqual(coreTokens('how to'), ['how', 'to']);
  assert.deepEqual(coreTokens('CRM apps', { fold: false }), ['apps', 'crm']);
  assert.deepEqual(coreTokens(''), []);
});
test('Jaccard similarity known values', () => {
  assert.equal(jaccard(['a', 'b'], ['a', 'b']), 1);
  assert.equal(jaccard(['a', 'b'], ['b', 'c']), 1 / 3);
  assert.equal(jaccard(['a', 'b', 'c'], ['a', 'b', 'd']), 0.5);
  assert.equal(jaccard([], []), 0);
  assert.equal(jaccard(['a'], []), 0);
});

const kws = [
  { id: 'a', keyword: 'crm software', volume: 1000 },
  { id: 'b', keyword: 'best crm software', volume: 500 },
  { id: 'c', keyword: 'crm app', volume: 300 },
  { id: 'd', keyword: 'free crm apps', volume: null },
  { id: 'e', keyword: 'email marketing', volume: 800 }
];
test('processing order is volume desc with missing volume last', () => {
  assert.deepEqual(clusterOrder(kws).map(k => k.id), ['a', 'e', 'b', 'c', 'd']);
});
test('clusters at threshold 0.6 (hand-computed)', () => {
  const cs = clusterKeywords(kws, { threshold: 0.6 });
  assert.deepEqual(cs.map(c => c.members.map(m => m.id)), [['a', 'b'], ['e'], ['c', 'd']]);
  assert.deepEqual(cs.map(c => c.id), ['c:crm software', 'c:email marketing', 'c:crm app']);
  assert.equal(cs[0].members[1].similarity, 1);
  assert.deepEqual(cs[2].members[1].shared, ['app', 'crm']);
  assert.match(explainMember(cs[2].members[1], cs[2]), /Jaccard 1\.00 \(100%\) with seed "crm app" — shared terms: app, crm/);
  assert.match(explainMember(cs[0].members[0], cs[0]), /^Seed/);
});
test('lower threshold merges more (crm app joins crm software at 1/3 ≥ 0.3)', () => {
  const cs = clusterKeywords(kws, { threshold: 0.3 });
  assert.deepEqual(cs.map(c => c.members.map(m => m.id)), [['a', 'b', 'c', 'd'], ['e']]);
  assert.ok(Math.abs(cs[0].members[2].similarity - 1 / 3) < 1e-12);
});
test('deterministic: input order does not change clusters', () => {
  const a = clusterKeywords(kws, { threshold: 0.6 });
  const b = clusterKeywords(kws.slice().reverse(), { threshold: 0.6 });
  assert.deepEqual(a.map(c => c.members.map(m => m.id)), b.map(c => c.members.map(m => m.id)));
});
test('head terms are tokens in at least half the members', () => {
  assert.deepEqual(headTerms([{ tokens: ['crm', 'software'] }, { tokens: ['crm', 'app'] }, { tokens: ['crm'] }]), ['crm']);
});
test('invalid threshold throws; empty input gives no clusters', () => {
  assert.throws(() => clusterKeywords(kws, { threshold: 0 }), RangeError);
  assert.throws(() => clusterKeywords(kws, { threshold: 1.5 }), RangeError);
  assert.deepEqual(clusterKeywords([], { threshold: 0.5 }), []);
});
