// Competitor content-gap analysis. Pure functions.
// A competitor topic "covers" a cluster when its core tokens reach the
// similarity threshold (Jaccard) against any member keyword of that cluster.
// We "cover" a cluster when one of our pages' topic (or title if no topic)
// reaches the threshold against any member, or a member has a ranking URL.

import { coreTokens, jaccard, sharedTokens } from './cluster.js';

export const GAP_STATUS = {
  gap: { label: 'Gap — competitors cover, we don’t', short: 'Gap' },
  contested: { label: 'Contested — competitors and we both cover', short: 'Contested' },
  ours: { label: 'Ours only — we cover, competitors don’t', short: 'Ours only' },
  untapped: { label: 'Untapped — nobody in the data covers it', short: 'Untapped' },
  missing: { label: 'Missing input — no competitor data imported', short: 'Missing input' }
};

/** Best-matching cluster for a token list: { cluster, similarity, shared } or null. */
export function bestCluster(tokens, clusters, threshold) {
  let best = null;
  for (const c of clusters) {
    for (const m of c.members) {
      const sim = jaccard(tokens, m.tokens);
      if (sim >= threshold - 1e-9 && (!best || sim > best.similarity)) {
        best = { cluster: c, similarity: sim, shared: sharedTokens(tokens, m.tokens), viaKeyword: m.keyword };
      }
    }
  }
  return best;
}

function pageTokens(page, fold) {
  return coreTokens(page.topic || page.title || '', { fold });
}

/**
 * @param clusters   output of clusterKeywords
 * @param keywordsById Map id -> keyword record (for ranking URLs)
 * @param competitors [{ domain, url, topic }]
 * @param ourPages    [{ url, title, topic }]
 * Returns {
 *   hasCompetitorData, hasOurPages,
 *   byCluster: Map clusterId -> { status, competitors: [{domain,url,topic,similarity,shared}], ourPages: [{url,title,similarity,shared}], rankingUrls: [] },
 *   unmatchedTopics: [{ topic, domains: [], urls: [] }],
 *   domains: [{ domain, total, gap, contested, unmatched }]
 * }
 */
export function analyseGaps(clusters, keywordsById, competitors, ourPages, { threshold = 0.6, fold = true } = {}) {
  const hasCompetitorData = competitors.length > 0;
  const hasOurPages = ourPages.length > 0;
  const byCluster = new Map();
  for (const c of clusters) {
    const rankingUrls = [...new Set(c.members.map(m => keywordsById.get(m.id)?.url).filter(Boolean))];
    byCluster.set(c.id, { status: 'missing', competitors: [], ourPages: [], rankingUrls });
  }
  // Our pages
  for (const p of ourPages) {
    const toks = pageTokens(p, fold);
    if (!toks.length) continue;
    for (const c of clusters) {
      let best = 0, shared = [];
      for (const m of c.members) {
        const s = jaccard(toks, m.tokens);
        if (s > best) { best = s; shared = sharedTokens(toks, m.tokens); }
      }
      if (best >= threshold - 1e-9) byCluster.get(c.id).ourPages.push({ url: p.url, title: p.title, similarity: best, shared });
    }
  }
  // Competitor topics
  const unmatched = new Map();
  const domainStats = new Map();
  const topicCluster = [];
  for (const comp of competitors) {
    const toks = coreTokens(comp.topic, { fold });
    const match = toks.length ? bestCluster(toks, clusters, threshold) : null;
    topicCluster.push(match ? match.cluster.id : null);
    if (!domainStats.has(comp.domain)) domainStats.set(comp.domain, { domain: comp.domain, total: 0, gap: 0, contested: 0, unmatched: 0 });
    domainStats.get(comp.domain).total++;
    if (match) {
      byCluster.get(match.cluster.id).competitors.push({ domain: comp.domain, url: comp.url, topic: comp.topic, similarity: match.similarity, shared: match.shared });
    } else {
      const key = toks.join(' ') || comp.topic.toLowerCase();
      if (!unmatched.has(key)) unmatched.set(key, { topic: comp.topic, domains: [], urls: [] });
      const u = unmatched.get(key);
      if (!u.domains.includes(comp.domain)) u.domains.push(comp.domain);
      if (comp.url) u.urls.push(comp.url);
      domainStats.get(comp.domain).unmatched++;
    }
  }
  for (const info of byCluster.values()) {
    const weCover = info.ourPages.length > 0 || info.rankingUrls.length > 0;
    const theyCover = info.competitors.length > 0;
    if (!hasCompetitorData) info.status = 'missing';
    else if (theyCover && !weCover) info.status = 'gap';
    else if (theyCover && weCover) info.status = 'contested';
    else if (weCover) info.status = 'ours';
    else info.status = 'untapped';
    info.competitorDomains = [...new Set(info.competitors.map(x => x.domain))].sort();
  }
  competitors.forEach((comp, i) => {
    const cid = topicCluster[i];
    if (!cid) return;
    const st = byCluster.get(cid).status;
    if (st === 'gap') domainStats.get(comp.domain).gap++;
    else domainStats.get(comp.domain).contested++;
  });
  return {
    hasCompetitorData,
    hasOurPages,
    byCluster,
    unmatchedTopics: [...unmatched.values()].sort((a, b) => b.domains.length - a.domains.length || a.topic.localeCompare(b.topic)),
    domains: [...domainStats.values()].sort((a, b) => a.domain.localeCompare(b.domain))
  };
}
