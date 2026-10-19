// Content-brief generation from a cluster, and Markdown export. Pure functions.

import { INTENT_LABELS, isQuestion } from './intent.js';
import { coreTokens, jaccard, sharedTokens } from './cluster.js';
import { normalizeKeyword, foldPlural } from './normalize.js';

const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'vs', 'per']);

/** Title Case with small words kept lowercase (except the first word). */
export function titleCase(s) {
  return String(s).trim().split(/\s+/).map((w, i) => {
    const lw = w.toLowerCase();
    if (i > 0 && SMALL.has(lw)) return lw;
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  }).join(' ');
}

/** Sentence case question with a trailing "?". */
export function asQuestion(s) {
  const t = String(s).trim().replace(/\?+$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1) + '?';
}

const AUDIENCE = {
  informational: h => `People learning about ${h} who want a clear, practical explanation before choosing a method or tool.`,
  commercial: h => `Buyers comparing ${h} options who need criteria, trade-offs and evidence to build a shortlist.`,
  transactional: h => `Visitors ready to act on ${h} — checking price, trial or sign-up details.`,
  navigational: h => `Existing users or prospects looking for a specific ${h} page.`,
  unclassified: (h, seed) => `Audience not yet defined: no intent rule matched this cluster. Describe who searches for "${seed}".`
};

function workingTitle(seed, intent) {
  const t = titleCase(seed);
  if (isQuestion(seed)) return asQuestion(t);
  switch (intent) {
    case 'informational': return `${t}: A Practical Guide`;
    case 'commercial': return `${t}: How to Compare Your Options`;
    case 'transactional': return `${t}: Plans, Pricing and How to Get Started`;
    default: return t;
  }
}

/**
 * Generate an editable brief for a cluster.
 * ctx: { keywordsById: Map, intent: string, ourPages: [{url,title,topic}], threshold, fold }
 * Returns plain-text fields so every part can be edited in a form.
 */
export function generateBrief(cluster, ctx) {
  const { keywordsById, intent = 'unclassified', ourPages = [], threshold = 0.6, fold = true } = ctx;
  const records = cluster.members.map(m => keywordsById.get(m.id)).filter(Boolean);
  const byVolume = records.slice().sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || normalizeKeyword(a.keyword).localeCompare(normalizeKeyword(b.keyword)));
  const seedRec = keywordsById.get(cluster.seedId) || { keyword: cluster.seed };
  // Head terms in the seed's own word order ("time blocking", not "blocking time").
  const headSet = new Set(cluster.headTerms && cluster.headTerms.length ? cluster.headTerms : cluster.seedTokens);
  const seedWords = normalizeKeyword(seedRec.keyword).split(' ');
  const inOrder = seedWords.filter(w => headSet.has(fold ? foldPlural(w) : w));
  const head = (inOrder.length ? inOrder : [...headSet]).join(' ');
  const secondary = byVolume.filter(r => r.id !== cluster.seedId);
  const questions = byVolume.filter(r => isQuestion(r.keyword)).map(r => asQuestion(r.keyword));
  const nonQuestionSecondary = secondary.filter(r => !isQuestion(r.keyword)).slice(0, 6);

  const outline = [`## ${titleCase(seedRec.keyword)}: Overview`];
  for (const r of nonQuestionSecondary) outline.push(`## ${titleCase(r.keyword)}`);
  if (intent === 'commercial') outline.push('## How to Choose: Criteria to Compare');
  if (intent === 'transactional') outline.push('## Pricing and Next Steps');
  if (questions.length) {
    outline.push('## Frequently Asked Questions');
    for (const q of questions) outline.push(`### ${q}`);
  }
  outline.push('## Summary and Next Steps');

  // Internal links: our pages sharing core terms with the cluster.
  const clusterTokens = [...new Set(cluster.members.flatMap(m => m.tokens))];
  const links = [];
  for (const p of ourPages) {
    const toks = coreTokens(`${p.topic || ''} ${p.title || ''}`, { fold });
    const shared = sharedTokens(toks, clusterTokens);
    if (!shared.length) continue;
    const pageTopicTokens = coreTokens(p.topic || p.title || '', { fold });
    const target = cluster.members.some(m => jaccard(pageTopicTokens, m.tokens) >= threshold - 1e-9);
    links.push({ url: p.url, title: p.title || p.url, shared, target });
  }
  links.sort((a, b) => b.shared.length - a.shared.length || a.url.localeCompare(b.url));
  const linkLines = links.slice(0, 8).map(l =>
    `${l.url} — ${l.title} (shared terms: ${l.shared.join(', ')})${l.target ? ' [may already target this topic: consider updating it instead]' : ''}`);

  const volMissing = records.filter(r => r.volume === null || r.volume === undefined).length;
  const kdMissing = records.filter(r => r.difficulty === null || r.difficulty === undefined).length;
  const dataNotes = [];
  if (volMissing) dataNotes.push(`Search volume missing for ${volMissing} of ${records.length} keywords (not estimated).`);
  if (kdMissing) dataNotes.push(`Keyword difficulty missing for ${kdMissing} of ${records.length} keywords (not estimated).`);
  if (!ourPages.length) dataNotes.push('No "our pages" data imported, so internal-link opportunities could not be checked.');

  return {
    clusterId: cluster.id,
    primaryKeyword: seedRec.keyword,
    intent,
    workingTitle: workingTitle(seedRec.keyword, intent),
    audience: (AUDIENCE[intent] || AUDIENCE.unclassified)(head, seedRec.keyword),
    secondaryKeywords: secondary.map(r => r.keyword).join('\n'),
    outline: outline.join('\n'),
    questions: questions.length ? questions.join('\n') : '',
    internalLinks: linkLines.join('\n'),
    dataNotes: dataNotes.join('\n'),
    notes: ''
  };
}

function lines(text) {
  return String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

/** Render a brief as Markdown. Outline headings become a nested list so they don't clash with the document's own headings. */
export function briefToMarkdown(brief) {
  const out = [];
  out.push(`# ${brief.workingTitle || brief.primaryKeyword || 'Untitled brief'}`, '');
  out.push(`- **Primary keyword:** ${brief.primaryKeyword || '—'}`);
  out.push(`- **Search intent:** ${INTENT_LABELS[brief.intent] || brief.intent || '—'}`, '');
  out.push('## Audience', '', brief.audience?.trim() || '_Not specified._', '');
  const sec = lines(brief.secondaryKeywords);
  out.push('## Secondary keywords', '', ...(sec.length ? sec.map(s => `- ${s}`) : ['_None._']), '');
  out.push('## Outline', '');
  const ol = lines(brief.outline);
  if (!ol.length) out.push('_No outline yet._');
  for (const l of ol) {
    if (l.startsWith('### ')) out.push(`  - H3: ${l.slice(4)}`);
    else if (l.startsWith('## ')) out.push(`- H2: ${l.slice(3)}`);
    else out.push(`- ${l}`);
  }
  out.push('');
  const qs = lines(brief.questions);
  out.push('## Questions to answer', '', ...(qs.length ? qs.map(q => `- ${q}`) : ['_No question-form keywords in this cluster._']), '');
  const ls = lines(brief.internalLinks);
  out.push('## Internal-link opportunities', '', ...(ls.length ? ls.map(l => `- ${l}`) : ['_None found._']), '');
  const dn = lines(brief.dataNotes);
  if (dn.length) out.push('## Data notes', '', ...dn.map(d => `- ${d}`), '');
  if (brief.notes && brief.notes.trim()) out.push('## Notes', '', brief.notes.trim(), '');
  return out.join('\n');
}
