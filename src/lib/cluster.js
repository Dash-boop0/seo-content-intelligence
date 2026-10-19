// Deterministic, explainable keyword clustering. Pure functions.
//
// Method (see docs/METHOD.md):
// 1. Each keyword is reduced to "core tokens": normalised, plural-folded tokens
//    minus stopwords and intent modifiers ("best", "how", "free", ...).
// 2. Keywords are processed in a fixed order: known volume descending (missing
//    volume last), then normalised keyword A→Z.
// 3. Each keyword is compared with the seed (first keyword) of every existing
//    cluster using Jaccard similarity |A∩B| / |A∪B|. It joins the most similar
//    cluster if similarity ≥ threshold (ties → the earlier cluster); otherwise
//    it seeds a new cluster.

import { normalizeKeyword, foldPlural } from './normalize.js';

export const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'your', 'my',
  'our', 'you', 'i', 'me', 'it', 'its', 'be', 'as', 'that', 'this', 'there', 'their', 'per', 'without', 'vs', 'versus'
]);

export const MODIFIERS = new Set([
  'best', 'top', 'free', 'cheap', 'cheapest', 'buy', 'online', 'new', 'review', 'reviews', 'compare', 'comparison',
  'alternative', 'alternatives', 'how', 'what', 'why', 'when', 'where', 'who', 'which', 'can', 'do', 'does', 'is',
  'are', 'should', 'will', 'would', 'use', 'guide', 'tips', 'example', 'examples', 'list', '10', '5', '2026', '2025'
]);

/** Core tokens of a keyword (a sorted, de-duplicated array). Never empty for a non-empty keyword. */
export function coreTokens(keyword, { fold = true } = {}) {
  const norm = normalizeKeyword(keyword);
  if (!norm) return [];
  const raw = norm.split(' ');
  const kept = raw.filter(t => !STOPWORDS.has(t) && !MODIFIERS.has(t));
  const base = kept.length ? kept : raw; // fall back so "how to" style keywords still have tokens
  return [...new Set(base.map(t => (fold ? foldPlural(t) : t)))].sort();
}

/** Jaccard similarity of two token arrays; 0 when both are empty. */
export function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Shared tokens of two token arrays (sorted). */
export function sharedTokens(a, b) {
  const B = new Set(b);
  return [...new Set(a)].filter(x => B.has(x)).sort();
}

/** Stable sort order for clustering: volume desc (null last), then normalised A→Z, then id. */
export function clusterOrder(keywords) {
  return keywords.slice().sort((x, y) => {
    const vx = x.volume ?? -1, vy = y.volume ?? -1;
    if (vx !== vy) return vy - vx;
    const nx = normalizeKeyword(x.keyword), ny = normalizeKeyword(y.keyword);
    if (nx !== ny) return nx < ny ? -1 : 1;
    return String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0;
  });
}

/**
 * Cluster keyword records. Returns
 * [{ id, seedId, seed, seedTokens, headTerms, members: [{ id, keyword, tokens, similarity, shared, isSeed }] }]
 * Cluster ids are "c:" + normalised seed keyword (stable while the seed stays the same).
 */
export function clusterKeywords(keywords, { threshold = 0.6, fold = true } = {}) {
  const t = Number(threshold);
  if (!(t > 0 && t <= 1)) throw new RangeError('Similarity threshold must be greater than 0 and at most 1.');
  const clusters = [];
  for (const k of clusterOrder(keywords)) {
    const tokens = coreTokens(k.keyword, { fold });
    if (!tokens.length) continue;
    let best = null, bestSim = -1;
    for (const c of clusters) {
      const sim = jaccard(tokens, c.seedTokens);
      if (sim > bestSim) { bestSim = sim; best = c; }
    }
    if (best && bestSim >= t - 1e-9) {
      best.members.push({ id: k.id, keyword: k.keyword, tokens, similarity: bestSim, shared: sharedTokens(tokens, best.seedTokens), isSeed: false });
    } else {
      clusters.push({
        id: 'c:' + normalizeKeyword(k.keyword),
        seedId: k.id,
        seed: k.keyword,
        seedTokens: tokens,
        members: [{ id: k.id, keyword: k.keyword, tokens, similarity: 1, shared: tokens.slice(), isSeed: true }]
      });
    }
  }
  for (const c of clusters) c.headTerms = headTerms(c.members);
  return clusters;
}

/**
 * Head terms: core tokens present in at least half of the members
 * (count desc, then A→Z); falls back to the seed's tokens.
 */
export function headTerms(members) {
  const counts = new Map();
  for (const m of members) for (const tok of new Set(m.tokens)) counts.set(tok, (counts.get(tok) || 0) + 1);
  const need = Math.ceil(members.length / 2);
  const list = [...counts.entries()].filter(([, n]) => n >= need)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([tok]) => tok);
  return list.length ? list : (members[0]?.tokens || []);
}

/** Human-readable explanation of why a member is in its cluster. */
export function explainMember(member, cluster) {
  if (member.isSeed) return 'Seed: highest-volume keyword not similar enough to an earlier cluster.';
  const pct = Math.round(member.similarity * 100);
  return `Jaccard ${member.similarity.toFixed(2)} (${pct}%) with seed "${cluster.seed}" — shared terms: ${member.shared.join(', ') || 'none'}.`;
}
