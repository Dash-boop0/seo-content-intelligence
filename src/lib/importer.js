// Column mapping and row validation for keyword, competitor and "our pages" CSVs.
// Pure functions, no DOM access. Missing values become null — never invented.

import { normalizeKeyword } from './normalize.js';

export const KEYWORD_FIELDS = [
  { key: 'keyword', label: 'Keyword', required: true, synonyms: ['keyword', 'keywords', 'search term', 'search terms', 'query', 'search query', 'term', 'keyphrase', 'key phrase', 'phrase'] },
  { key: 'volume', label: 'Search volume', required: false, synonyms: ['search volume', 'volume', 'avg monthly searches', 'average monthly searches', 'monthly searches', 'monthly volume', 'searches', 'sv', 'msv'] },
  { key: 'difficulty', label: 'Keyword difficulty (0–100)', required: false, synonyms: ['keyword difficulty', 'difficulty', 'kd', 'seo difficulty', 'competition score'] },
  { key: 'cpc', label: 'CPC', required: false, synonyms: ['cpc', 'cost per click', 'avg cpc', 'top of page bid'] },
  { key: 'rank', label: 'Current rank', required: false, synonyms: ['current rank', 'current position', 'rank', 'position', 'pos', 'ranking'] },
  { key: 'url', label: 'Ranking URL', required: false, synonyms: ['ranking url', 'url', 'landing page', 'page', 'target url', 'current url'] }
];

export const COMPETITOR_FIELDS = [
  { key: 'domain', label: 'Competitor domain', required: true, synonyms: ['competitor domain', 'competitor', 'domain', 'site', 'website'] },
  { key: 'url', label: 'URL', required: false, synonyms: ['url', 'page url', 'page', 'link'] },
  { key: 'topic', label: 'Topic / keyword covered', required: true, synonyms: ['topic', 'keyword covered', 'keyword', 'topic covered', 'primary keyword', 'subject', 'title'] }
];

export const OUR_PAGE_FIELDS = [
  { key: 'url', label: 'URL', required: true, synonyms: ['url', 'page url', 'page', 'link'] },
  { key: 'title', label: 'Title', required: false, synonyms: ['title', 'page title', 'h1'] },
  { key: 'topic', label: 'Primary topic / keyword', required: false, synonyms: ['primary topic', 'topic', 'primary keyword', 'target keyword', 'keyword'] }
];

function headerNorm(h) {
  return normalizeKeyword(h);
}

/**
 * Guess which header column feeds each field. Exact synonym matches win over
 * "header contains synonym as a phrase". Each header is used at most once.
 * Returns { [fieldKey]: columnIndex | -1 }.
 */
export function guessMapping(headers, fields) {
  const hs = headers.map(headerNorm);
  const used = new Set();
  const mapping = {};
  for (const f of fields) mapping[f.key] = -1;
  // Pass 1: exact matches
  for (const f of fields) {
    for (const syn of f.synonyms) {
      const idx = hs.findIndex((h, i) => !used.has(i) && h === syn);
      if (idx !== -1) { mapping[f.key] = idx; used.add(idx); break; }
    }
  }
  // Pass 2: phrase containment
  for (const f of fields) {
    if (mapping[f.key] !== -1) continue;
    for (const syn of f.synonyms) {
      const idx = hs.findIndex((h, i) => !used.has(i) && (' ' + h + ' ').includes(' ' + syn + ' '));
      if (idx !== -1) { mapping[f.key] = idx; used.add(idx); break; }
    }
  }
  return mapping;
}

const MISSING_TOKENS = new Set(['', '-', '--', 'n/a', 'na', 'null', 'none', 'unknown', '?']);

/** True when a raw cell means "no value". */
export function isMissingCell(raw) {
  return raw === null || raw === undefined || MISSING_TOKENS.has(String(raw).trim().toLowerCase());
}

/**
 * Parse a numeric cell. Accepts thousands separators ("12,100"), currency
 * symbols ("$4.20"), percent signs ("45%") and k/m suffixes ("1.2k").
 * Returns { value: number|null, error: string|null }.
 */
export function parseNumberCell(raw) {
  if (isMissingCell(raw)) return { value: null, error: null };
  let s = String(raw).trim().replace(/[\s,$€£¥₹%]/g, '');
  let mult = 1;
  const m = s.match(/^(-?\d*\.?\d+)([kKmM])$/);
  if (m) { s = m[1]; mult = /k/i.test(m[2]) ? 1e3 : 1e6; }
  if (!/^-?\d*\.?\d+$/.test(s)) return { value: null, error: `"${raw}" is not a number` };
  const v = Number(s) * mult;
  if (!Number.isFinite(v)) return { value: null, error: `"${raw}" is not a number` };
  return { value: v, error: null };
}

/** Validate one field value. Returns { value, error }. */
export function parseField(field, raw) {
  if (field === 'keyword' || field === 'url' || field === 'domain' || field === 'topic' || field === 'title') {
    return { value: isMissingCell(raw) ? '' : String(raw).trim(), error: null };
  }
  const { value, error } = parseNumberCell(raw);
  if (error || value === null) return { value: null, error };
  if (field === 'volume') {
    if (value < 0) return { value: null, error: `volume ${raw} is negative` };
    return { value: Math.round(value), error: null };
  }
  if (field === 'difficulty') {
    if (value < 0 || value > 100) return { value: null, error: `difficulty ${raw} is outside 0–100` };
    return { value, error: null };
  }
  if (field === 'cpc') {
    if (value < 0) return { value: null, error: `CPC ${raw} is negative` };
    return { value: Math.round(value * 100) / 100, error: null };
  }
  if (field === 'rank') {
    if (value < 1 || !Number.isInteger(value)) return { value: null, error: `rank ${raw} must be a whole number ≥ 1` };
    return { value, error: null };
  }
  return { value, error: null };
}

/** Check that every required field is mapped. Returns a list of error strings. */
export function validateMapping(mapping, fields) {
  return fields.filter(f => f.required && (mapping[f.key] === undefined || mapping[f.key] < 0))
    .map(f => `Choose a column for "${f.label}" (required).`);
}

/**
 * Convert CSV rows to keyword records using a mapping.
 * `nextId` is the first numeric id to use; ids are "k<n>".
 * Rows without a keyword are skipped. Invalid numeric cells become null and
 * produce a warning (the row is still imported).
 * Returns { records, warnings: [{row, field, message}], skipped, nextId }.
 */
export function importKeywordRows(rows, mapping, nextId = 1) {
  const errors = validateMapping(mapping, KEYWORD_FIELDS);
  if (errors.length) throw new Error(errors.join(' '));
  const records = [];
  const warnings = [];
  let skipped = 0;
  let id = nextId;
  rows.forEach((r, i) => {
    const rowNo = i + 2; // +1 header, +1 one-based
    const get = key => (mapping[key] >= 0 ? r[mapping[key]] : '');
    const kw = parseField('keyword', get('keyword')).value;
    if (!normalizeKeyword(kw)) { skipped++; warnings.push({ row: rowNo, field: 'keyword', message: 'empty keyword — row skipped' }); return; }
    const rec = { id: 'k' + id++, keyword: kw.replace(/\s+/g, ' '), volume: null, difficulty: null, cpc: null, rank: null, url: '', intentOverride: null, mergedFrom: [] };
    for (const f of ['volume', 'difficulty', 'cpc', 'rank', 'url']) {
      if (mapping[f] === undefined || mapping[f] < 0) continue;
      const { value, error } = parseField(f, get(f));
      if (error) warnings.push({ row: rowNo, field: f, message: error + ' — left as missing' });
      rec[f] = f === 'url' ? (value || '') : value;
    }
    records.push(rec);
  });
  return { records, warnings, skipped, nextId: id };
}

/** Generic import for competitor / our-pages CSVs with auto-detected columns. */
export function importSimpleRows(headers, rows, fields) {
  const mapping = guessMapping(headers, fields);
  const errors = validateMapping(mapping, fields);
  if (errors.length) {
    const expected = fields.map(f => f.key + (f.required ? ' (required)' : '')).join(', ');
    throw new Error(`Missing column(s). Expected headers like: ${expected}. Found: ${headers.join(', ') || 'none'}.`);
  }
  const items = [];
  const warnings = [];
  rows.forEach((r, i) => {
    const item = {};
    for (const f of fields) item[f.key] = mapping[f.key] >= 0 ? String(r[mapping[f.key]] ?? '').trim() : '';
    const missing = fields.filter(f => f.required && !item[f.key]);
    if (missing.length) { warnings.push({ row: i + 2, message: `missing ${missing.map(f => f.key).join(', ')} — row skipped` }); return; }
    items.push(item);
  });
  return { items, warnings, mapping };
}
