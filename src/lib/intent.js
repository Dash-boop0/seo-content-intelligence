// Transparent, ordered, editable search-intent rules. Pure functions.
// The first enabled rule that matches the normalised keyword decides the intent.

import { normalizeKeyword } from './normalize.js';

export const INTENTS = ['informational', 'commercial', 'transactional', 'navigational'];
export const INTENT_LABELS = {
  informational: 'Informational',
  commercial: 'Commercial investigation',
  transactional: 'Transactional',
  navigational: 'Navigational',
  unclassified: 'Unclassified'
};
export const MATCH_TYPES = {
  contains: 'Contains word/phrase',
  starts: 'Starts with',
  ends: 'Ends with',
  regex: 'Regular expression'
};

export const QUESTION_WORDS = ['how', 'what', 'why', 'when', 'where', 'who', 'which', 'whose', 'can', 'could', 'does', 'do', 'is', 'are', 'should', 'will', 'would', 'did'];

/** Default rules for the illustrative sample site. Order matters. */
export const DEFAULT_RULES = [
  { id: 'r1', enabled: true, intent: 'navigational', match: 'contains', terms: 'login, log in, sign in, sign up, my account, customer support, contact', note: 'Users trying to reach a specific page or account area.' },
  { id: 'r2', enabled: true, intent: 'transactional', match: 'contains', terms: 'buy, pricing, price, prices, cost, discount, coupon, deal, free trial, trial, demo, subscribe, purchase, order, quote, hire', note: 'Ready to act: price, trial, purchase.' },
  { id: 'r3', enabled: true, intent: 'commercial', match: 'contains', terms: 'best, top, vs, versus, alternative, alternatives, compare, comparison, review, reviews, rated, recommended', note: 'Comparing options before choosing.' },
  { id: 'r4', enabled: true, intent: 'informational', match: 'starts', terms: QUESTION_WORDS.join(', '), note: 'Question-form keywords.' },
  { id: 'r5', enabled: true, intent: 'informational', match: 'contains', terms: 'guide, tutorial, tips, examples, example, template, templates, ideas, definition, meaning, formula, calculator, checklist, printable, technique, explained', note: 'Learning or free-resource modifiers.' },
  { id: 'r6', enabled: true, intent: 'navigational', match: 'contains', terms: 'fernleaf', note: 'Brand term of the fictional sample site (placed after the transactional/commercial rules so "fernleaf pricing" is transactional).' },
  { id: 'r7', enabled: true, intent: 'commercial', match: 'contains', terms: 'software, app, apps, tool, tools, platform, tracker, system', note: 'Product-category head terms usually signal solution research (heuristic).' }
];

/** Split a comma-separated term list into normalised, non-empty terms. */
export function parseTerms(terms) {
  return String(terms ?? '').split(',').map(t => normalizeKeyword(t)).filter(Boolean);
}

/** Validate a rule. Returns a list of human-readable problems (empty = valid). */
export function validateRule(rule) {
  const problems = [];
  if (!INTENTS.includes(rule.intent)) problems.push(`Unknown intent "${rule.intent}".`);
  if (!MATCH_TYPES[rule.match]) problems.push(`Unknown match type "${rule.match}".`);
  if (rule.match === 'regex') {
    if (!String(rule.terms ?? '').trim()) problems.push('Regular expression is empty.');
    else { try { new RegExp(rule.terms, 'i'); } catch (e) { problems.push(`Invalid regular expression: ${e.message}`); } }
  } else if (parseTerms(rule.terms).length === 0) {
    problems.push('Add at least one term (comma-separated).');
  }
  return problems;
}

/**
 * Test a rule against an already-normalised keyword.
 * Returns the matched term (string) or null.
 */
export function matchRule(rule, norm) {
  if (!rule.enabled || validateRule(rule).length) return null;
  if (rule.match === 'regex') {
    const m = norm.match(new RegExp(rule.terms, 'i'));
    return m ? m[0] : null;
  }
  const padded = ' ' + norm + ' ';
  for (const term of parseTerms(rule.terms)) {
    if (rule.match === 'contains' && padded.includes(' ' + term + ' ')) return term;
    if (rule.match === 'starts' && (norm === term || norm.startsWith(term + ' '))) return term;
    if (rule.match === 'ends' && (norm === term || norm.endsWith(' ' + term))) return term;
  }
  return null;
}

/**
 * Classify a keyword with ordered rules.
 * Returns { intent, ruleId, ruleIndex (0-based), term } — intent "unclassified"
 * and ruleId null when no enabled rule matches.
 */
export function classify(keyword, rules) {
  const norm = normalizeKeyword(keyword);
  for (let i = 0; i < rules.length; i++) {
    const term = matchRule(rules[i], norm);
    if (term !== null) return { intent: rules[i].intent, ruleId: rules[i].id, ruleIndex: i, term };
  }
  return { intent: 'unclassified', ruleId: null, ruleIndex: -1, term: null };
}

/**
 * Resolve the intent of a keyword record: a manual override wins over rules.
 * Returns { intent, source: 'override'|'rule'|'none', ruleId, ruleIndex, term }.
 */
export function resolveIntent(record, rules) {
  if (record.intentOverride && INTENTS.includes(record.intentOverride)) {
    return { intent: record.intentOverride, source: 'override', ruleId: null, ruleIndex: -1, term: null };
  }
  const c = classify(record.keyword, rules);
  return { ...c, source: c.ruleId ? 'rule' : 'none' };
}

/** True if the keyword is phrased as a question. */
export function isQuestion(keyword) {
  if (String(keyword).trim().endsWith('?')) return true;
  const first = normalizeKeyword(keyword).split(' ')[0];
  return QUESTION_WORDS.includes(first);
}
