// App state shape, defaults and backup validation. Pure functions.

import { DEFAULT_RULES, INTENTS, MATCH_TYPES } from './intent.js';
import { DEFAULT_WEIGHTS, DEFAULT_INTENT_VALUES, FACTORS } from './score.js';

export const STORAGE_KEY = 'seo-content-intelligence.v1';
export const APP_ID = 'seo-content-intelligence';

export function defaultSettings() {
  return {
    foldPlurals: true,
    clusterThreshold: 0.6,
    weights: { ...DEFAULT_WEIGHTS },
    intentValues: { ...DEFAULT_INTENT_VALUES }
  };
}

export function defaultState() {
  return {
    version: 1,
    isSample: false,
    nextId: 1,
    keywords: [],
    rules: DEFAULT_RULES.map(r => ({ ...r })),
    settings: defaultSettings(),
    competitors: [],
    ourPages: [],
    briefs: {},
    dismissedDuplicates: []
  };
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const numOrNull = v => v === null || (typeof v === 'number' && Number.isFinite(v));

/**
 * Validate and normalise a state object (e.g. from a restored backup).
 * Accepts either a raw state or a backup envelope { app, state }.
 * Returns { ok: true, state } or { ok: false, errors: [...] }.
 */
export function validateState(input) {
  const errors = [];
  let s = input;
  if (isObj(s) && s.app !== undefined) {
    if (s.app !== APP_ID) return { ok: false, errors: [`This backup is for "${s.app}", not ${APP_ID}.`] };
    s = s.state;
  }
  if (!isObj(s)) return { ok: false, errors: ['Backup must be a JSON object.'] };
  if (!Array.isArray(s.keywords)) errors.push('"keywords" must be a list.');
  const out = defaultState();
  if (Array.isArray(s.keywords)) {
    const ids = new Set();
    s.keywords.forEach((k, i) => {
      if (!isObj(k) || typeof k.keyword !== 'string' || !k.keyword.trim()) { errors.push(`Keyword #${i + 1} has no text.`); return; }
      if (typeof k.id !== 'string' || ids.has(k.id)) { errors.push(`Keyword #${i + 1} has a missing or duplicate id.`); return; }
      for (const f of ['volume', 'difficulty', 'cpc', 'rank']) {
        if (k[f] !== undefined && !numOrNull(k[f])) errors.push(`Keyword "${k.keyword}" has a non-numeric ${f}.`);
      }
      if (k.difficulty != null && (k.difficulty < 0 || k.difficulty > 100)) errors.push(`Keyword "${k.keyword}" difficulty is outside 0–100.`);
      if (k.volume != null && k.volume < 0) errors.push(`Keyword "${k.keyword}" volume is negative.`);
      if (k.intentOverride != null && !INTENTS.includes(k.intentOverride)) errors.push(`Keyword "${k.keyword}" has an unknown intent override.`);
      ids.add(k.id);
      out.keywords.push({
        id: k.id, keyword: k.keyword,
        volume: k.volume ?? null, difficulty: k.difficulty ?? null, cpc: k.cpc ?? null, rank: k.rank ?? null,
        url: typeof k.url === 'string' ? k.url : '',
        intentOverride: k.intentOverride ?? null,
        mergedFrom: Array.isArray(k.mergedFrom) ? k.mergedFrom : []
      });
    });
  }
  if (s.rules !== undefined) {
    if (!Array.isArray(s.rules)) errors.push('"rules" must be a list.');
    else {
      out.rules = [];
      s.rules.forEach((r, i) => {
        if (!isObj(r) || !INTENTS.includes(r.intent) || !MATCH_TYPES[r.match] || typeof r.terms !== 'string') {
          errors.push(`Intent rule #${i + 1} is malformed.`); return;
        }
        out.rules.push({ id: String(r.id || 'r' + (i + 1)), enabled: r.enabled !== false, intent: r.intent, match: r.match, terms: r.terms, note: typeof r.note === 'string' ? r.note : '' });
      });
    }
  }
  if (s.settings !== undefined) {
    if (!isObj(s.settings)) errors.push('"settings" must be an object.');
    else {
      const st = s.settings;
      if (typeof st.foldPlurals === 'boolean') out.settings.foldPlurals = st.foldPlurals;
      if (st.clusterThreshold !== undefined) {
        if (typeof st.clusterThreshold === 'number' && st.clusterThreshold > 0 && st.clusterThreshold <= 1) out.settings.clusterThreshold = st.clusterThreshold;
        else errors.push('Cluster threshold must be between 0 and 1.');
      }
      if (isObj(st.weights)) for (const f of FACTORS) {
        if (st.weights[f] === undefined) continue;
        if (typeof st.weights[f] === 'number' && st.weights[f] >= 0) out.settings.weights[f] = st.weights[f];
        else errors.push(`Weight "${f}" must be a number ≥ 0.`);
      }
      if (isObj(st.intentValues)) for (const k of Object.keys(DEFAULT_INTENT_VALUES)) {
        if (st.intentValues[k] === undefined) continue;
        const v = st.intentValues[k];
        if (typeof v === 'number' && v >= 0 && v <= 1) out.settings.intentValues[k] = v;
        else errors.push(`Intent value "${k}" must be between 0 and 1.`);
      }
    }
  }
  for (const [key, fields] of [['competitors', ['domain', 'topic']], ['ourPages', ['url']]]) {
    if (s[key] === undefined) continue;
    if (!Array.isArray(s[key])) { errors.push(`"${key}" must be a list.`); continue; }
    s[key].forEach((row, i) => {
      if (!isObj(row) || fields.some(f => typeof row[f] !== 'string' || !row[f])) { errors.push(`${key} row #${i + 1} is missing ${fields.join('/')}.`); return; }
      out[key].push(key === 'competitors'
        ? { domain: row.domain, url: String(row.url || ''), topic: row.topic }
        : { url: row.url, title: String(row.title || ''), topic: String(row.topic || '') });
    });
  }
  if (s.briefs !== undefined) {
    if (!isObj(s.briefs)) errors.push('"briefs" must be an object.');
    else for (const [k, b] of Object.entries(s.briefs)) {
      if (!isObj(b)) { errors.push(`Brief "${k}" is malformed.`); continue; }
      out.briefs[k] = { ...b };
    }
  }
  if (Array.isArray(s.dismissedDuplicates)) out.dismissedDuplicates = s.dismissedDuplicates.filter(x => typeof x === 'string');
  out.isSample = s.isSample === true;
  const maxId = out.keywords.reduce((m, k) => Math.max(m, Number(String(k.id).replace(/\D/g, '')) || 0), 0);
  out.nextId = Math.max(Number(s.nextId) || 1, maxId + 1);
  if (errors.length) return { ok: false, errors };
  return { ok: true, state: out };
}

/** Wrap state in a backup envelope. */
export function makeBackup(state, exportedAt = new Date().toISOString()) {
  return { app: APP_ID, version: 1, exportedAt, state };
}
