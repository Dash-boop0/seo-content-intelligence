import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, validateState, makeBackup } from '../src/lib/state.js';

test('backup round trip is accepted', () => {
  const s = defaultState();
  s.keywords.push({ id: 'k7', keyword: 'crm', volume: 10, difficulty: null, cpc: null, rank: null, url: '', intentOverride: 'commercial', mergedFrom: [] });
  s.briefs['c:crm'] = { workingTitle: 'CRM' };
  const v = validateState(JSON.parse(JSON.stringify(makeBackup(s, '2026-01-01T00:00:00Z'))));
  assert.equal(v.ok, true);
  assert.equal(v.state.keywords[0].intentOverride, 'commercial');
  assert.equal(v.state.nextId, 8, 'nextId moves past the highest id');
  assert.equal(v.state.briefs['c:crm'].workingTitle, 'CRM');
});
test('rejects wrong app, non-objects and bad values with clear errors', () => {
  assert.match(validateState({ app: 'other-app', state: {} }).errors[0], /not seo-content-intelligence/);
  assert.equal(validateState(null).ok, false);
  assert.equal(validateState([]).ok, false);
  const bad = validateState({ keywords: [{ id: 'k1', keyword: 'x', difficulty: 150 }, { id: 'k1', keyword: 'y' }, { keyword: '' }] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => /outside 0–100/.test(e)));
  assert.ok(bad.errors.some(e => /duplicate id/.test(e)));
  assert.ok(bad.errors.some(e => /no text/.test(e)));
  assert.equal(validateState({ keywords: [], settings: { clusterThreshold: 2 } }).ok, false);
  assert.equal(validateState({ keywords: [], rules: [{ intent: 'x', match: 'contains', terms: 'a' }] }).ok, false);
});
test('minimal object gets defaults', () => {
  const v = validateState({ keywords: [] });
  assert.equal(v.ok, true);
  assert.equal(v.state.settings.clusterThreshold, 0.6);
  assert.ok(v.state.rules.length > 0);
});
