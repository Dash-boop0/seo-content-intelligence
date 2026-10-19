// Keyword normalisation, simple plural folding, tokenisation and duplicate detection.
// Pure functions, no DOM access.

/**
 * Normalise a keyword: lowercase, strip diacritics, drop apostrophes,
 * turn every other punctuation/symbol into a space, collapse whitespace, trim.
 *   "  Time-Tracking   Software! " -> "time tracking software"
 *   "Don’t miss: CAFÉ apps"        -> "dont miss cafe apps"
 */
export function normalizeKeyword(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Words ending in "s" that must not be folded.
const NO_FOLD = new Set([
  'news', 'series', 'species', 'canvas', 'atlas', 'bias', 'alias', 'lens', 'analytics', 'physics',
  'mathematics', 'economics', 'ethics', 'logistics', 'statistics', 'sales', 'windows', 'kudos',
  'chaos', 'thanks', 'ios', 'macos', 'always', 'perhaps', 'whereas', 'towards', 'afterwards',
  'its', 'his', 'hers', 'ours', 'yours', 'theirs', 'does', 'was', 'has', 'is', 'this', 'gps', 'saas', 'paas'
]);

/**
 * Simple English plural folding for a single token (deliberately conservative):
 *   agencies -> agency, classes -> class, matches -> match, boxes -> box,
 *   templates -> template, hours -> hour. Leaves "business", "status", "analysis",
 *   short tokens (<= 3 chars) and a small exception list untouched.
 */
export function foldPlural(token) {
  const t = String(token);
  if (t.length <= 3 || NO_FOLD.has(t) || /\d/.test(t)) return t;
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y';
  if (t.endsWith('sses')) return t.slice(0, -2);
  if (/(?:x|ch|sh)es$/.test(t)) return t.slice(0, -2);
  if (t.endsWith('ss') || t.endsWith('us') || t.endsWith('is') || t.endsWith('os')) return t;
  if (t.endsWith('s')) return t.slice(0, -1);
  return t;
}

/** Tokens of the normalised keyword; optionally plural-folded. */
export function tokenize(input, { fold = true } = {}) {
  const norm = normalizeKeyword(input);
  if (!norm) return [];
  const toks = norm.split(' ');
  return fold ? toks.map(foldPlural) : toks;
}

/** Order-insensitive token-set key used for near-duplicate detection. */
export function tokenSetKey(input, { fold = true } = {}) {
  return [...new Set(tokenize(input, { fold }))].sort().join(' ');
}

/**
 * Find duplicate groups among keyword records ({ id, keyword, ... }).
 * - "exact": identical normalised form (case/whitespace/punctuation differences only).
 * - "near":  different normalised forms but the same token set after optional
 *            plural folding (word order and simple plurals differ).
 * Each keyword appears in at most one group. Groups whose key is listed in
 * `dismissed` are skipped (the user marked them "not duplicates").
 * Returns groups sorted by first appearance: [{ key, kind, ids, reason }].
 */
export function findDuplicates(keywords, { fold = true, dismissed = [] } = {}) {
  const dismissedSet = new Set(dismissed);
  const byNorm = new Map(); // norm -> ids (in input order)
  const order = [];
  for (const k of keywords) {
    const norm = normalizeKeyword(k.keyword);
    if (!norm) continue;
    if (!byNorm.has(norm)) { byNorm.set(norm, []); order.push(norm); }
    byNorm.get(norm).push(k.id);
  }
  const bySet = new Map(); // tokenSetKey -> norms
  for (const norm of order) {
    const key = tokenSetKey(norm, { fold });
    if (!bySet.has(key)) bySet.set(key, []);
    bySet.get(key).push(norm);
  }
  const groups = [];
  const done = new Set();
  for (const norm of order) {
    if (done.has(norm)) continue;
    const setKey = tokenSetKey(norm, { fold });
    const norms = bySet.get(setKey);
    if (norms.length > 1) {
      norms.forEach(x => done.add(x));
      const key = 'near:' + setKey;
      if (dismissedSet.has(key)) continue;
      groups.push({
        key, kind: 'near',
        ids: norms.flatMap(x => byNorm.get(x)),
        reason: `Same words after ${fold ? 'plural folding and ' : ''}ignoring word order: {${setKey.split(' ').join(', ')}}`
      });
    } else {
      done.add(norm);
      const ids = byNorm.get(norm);
      if (ids.length > 1) {
        const key = 'exact:' + norm;
        if (dismissedSet.has(key)) continue;
        groups.push({ key, kind: 'exact', ids: [...ids], reason: `Same normalised form: "${norm}"` });
      }
    }
  }
  return groups;
}

const MERGE_FIELDS = ['volume', 'difficulty', 'cpc', 'rank', 'url'];

/**
 * Merge a duplicate group. The canonical record is the one with the highest
 * known volume (ties / all-missing -> earliest in the list). Its values win;
 * any field it is missing is filled from the first other record that has it.
 * Volumes are never summed (duplicates usually report the same query twice).
 * Returns { keywords: newList, canonicalId, removedIds }.
 */
export function mergeDuplicateGroup(keywords, ids) {
  const idSet = new Set(ids);
  const members = keywords.filter(k => idSet.has(k.id));
  if (members.length < 2) return { keywords: keywords.slice(), canonicalId: members[0]?.id ?? null, removedIds: [] };
  let canonical = members[0];
  for (const m of members) {
    const mv = m.volume ?? -1, cv = canonical.volume ?? -1;
    if (mv > cv) canonical = m;
  }
  const merged = { ...canonical, mergedFrom: [...(canonical.mergedFrom || [])] };
  for (const f of MERGE_FIELDS) {
    if (merged[f] === null || merged[f] === undefined || merged[f] === '') {
      const donor = members.find(m => m !== canonical && m[f] !== null && m[f] !== undefined && m[f] !== '');
      merged[f] = donor ? donor[f] : (f === 'url' ? '' : null);
    }
  }
  if (!merged.intentOverride) {
    const donor = members.find(m => m !== canonical && m.intentOverride);
    if (donor) merged.intentOverride = donor.intentOverride;
  }
  for (const m of members) {
    if (m === canonical) continue;
    merged.mergedFrom.push({ keyword: m.keyword, volume: m.volume ?? null, difficulty: m.difficulty ?? null });
    for (const mf of (m.mergedFrom || [])) merged.mergedFrom.push(mf);
  }
  const removedIds = members.filter(m => m !== canonical).map(m => m.id);
  const removed = new Set(removedIds);
  const out = [];
  for (const k of keywords) {
    if (removed.has(k.id)) continue;
    out.push(k.id === canonical.id ? merged : k);
  }
  return { keywords: out, canonicalId: canonical.id, removedIds };
}
