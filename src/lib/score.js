// Explainable, weighted prioritisation of clusters. Pure functions.
// Only available inputs are used: a factor whose input is missing is excluded
// from BOTH the numerator and the denominator (the remaining weights are
// re-normalised) and reported as "missing input". Values are never invented.
// See docs/SCORING.md for the formula and a worked example.

export const FACTORS = ['volume', 'difficulty', 'intent', 'gap', 'rank'];

export const FACTOR_LABELS = {
  volume: 'Search demand (volume)',
  difficulty: 'Ease (100 − difficulty)',
  intent: 'Intent value',
  gap: 'Competitor gap',
  rank: 'Rank opportunity'
};

export const DEFAULT_WEIGHTS = { volume: 30, difficulty: 25, intent: 20, gap: 15, rank: 10 };

export const DEFAULT_INTENT_VALUES = { transactional: 1, commercial: 0.8, informational: 0.5, navigational: 0.2 };

export const GAP_VALUES = { gap: 1, untapped: 0.6, contested: 0.4, ours: 0.1 };

/** Volume factor: log-scaled against the largest cluster volume in the dataset. */
export function volumeFactor(volume, maxVolume) {
  if (volume === null || volume === undefined) return null;
  if (!(maxVolume > 0)) return 0;
  return Math.log10(1 + volume) / Math.log10(1 + maxVolume);
}

/** Ease factor from average keyword difficulty (0–100). */
export function difficultyFactor(difficulty) {
  if (difficulty === null || difficulty === undefined) return null;
  return 1 - Math.min(100, Math.max(0, difficulty)) / 100;
}

/** Rank-opportunity factor from the best current rank in the cluster. */
export function rankFactor(rank) {
  if (rank === null || rank === undefined) return null;
  if (rank <= 3) return 0.1;   // already winning
  if (rank <= 10) return 1;    // page one, room to climb
  if (rank <= 20) return 0.8;  // striking distance
  if (rank <= 50) return 0.5;
  return 0.3;
}

/** Validate weights; returns list of problems (empty = ok). */
export function validateWeights(weights) {
  const problems = [];
  let total = 0;
  for (const f of FACTORS) {
    const w = weights[f];
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) problems.push(`Weight for ${FACTOR_LABELS[f]} must be a number ≥ 0.`);
    else total += w;
  }
  if (!problems.length && total === 0) problems.push('At least one weight must be greater than 0.');
  return problems;
}

/** Validate intent values (each 0–1). */
export function validateIntentValues(values) {
  return Object.keys(DEFAULT_INTENT_VALUES)
    .filter(k => typeof values[k] !== 'number' || !Number.isFinite(values[k]) || values[k] < 0 || values[k] > 1)
    .map(k => `Intent value for ${k} must be between 0 and 1.`);
}

/**
 * Score one cluster summary.
 * summary: { id, totalVolume|null, avgDifficulty|null, intent, bestRank|null, gapStatus }
 * Returns { id, score|null, coverage, factors: {f: {value|null, raw, weight, contribution|null}} }.
 */
export function scoreSummary(summary, { weights = DEFAULT_WEIGHTS, intentValues = DEFAULT_INTENT_VALUES, maxVolume = 0 } = {}) {
  const values = {
    volume: volumeFactor(summary.totalVolume, maxVolume),
    difficulty: difficultyFactor(summary.avgDifficulty),
    intent: (summary.intent && summary.intent in intentValues) ? intentValues[summary.intent] : null,
    gap: (summary.gapStatus && summary.gapStatus in GAP_VALUES) ? GAP_VALUES[summary.gapStatus] : null,
    rank: rankFactor(summary.bestRank)
  };
  const raw = {
    volume: summary.totalVolume, difficulty: summary.avgDifficulty, intent: summary.intent,
    gap: summary.gapStatus, rank: summary.bestRank
  };
  let totalWeight = 0, availWeight = 0, weighted = 0;
  for (const f of FACTORS) {
    const w = weights[f] || 0;
    totalWeight += w;
    if (values[f] !== null && w > 0) { availWeight += w; weighted += w * values[f]; }
  }
  const factors = {};
  for (const f of FACTORS) {
    const w = weights[f] || 0;
    factors[f] = {
      value: values[f], raw: raw[f], weight: w,
      contribution: values[f] !== null && availWeight > 0 && w > 0 ? (100 * w * values[f]) / availWeight : null
    };
  }
  return {
    id: summary.id,
    score: availWeight > 0 ? round1((100 * weighted) / availWeight) : null,
    coverage: totalWeight > 0 ? availWeight / totalWeight : 0,
    factors
  };
}

/** Score all summaries; returns results sorted by score desc (null last), then id. */
export function scoreAll(summaries, opts = {}) {
  const known = summaries.map(s => s.totalVolume).filter(v => v !== null && v !== undefined);
  const maxVolume = known.length ? Math.max(...known) : 0;
  return summaries.map(s => scoreSummary(s, { ...opts, maxVolume }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (a.id < b.id ? -1 : 1));
}

export function round1(x) {
  return Math.round((x + Number.EPSILON) * 10) / 10;
}
