// End-to-end analysis: intents -> duplicates -> clusters -> gaps -> scores,
// plus processed-data exports. Pure functions (no DOM).

import { normalizeKeyword, findDuplicates } from './normalize.js';
import { resolveIntent, INTENT_LABELS } from './intent.js';
import { clusterKeywords } from './cluster.js';
import { analyseGaps, GAP_STATUS } from './gap.js';
import { scoreAll, FACTORS, FACTOR_LABELS } from './score.js';
import { toCSV } from './csv.js';

/** Tie-break order when a cluster's member intents are tied. */
export const INTENT_TIE_ORDER = ['transactional', 'commercial', 'informational', 'navigational'];

/** Majority intent of a cluster, ignoring unclassified members. */
export function clusterIntent(intents) {
  const counts = {};
  for (const i of intents) if (i && i !== 'unclassified') counts[i] = (counts[i] || 0) + 1;
  let best = 'unclassified', bestN = 0;
  for (const i of INTENT_TIE_ORDER) if ((counts[i] || 0) > bestN) { best = i; bestN = counts[i]; }
  return best;
}

/** Aggregate a cluster's inputs. Missing values are counted, never filled in. */
export function summarizeCluster(cluster, keywordsById, intentById) {
  const recs = cluster.members.map(m => keywordsById.get(m.id)).filter(Boolean);
  const vols = recs.map(r => r.volume).filter(v => v !== null && v !== undefined);
  const kds = recs.map(r => r.difficulty).filter(v => v !== null && v !== undefined);
  const ranks = recs.map(r => r.rank).filter(v => v !== null && v !== undefined);
  const intentCounts = {};
  for (const r of recs) { const i = intentById.get(r.id)?.intent || 'unclassified'; intentCounts[i] = (intentCounts[i] || 0) + 1; }
  return {
    id: cluster.id,
    seed: cluster.seed,
    size: recs.length,
    totalVolume: vols.length ? vols.reduce((a, b) => a + b, 0) : null,
    volumeKnown: vols.length,
    avgDifficulty: kds.length ? Math.round((kds.reduce((a, b) => a + b, 0) / kds.length) * 10) / 10 : null,
    difficultyKnown: kds.length,
    bestRank: ranks.length ? Math.min(...ranks) : null,
    rankKnown: ranks.length,
    intent: clusterIntent(recs.map(r => intentById.get(r.id)?.intent)),
    intentCounts
  };
}

/** Run the whole analysis for a state object. */
export function analyse(state) {
  const fold = state.settings.foldPlurals !== false;
  const threshold = state.settings.clusterThreshold;
  const keywordsById = new Map(state.keywords.map(k => [k.id, k]));
  const intents = new Map();
  const ruleHits = new Map();
  const intentCounts = { informational: 0, commercial: 0, transactional: 0, navigational: 0, unclassified: 0 };
  for (const k of state.keywords) {
    const r = resolveIntent(k, state.rules);
    intents.set(k.id, r);
    intentCounts[r.intent] = (intentCounts[r.intent] || 0) + 1;
    if (r.ruleId) ruleHits.set(r.ruleId, (ruleHits.get(r.ruleId) || 0) + 1);
  }
  const duplicates = findDuplicates(state.keywords, { fold, dismissed: state.dismissedDuplicates });
  const clusters = clusterKeywords(state.keywords, { threshold, fold });
  const clusterOfKeyword = new Map();
  for (const c of clusters) for (const m of c.members) clusterOfKeyword.set(m.id, c);
  const gaps = analyseGaps(clusters, keywordsById, state.competitors, state.ourPages, { threshold, fold });
  const summaries = new Map();
  for (const c of clusters) {
    const s = summarizeCluster(c, keywordsById, intents);
    s.gapStatus = gaps.byCluster.get(c.id).status;
    summaries.set(c.id, s);
  }
  const scores = scoreAll([...summaries.values()], { weights: state.settings.weights, intentValues: state.settings.intentValues });
  const scoreById = new Map(scores.map((s, i) => [s.id, { ...s, position: i + 1 }]));
  const stats = {
    keywords: state.keywords.length,
    withVolume: state.keywords.filter(k => k.volume !== null && k.volume !== undefined).length,
    withDifficulty: state.keywords.filter(k => k.difficulty !== null && k.difficulty !== undefined).length,
    intentCounts
  };
  return { fold, threshold, keywordsById, intents, ruleHits, duplicates, clusters, clusterOfKeyword, gaps, summaries, scores, scoreById, stats };
}

/** Suggested next action for a cluster, derived only from its gap status and rank. */
export function recommendedAction(summary, gapInfo) {
  const haveSomething = gapInfo.ourPages.length > 0 || gapInfo.rankingUrls.length > 0;
  switch (summary.gapStatus) {
    case 'gap': return 'Create new content (competitors cover this; we have no page)';
    case 'untapped': return 'Create new content (no one in the imported data covers this)';
    case 'ours': return 'Maintain or refresh the existing page';
    case 'contested': return summary.bestRank !== null && summary.bestRank <= 3 ? 'Defend: keep the existing page current' : 'Improve the existing page to compete';
    default: return haveSomething ? 'Improve the existing page' : 'Create new content';
  }
}

/** Names of missing inputs for a scored cluster. */
export function missingInputs(score) {
  return FACTORS.filter(f => score.factors[f].value === null && score.factors[f].weight > 0).map(f => FACTOR_LABELS[f]);
}

/** Processed keyword table as CSV. */
export function keywordsCSV(state, a) {
  const rows = [['keyword', 'normalised', 'volume', 'difficulty', 'cpc', 'current_rank', 'ranking_url', 'intent', 'intent_source', 'matched_rule', 'cluster', 'merged_from']];
  for (const k of state.keywords) {
    const r = a.intents.get(k.id);
    const ruleIdx = r.ruleIndex >= 0 ? `#${r.ruleIndex + 1} (${r.term})` : '';
    rows.push([k.keyword, normalizeKeyword(k.keyword), k.volume, k.difficulty, k.cpc, k.rank, k.url,
      r.intent, r.source, ruleIdx, a.clusterOfKeyword.get(k.id)?.seed || '', (k.mergedFrom || []).map(m => m.keyword).join('; ')]);
  }
  return toCSV(rows);
}

/** Prioritised recommendations as CSV. Missing values are left blank and listed. */
export function recommendationsCSV(a) {
  const rows = [['priority', 'cluster', 'keywords', 'intent', 'score', 'input_coverage_pct', 'total_known_volume', 'keywords_missing_volume',
    'avg_difficulty', 'keywords_missing_difficulty', 'best_rank', 'gap_status', 'competitor_domains', 'our_pages', 'missing_inputs', 'recommended_action',
    ...FACTORS.map(f => `factor_${f}`)]];
  a.scores.forEach((s, i) => {
    const sum = a.summaries.get(s.id);
    const g = a.gaps.byCluster.get(s.id);
    rows.push([i + 1, sum.seed, sum.size, sum.intent, s.score, Math.round(s.coverage * 100), sum.totalVolume, sum.size - sum.volumeKnown,
      sum.avgDifficulty, sum.size - sum.difficultyKnown, sum.bestRank, GAP_STATUS[sum.gapStatus].short, (g.competitorDomains || []).join('; '),
      g.ourPages.map(p => p.url).join('; '), missingInputs(s).join('; '), recommendedAction(sum, g),
      ...FACTORS.map(f => s.factors[f].value === null ? 'missing input' : Math.round(s.factors[f].value * 1000) / 1000)]);
  });
  return toCSV(rows);
}

function mdCell(v) {
  return String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Prioritised recommendations as a Markdown report. */
export function recommendationsMarkdown(state, a, { limit = 25 } = {}) {
  const w = state.settings.weights;
  const out = ['# Prioritised content recommendations', ''];
  if (state.isSample) out.push('> **Illustrative sample.** Generated from synthetic keyword data for a fictional site. Volumes, difficulty, CPC and ranks are not real search data.', '');
  out.push(`Keywords: ${a.stats.keywords} · Clusters: ${a.clusters.length} · Similarity threshold: ${a.threshold} · Plural folding: ${a.fold ? 'on' : 'off'}`, '');
  out.push(`Weights: ${FACTORS.map(f => `${FACTOR_LABELS[f]} ${w[f]}`).join(', ')}.`, '');
  out.push('Score = 100 × Σ(weight × factor) ÷ Σ(weights of factors with data). Factors without data are excluded and listed as missing inputs.', '');
  out.push('| # | Cluster | Intent | Score | Input coverage | Known volume | Avg difficulty | Gap status | Missing inputs | Action |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  a.scores.slice(0, limit).forEach((s, i) => {
    const sum = a.summaries.get(s.id);
    const g = a.gaps.byCluster.get(s.id);
    const vol = sum.totalVolume === null ? 'missing input' : `${sum.totalVolume}${sum.volumeKnown < sum.size ? ` (${sum.size - sum.volumeKnown} of ${sum.size} missing)` : ''}`;
    out.push(`| ${i + 1} | ${mdCell(sum.seed)} | ${INTENT_LABELS[sum.intent]} | ${s.score ?? 'n/a'} | ${Math.round(s.coverage * 100)}% | ${vol} | ${sum.avgDifficulty ?? 'missing input'} | ${GAP_STATUS[sum.gapStatus].short} | ${mdCell(missingInputs(s).join(', ') || '—')} | ${mdCell(recommendedAction(sum, g))} |`);
  });
  out.push('');
  return out.join('\n');
}
