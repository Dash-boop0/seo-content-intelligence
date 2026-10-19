import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAll, scoreSummary, volumeFactor, difficultyFactor, rankFactor, validateWeights, validateIntentValues, DEFAULT_WEIGHTS, DEFAULT_INTENT_VALUES } from '../src/lib/score.js';

test('factor functions (known values)', () => {
  assert.equal(volumeFactor(10000, 10000), 1);
  assert.ok(Math.abs(volumeFactor(1000, 10000) - Math.log10(1001) / Math.log10(10001)) < 1e-15);
  assert.ok(Math.abs(volumeFactor(1000, 10000) - 0.75010) < 1e-5);
  assert.equal(volumeFactor(0, 0), 0, 'divide-by-zero guarded');
  assert.equal(volumeFactor(null, 100), null);
  assert.equal(difficultyFactor(40), 0.6);
  assert.equal(difficultyFactor(null), null);
  assert.deepEqual([1, 3, 4, 10, 11, 20, 21, 50, 51, 100].map(rankFactor), [0.1, 0.1, 1, 1, 0.8, 0.8, 0.5, 0.5, 0.3, 0.3]);
  assert.equal(rankFactor(null), null);
});

// Worked example from docs/SCORING.md
const A = { id: 'A', totalVolume: 1000, avgDifficulty: 40, intent: 'commercial', bestRank: null, gapStatus: 'gap' };
const B = { id: 'B', totalVolume: 10000, avgDifficulty: null, intent: 'informational', bestRank: 8, gapStatus: 'contested' };
const C = { id: 'C', totalVolume: null, avgDifficulty: null, intent: 'unclassified', bestRank: null, gapStatus: 'missing' };

test('worked example: missing factors are excluded and weights re-normalised', () => {
  const [a, b, c] = scoreAll([B, C, A]);
  assert.equal(a.id, 'A');
  // (30×0.75010 + 25×0.6 + 20×0.8 + 15×1) / 90 × 100 = 76.1
  assert.equal(a.score, 76.1);
  assert.equal(a.coverage, 0.9);
  assert.equal(a.factors.rank.value, null);
  assert.equal(a.factors.rank.contribution, null);
  // (30×1 + 20×0.5 + 15×0.4 + 10×1) / 75 × 100 = 74.7
  assert.equal(b.id, 'B');
  assert.equal(b.score, 74.7);
  assert.equal(b.coverage, 0.75);
  // contributions add up to the score
  const sum = Object.values(b.factors).reduce((t, f) => t + (f.contribution || 0), 0);
  assert.ok(Math.abs(sum - 74.6667) < 1e-3);
  // no usable inputs -> n/a, not 0
  assert.equal(c.id, 'C');
  assert.equal(c.score, null);
  assert.equal(c.coverage, 0);
});
test('zero weight removes a factor; changing weights changes ranking', () => {
  const r = scoreSummary(A, { maxVolume: 10000, weights: { ...DEFAULT_WEIGHTS, gap: 0 } });
  // (22.503 + 15 + 16) / 75 = 71.3
  assert.equal(r.score, 71.3);
  const onlyVolume = scoreAll([A, B], { weights: { volume: 1, difficulty: 0, intent: 0, gap: 0, rank: 0 } });
  assert.deepEqual(onlyVolume.map(s => s.id), ['B', 'A']);
  assert.equal(onlyVolume[0].score, 100);
});
test('custom intent values are used', () => {
  const r = scoreSummary({ ...C, intent: 'transactional' }, { intentValues: { ...DEFAULT_INTENT_VALUES, transactional: 0.25 } });
  assert.equal(r.score, 25);
  assert.equal(r.coverage, 0.2);
});
test('weight and intent-value validation', () => {
  assert.deepEqual(validateWeights(DEFAULT_WEIGHTS), []);
  assert.match(validateWeights({ volume: 0, difficulty: 0, intent: 0, gap: 0, rank: 0 })[0], /At least one/);
  assert.equal(validateWeights({ ...DEFAULT_WEIGHTS, rank: -1 }).length, 1);
  assert.equal(validateWeights({ ...DEFAULT_WEIGHTS, rank: NaN }).length, 1);
  assert.deepEqual(validateIntentValues(DEFAULT_INTENT_VALUES), []);
  assert.equal(validateIntentValues({ ...DEFAULT_INTENT_VALUES, navigational: 1.5 }).length, 1);
});
