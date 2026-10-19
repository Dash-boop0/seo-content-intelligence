import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterKeywords } from '../src/lib/cluster.js';
import { analyseGaps } from '../src/lib/gap.js';

const kws = [
  { id: 'a', keyword: 'crm software', volume: 1000, url: '' },
  { id: 'b', keyword: 'best crm software', volume: 500, url: '' },
  { id: 'c', keyword: 'crm app', volume: 300, url: '' },
  { id: 'd', keyword: 'free crm apps', volume: null, url: '' },
  { id: 'e', keyword: 'email marketing', volume: 800, url: '' }
];
const byId = new Map(kws.map(k => [k.id, k]));
const clusters = clusterKeywords(kws, { threshold: 0.6 });
const competitors = [
  { domain: 'x.example.com', url: 'https://x.example.com/crm', topic: 'CRM software' },
  { domain: 'y.example.com', url: 'https://y.example.com/apps', topic: 'crm apps' },
  { domain: 'x.example.com', url: 'https://x.example.com/f', topic: 'sales forecasting' }
];
const ourPages = [{ url: 'https://me.example.com/crm', title: 'CRM software', topic: 'crm software' }];

test('classifies gap, contested, untapped and unmatched topics', () => {
  const g = analyseGaps(clusters, byId, competitors, ourPages, { threshold: 0.6 });
  assert.equal(g.byCluster.get('c:crm software').status, 'contested');
  assert.equal(g.byCluster.get('c:crm app').status, 'gap');
  assert.deepEqual(g.byCluster.get('c:crm app').competitorDomains, ['y.example.com']);
  assert.equal(g.byCluster.get('c:email marketing').status, 'untapped');
  assert.deepEqual(g.unmatchedTopics.map(t => t.topic), ['sales forecasting']);
  assert.deepEqual(g.domains, [
    { domain: 'x.example.com', total: 2, gap: 0, contested: 1, unmatched: 1 },
    { domain: 'y.example.com', total: 1, gap: 1, contested: 0, unmatched: 0 }
  ]);
});
test('a ranking URL in keyword data counts as our coverage ("ours")', () => {
  const kws2 = kws.map(k => (k.id === 'e' ? { ...k, url: 'https://me.example.com/email' } : k));
  const g = analyseGaps(clusters, new Map(kws2.map(k => [k.id, k])), competitors, [], { threshold: 0.6 });
  assert.equal(g.byCluster.get('c:email marketing').status, 'ours');
  assert.equal(g.byCluster.get('c:crm software').status, 'gap', 'without our-pages data the CRM cluster is a gap');
});
test('without competitor data every status is "missing" (no guessing)', () => {
  const g = analyseGaps(clusters, byId, [], ourPages, { threshold: 0.6 });
  assert.equal(g.hasCompetitorData, false);
  for (const v of g.byCluster.values()) assert.equal(v.status, 'missing');
});
