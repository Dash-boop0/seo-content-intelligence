// UI layer: rendering, events, persistence. All calculations live in src/lib/*.
import { parseCSVWithHeaders } from './lib/csv.js';
import { normalizeKeyword, mergeDuplicateGroup } from './lib/normalize.js';
import { KEYWORD_FIELDS, COMPETITOR_FIELDS, OUR_PAGE_FIELDS, guessMapping, importKeywordRows, importSimpleRows, parseField, validateMapping } from './lib/importer.js';
import { INTENTS, INTENT_LABELS, MATCH_TYPES, DEFAULT_RULES, validateRule, classify } from './lib/intent.js';
import { explainMember } from './lib/cluster.js';
import { GAP_STATUS } from './lib/gap.js';
import { FACTORS, FACTOR_LABELS, DEFAULT_WEIGHTS, DEFAULT_INTENT_VALUES, GAP_VALUES, validateWeights, validateIntentValues } from './lib/score.js';
import { generateBrief, briefToMarkdown } from './lib/brief.js';
import { analyse, recommendedAction, missingInputs, keywordsCSV, recommendationsCSV, recommendationsMarkdown } from './lib/pipeline.js';
import { defaultState, validateState, makeBackup, STORAGE_KEY } from './lib/state.js';
import { donutChart, stackedBarChart, legend, esc, PALETTE } from './lib/charts.js';

const TABS = ['overview', 'keywords', 'rules', 'clusters', 'gaps', 'briefs', 'priorities', 'data'];
const INTENT_COLORS = { informational: PALETTE[0], commercial: PALETTE[1], transactional: PALETTE[2], navigational: PALETTE[3], unclassified: PALETTE[5] };
const FACTOR_COLORS = { volume: PALETTE[0], difficulty: PALETTE[2], intent: PALETTE[1], gap: PALETTE[3], rank: PALETTE[4] };

let storageOk = true;
let hadSavedState = false;
/** Set when the visitor chose to start empty (or reset), so the sample is not auto-loaded again. */
const START_EMPTY_KEY = STORAGE_KEY + '.startEmpty';
let state = loadState();
let cache = null;
const ui = {
  tab: 'overview',
  kw: { q: '', intent: 'all', missing: 'all' },
  pendingImport: null,   // { headers, rows, mapping, fileName }
  importReport: null,    // { imported, skipped, warnings, mode }
  clusterQuery: '',
  gapFilter: 'all',
  briefCluster: '',
  ruleTest: '',
  simpleReport: null
};

// ---------- persistence ----------
function loadState() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { storageOk = false; return defaultState(); }
  if (!raw) return defaultState();
  hadSavedState = true;
  try {
    const v = validateState(JSON.parse(raw));
    if (v.ok) return v.state;
    queueMicrotask(() => setStatus('Saved data could not be read and was ignored: ' + v.errors.slice(0, 3).join(' '), 'bad'));
  } catch {
    queueMicrotask(() => setStatus('Saved data was corrupted and was ignored. Load sample data or import a CSV to continue.', 'bad'));
  }
  return defaultState();
}
function startEmptyChosen() {
  try { return localStorage.getItem(START_EMPTY_KEY) === '1'; } catch { return false; }
}
function rememberStartEmpty() {
  try { localStorage.setItem(START_EMPTY_KEY, '1'); } catch { /* storage unavailable */ }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { storageOk = false; setStatus('Could not save to browser storage (' + e.message + '). Use Data → Back up data to keep your work.', 'warn'); }
}
function commit(msg, kind = 'good') {
  save();
  cache = null;
  render();
  if (msg) setStatus(msg, kind);
}
function A() {
  if (!cache) cache = analyse(state);
  return cache;
}

// ---------- helpers ----------
function setStatus(msg, kind = 'good') {
  const el = document.getElementById('status');
  el.innerHTML = msg ? `<div class="msg ${kind}">${esc(msg)}</div>` : '';
}
const n0 = v => (v === null || v === undefined ? null : Number(v).toLocaleString('en-US'));
const MISSING = '<span class="missing" title="No value in the imported data. Nothing is estimated.">missing input</span>';
const showNum = v => (v === null || v === undefined ? MISSING : n0(v));
const intentBadge = i => `<span class="badge i-${esc(i)}">${esc(INTENT_LABELS[i] || i)}</span>`;
const gapBadge = s => `<span class="badge g-${esc(s)}" title="${esc(GAP_STATUS[s].label)}">${esc(GAP_STATUS[s].short)}</span>`;
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) + '%' : 'n/a');

function download(name, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function slug(s) { return normalizeKeyword(s).replace(/\s+/g, '-').slice(0, 60) || 'brief'; }
function emptyState(title, text, buttons = '') {
  return `<div class="card empty"><h2>${esc(title)}</h2><p>${text}</p><div class="actions" style="justify-content:center">${buttons}</div></div>`;
}
const sampleBtn = '<button class="primary" data-action="load-sample">Load sample data</button>';
const toKeywordsBtn = '<a class="btn" href="#keywords">Import keywords CSV</a>';

// ---------- render ----------
function render() {
  const hash = location.hash.replace('#', '');
  ui.tab = TABS.includes(hash) ? hash : 'overview';
  document.querySelectorAll('#tabs a').forEach(a => {
    if (a.dataset.tab === ui.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.getElementById('banner').innerHTML = state.isSample
    ? `<div class="sample-banner" role="note"><p class="sample-banner__text"><strong>Sample data — synthetic.</strong> “Fernleaf” (fernleaf.example.com), its competitors and every keyword volume, difficulty, CPC and rank shown are illustrative, not real search data. Some rows deliberately have missing values to show how gaps are handled.</p><button type="button" class="sample-banner__action" data-action="start-own">Start with your own data</button></div>`
    : '';
  const main = document.getElementById('main');
  let html;
  try {
    html = ({ overview: renderOverview, keywords: renderKeywords, rules: renderRules, clusters: renderClusters, gaps: renderGaps, briefs: renderBriefs, priorities: renderPriorities, data: renderData })[ui.tab]();
  } catch (e) {
    console.error(e);
    html = emptyState('Something went wrong', `The view could not be rendered: ${esc(e.message)}. Try Data → Reset, or restore a backup.`, '<a class="btn" href="#data">Go to Data</a>');
  }
  main.innerHTML = html;
}

// ---------- Overview ----------
function renderOverview() {
  if (!state.keywords.length) {
    return `<div class="page-head"><h1>Overview</h1></div>` + emptyState('No keyword data yet',
      'Import a keyword research CSV (only a keyword column is required) or load the synthetic sample to explore intent rules, clusters, content gaps, briefs and priorities.',
      sampleBtn + toKeywordsBtn);
  }
  const a = A();
  const s = a.stats;
  const gapCount = [...a.gaps.byCluster.values()].filter(g => g.status === 'gap').length;
  const intentData = [...INTENTS, 'unclassified'].map(i => ({ label: INTENT_LABELS[i], value: s.intentCounts[i] || 0, color: INTENT_COLORS[i] }));
  const top = a.scores.filter(x => x.score !== null).slice(0, 10);
  const topRows = top.map(x => ({ label: a.summaries.get(x.id).seed, segments: [{ key: 'score', value: x.score }] }));
  return `
  <div class="page-head"><div><h1>Overview</h1><p>Everything is calculated in your browser from the data you imported.</p></div></div>
  <div class="kpis">
    ${kpi('Keywords', n0(s.keywords), `${a.duplicates.length} duplicate group(s) to review`)}
    ${kpi('Clusters', n0(a.clusters.length), `threshold ${a.threshold}`)}
    ${kpi('Content gaps', a.gaps.hasCompetitorData ? n0(gapCount) : '—', a.gaps.hasCompetitorData ? 'competitors cover, we don’t' : 'missing input: import competitor CSV')}
    ${kpi('Volume coverage', pct(s.withVolume, s.keywords), `${s.keywords - s.withVolume} keyword(s) missing volume`)}
    ${kpi('Difficulty coverage', pct(s.withDifficulty, s.keywords), `${s.keywords - s.withDifficulty} missing difficulty`)}
    ${kpi('Unclassified intent', n0(s.intentCounts.unclassified || 0), 'no rule matched')}
  </div>
  <div class="grid two">
    <section class="card">
      <h2>Search intent mix</h2>
      <div class="chart-row">${donutChart(intentData, { title: 'Keywords by search intent' })}${legend(intentData.map(d => ({ label: `${d.label} (${d.value})`, color: d.color })))}</div>
      ${fallbackTable(['Intent', 'Keywords', 'Share'], intentData.map(d => [d.label, d.value, pct(d.value, s.keywords)]))}
      <p class="small muted">Intent comes from the ordered rules on the <a href="#rules">Intent rules</a> tab, or a manual override.</p>
    </section>
    <section class="card">
      <h2>Top priorities</h2>
      ${top.length ? stackedBarChart(topRows, [{ key: 'score', label: 'Score', color: PALETTE[0] }], { title: 'Top 10 clusters by priority score (0–100)', max: 100, labelWidth: 230 }) : '<p class="muted">No cluster has enough inputs to score.</p>'}
      ${fallbackTable(['#', 'Cluster', 'Score', 'Input coverage'], top.map((x, i) => [i + 1, a.summaries.get(x.id).seed, x.score, Math.round(x.coverage * 100) + '%']))}
      <p class="small muted">Scores only use inputs that exist. See the <a href="#priorities">Priorities</a> tab for the factor breakdown.</p>
    </section>
  </div>
  <section class="card">
    <h2>Next steps</h2>
    <ul class="plain">
      ${a.duplicates.length ? `<li><a href="#keywords">Review ${a.duplicates.length} duplicate group(s)</a> before clustering.</li>` : '<li>No duplicates pending.</li>'}
      ${s.intentCounts.unclassified ? `<li><a href="#rules">${s.intentCounts.unclassified} keyword(s) match no intent rule</a> — add a rule or set an override.</li>` : ''}
      ${!a.gaps.hasCompetitorData ? '<li><a href="#gaps">Import competitor and “our pages” CSVs</a> to find content gaps.</li>' : `<li><a href="#gaps">${gapCount} cluster(s) are covered by competitors but not by you.</a></li>`}
      <li><a href="#briefs">Draft a brief</a> for a top-priority cluster and export it as Markdown.</li>
    </ul>
  </section>`;
}
function kpi(label, value, sub) {
  return `<div class="kpi"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
}
function fallbackTable(headers, rows) {
  return `<details class="fallback"><summary>Show data table</summary><div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

// ---------- Keywords ----------
function renderKeywords() {
  return `
  <div class="page-head"><div><h1>Keywords</h1><p>Import, normalise, de-duplicate and edit keyword research.</p></div></div>
  ${renderImportCard()}
  ${state.keywords.length ? renderDuplicates() + renderKeywordTable() : emptyState('No keywords yet', 'Choose a CSV above, paste CSV text, or load the synthetic sample.', sampleBtn)}`;
}

function renderImportCard() {
  const p = ui.pendingImport;
  let mappingHtml = '';
  if (p) {
    const errs = validateMapping(p.mapping, KEYWORD_FIELDS);
    const preview = p.rows.slice(0, 5);
    mappingHtml = `
    <div class="card" style="background:var(--bg)">
      <h3>Map columns — ${esc(p.fileName)} (${p.rows.length} data rows)</h3>
      <p class="small muted">Columns were matched by name. Change any that are wrong. Unmapped optional fields stay <em>missing</em> — they are never estimated.</p>
      <div class="mapping-grid">
        ${KEYWORD_FIELDS.map(f => `<div><label for="map-${f.key}">${esc(f.label)}${f.required ? ' *' : ''}</label>
          <select id="map-${f.key}" data-change="map-field" data-field="${f.key}">
            <option value="-1">— not in file —</option>
            ${p.headers.map((h, i) => `<option value="${i}" ${p.mapping[f.key] === i ? 'selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`).join('')}
          </select></div>`).join('')}
      </div>
      <div class="table-wrap"><table><thead><tr>${KEYWORD_FIELDS.map(f => `<th>${esc(f.label)}</th>`).join('')}</tr></thead><tbody>
        ${preview.map(r => `<tr>${KEYWORD_FIELDS.map(f => {
          if (p.mapping[f.key] < 0) return `<td>${MISSING}</td>`;
          const { value, error } = parseField(f.key, r[p.mapping[f.key]]);
          if (error) return `<td class="error-text">${esc(error)}</td>`;
          return `<td>${value === null || value === '' ? MISSING : esc(value)}</td>`;
        }).join('')}</tr>`).join('')}
      </tbody></table></div>
      ${errs.map(e => `<p class="error-text">${esc(e)}</p>`).join('')}
      <div class="row" style="margin-top:10px">
        <fieldset style="border:0;padding:0;margin:0"><legend class="small muted">Import mode</legend>
          <label class="check"><input type="radio" name="import-mode" value="append" ${state.keywords.length ? 'checked' : ''}> Append to current keywords</label>
          <label class="check"><input type="radio" name="import-mode" value="replace" ${state.keywords.length ? '' : 'checked'}> Replace current keywords</label>
        </fieldset>
      </div>
      <div class="actions"><button class="primary" data-action="do-import" ${errs.length ? 'disabled' : ''}>Import ${p.rows.length} rows</button><button data-action="cancel-import">Cancel</button></div>
    </div>`;
  }
  const r = ui.importReport;
  const reportHtml = r ? `<div class="card" style="background:var(--bg)"><h3>Import report</h3>
    <p>${r.imported} keyword(s) imported (${r.mode}), ${r.skipped} row(s) skipped, ${r.warnings.length} warning(s).</p>
    ${r.warnings.length ? `<div class="table-wrap scroll-y" style="max-height:200px"><table><thead><tr><th>Row</th><th>Field</th><th>Problem</th></tr></thead><tbody>${r.warnings.slice(0, 200).map(w => `<tr><td class="num">${w.row}</td><td>${esc(w.field)}</td><td>${esc(w.message)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="actions"><button class="small" data-action="dismiss-report">Dismiss</button></div></div>` : '';
  return `<section class="card">
    <h2>Import keyword research CSV</h2>
    <p class="small muted">Required: a keyword column. Optional: search volume, keyword difficulty (0–100), CPC, current rank, ranking URL. Values like <code>12,100</code>, <code>1.2k</code>, <code>$4.20</code> are understood; blanks, <code>-</code> and <code>n/a</code> stay missing.</p>
    <div class="row">
      <div class="field"><label for="kw-file">CSV file</label><input id="kw-file" type="file" accept=".csv,text/csv" data-change="kw-file"></div>
      <a class="btn" href="sample-data/keywords-template.csv" download>Download template</a>
      <a class="btn" href="sample-data/keywords-sample.csv" download>Download sample CSV</a>
    </div>
    <details style="margin-top:10px"><summary class="small">…or paste CSV text</summary>
      <label for="kw-paste" class="small">CSV text (first row = headers)</label>
      <textarea id="kw-paste"></textarea>
      <div class="actions"><button data-action="kw-paste">Read pasted CSV</button></div>
    </details>
    ${mappingHtml}${reportHtml}
  </section>`;
}

function renderDuplicates() {
  const a = A();
  const kwText = id => a.keywordsById.get(id);
  return `<section class="card">
    <div class="page-head"><h2>Duplicates (${a.duplicates.length})</h2>
      <label class="check"><input type="checkbox" data-change="fold" ${state.settings.foldPlurals ? 'checked' : ''}> Fold simple plurals (apps → app, agencies → agency)</label></div>
    <p class="small muted"><strong>Exact</strong> = same text after lowercasing, trimming, collapsing spaces and stripping punctuation. <strong>Near</strong> = same set of words${state.settings.foldPlurals ? ' after plural folding' : ''}, in any order. Merging keeps the highest-volume row and fills its missing fields from the others; volumes are never summed.</p>
    ${a.duplicates.length ? `<div class="actions" style="margin-bottom:10px"><button data-action="merge-all">Merge all ${a.duplicates.length} group(s)</button></div>
    <div class="table-wrap"><table><thead><tr><th>Type</th><th>Keywords (volume)</th><th>Why</th><th>Actions</th></tr></thead><tbody>
    ${a.duplicates.map(g => `<tr><td><span class="badge ${g.kind === 'exact' ? 'g-gap' : 'g-contested'}">${g.kind === 'exact' ? 'Exact' : 'Near'}</span></td>
      <td>${g.ids.map(id => `${esc(kwText(id).keyword)} <span class="muted">(${kwText(id).volume === null ? 'volume missing' : n0(kwText(id).volume)})</span>`).join('<br>')}</td>
      <td class="small">${esc(g.reason)}</td>
      <td><div class="actions" style="margin:0"><button class="small" data-action="merge" data-key="${esc(g.key)}">Merge</button><button class="small" data-action="dismiss-dup" data-key="${esc(g.key)}">Not duplicates</button></div></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="ok-text">No duplicates found.</p>'}
    ${state.dismissedDuplicates.length ? `<p class="small muted">${state.dismissedDuplicates.length} group(s) marked “not duplicates”. <button class="small" data-action="undismiss">Show them again</button></p>` : ''}
  </section>`;
}

function filteredKeywords() {
  const a = A();
  const q = normalizeKeyword(ui.kw.q);
  return state.keywords.filter(k => {
    if (q && !normalizeKeyword(k.keyword).includes(q)) return false;
    if (ui.kw.intent !== 'all' && a.intents.get(k.id).intent !== ui.kw.intent) return false;
    const mv = k.volume === null, md = k.difficulty === null;
    if (ui.kw.missing === 'volume' && !mv) return false;
    if (ui.kw.missing === 'difficulty' && !md) return false;
    if (ui.kw.missing === 'any' && !(mv || md)) return false;
    if (ui.kw.missing === 'complete' && (mv || md)) return false;
    return true;
  });
}

function renderKeywordTable() {
  return `<section class="card">
    <div class="page-head"><h2>Keyword list</h2>
      <div class="actions" style="margin:0"><button data-action="export-keywords">Export processed CSV</button></div></div>
    <div class="row" style="margin-bottom:10px">
      <div class="field"><label for="kw-q">Search</label><input id="kw-q" type="search" value="${esc(ui.kw.q)}" data-input="kw-q"></div>
      <div class="field"><label for="kw-intent">Intent</label><select id="kw-intent" data-change="kw-filter" data-key="intent">
        <option value="all">All intents</option>${[...INTENTS, 'unclassified'].map(i => `<option value="${i}" ${ui.kw.intent === i ? 'selected' : ''}>${INTENT_LABELS[i]}</option>`).join('')}</select></div>
      <div class="field"><label for="kw-missing">Inputs</label><select id="kw-missing" data-change="kw-filter" data-key="missing">
        ${[['all', 'All rows'], ['any', 'Missing volume or difficulty'], ['volume', 'Missing volume'], ['difficulty', 'Missing difficulty'], ['complete', 'Complete rows only']].map(([v, l]) => `<option value="${v}" ${ui.kw.missing === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <div id="kw-table">${keywordTableHtml()}</div>
  </section>`;
}

function keywordTableHtml() {
  const a = A();
  const list = filteredKeywords();
  if (!list.length) return '<p class="muted">No keywords match these filters. Clear the search or change the filters.</p>';
  const cell = (k, f, label) => `<input class="cell" type="text" inputmode="decimal" aria-label="${label} for ${esc(k.keyword)}" data-change="kw-field" data-id="${esc(k.id)}" data-field="${f}" value="${k[f] === null ? '' : esc(k[f])}" placeholder="missing">`;
  return `<p class="small muted">${list.length} of ${state.keywords.length} keyword(s). Empty numeric cells are missing inputs — type a value to fill one in, or clear a cell to mark it missing.</p>
  <div class="table-wrap scroll-y"><table><thead><tr><th>Keyword</th><th class="num">Volume</th><th class="num">Difficulty</th><th class="num">CPC</th><th class="num">Rank</th><th>Intent</th><th>Why this intent</th><th>Cluster</th><th></th></tr></thead><tbody>
  ${list.map(k => {
    const r = a.intents.get(k.id);
    const why = r.source === 'override' ? 'Manual override' : r.source === 'rule' ? `Rule #${r.ruleIndex + 1}: ${MATCH_TYPES[state.rules[r.ruleIndex].match].toLowerCase()} “${esc(r.term)}”` : '<span class="missing">no rule matched</span>';
    const auto = classify(k.keyword, state.rules).intent;
    return `<tr>
      <td>${esc(k.keyword)}<div class="kw-norm">${esc(normalizeKeyword(k.keyword))}${k.url ? ` · <a href="${esc(k.url)}" rel="noopener" target="_blank">${esc(k.url.replace(/^https?:\/\//, ''))}</a>` : ''}${k.mergedFrom?.length ? ` · merged: ${esc(k.mergedFrom.map(m => m.keyword).join('; '))}` : ''}</div></td>
      <td class="num">${cell(k, 'volume', 'Volume')}</td><td class="num">${cell(k, 'difficulty', 'Difficulty')}</td><td class="num">${cell(k, 'cpc', 'CPC')}</td><td class="num">${cell(k, 'rank', 'Rank')}</td>
      <td><select aria-label="Intent for ${esc(k.keyword)}" data-change="kw-intent" data-id="${esc(k.id)}">
        <option value="">Auto: ${esc(INTENT_LABELS[auto])}</option>
        ${INTENTS.map(i => `<option value="${i}" ${k.intentOverride === i ? 'selected' : ''}>${INTENT_LABELS[i]} (override)</option>`).join('')}</select></td>
      <td class="small">${why}</td>
      <td class="small">${esc(a.clusterOfKeyword.get(k.id)?.seed || '')}</td>
      <td><button class="small danger" data-action="kw-delete" data-id="${esc(k.id)}" aria-label="Delete ${esc(k.keyword)}">Delete</button></td></tr>`;
  }).join('')}
  </tbody></table></div>`;
}

// ---------- Intent rules ----------
function renderRules() {
  const a = state.keywords.length ? A() : null;
  return `
  <div class="page-head"><div><h1>Intent rules</h1><p>Transparent, ordered, editable.</p></div></div>
  <p class="lead">Rules are checked from top to bottom against the <em>normalised</em> keyword. The first enabled rule that matches decides the intent; if none matches, the keyword is <strong>Unclassified</strong>. Terms are comma-separated and match whole words or phrases. A manual override on the Keywords tab always wins.</p>
  <section class="card">
    <h2>Test a keyword</h2>
    <div class="tester"><label for="rule-test" class="sr-only" style="position:absolute;left:-9999px">Keyword to test</label>
      <input id="rule-test" type="text" value="${esc(ui.ruleTest)}" data-input="rule-test" placeholder="e.g. best time tracking app for freelancers">
      <div id="rule-test-out" aria-live="polite">${ruleTestHtml()}</div></div>
  </section>
  <section class="card">
    <div class="page-head"><h2>Rules (${state.rules.length})</h2>
      <div class="actions" style="margin:0"><button data-action="rule-add">Add rule</button><button data-action="rules-reset">Reset to defaults</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>On</th><th>Intent</th><th>Match type</th><th>Terms / pattern and note</th><th class="num">First matches</th><th>Order</th></tr></thead><tbody>
    ${state.rules.map((r, i) => {
      const problems = validateRule(r);
      return `<tr>
      <td class="num">${i + 1}</td>
      <td><input type="checkbox" aria-label="Rule ${i + 1} enabled" data-change="rule-field" data-idx="${i}" data-field="enabled" ${r.enabled ? 'checked' : ''}></td>
      <td><select aria-label="Rule ${i + 1} intent" data-change="rule-field" data-idx="${i}" data-field="intent">${INTENTS.map(x => `<option value="${x}" ${r.intent === x ? 'selected' : ''}>${INTENT_LABELS[x]}</option>`).join('')}</select></td>
      <td><select aria-label="Rule ${i + 1} match type" data-change="rule-field" data-idx="${i}" data-field="match">${Object.entries(MATCH_TYPES).map(([k, l]) => `<option value="${k}" ${r.match === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td style="min-width:260px"><input class="rule-terms" type="text" aria-label="Rule ${i + 1} terms" data-change="rule-field" data-idx="${i}" data-field="terms" value="${esc(r.terms)}">
        <input class="rule-note" type="text" aria-label="Rule ${i + 1} note" data-change="rule-field" data-idx="${i}" data-field="note" value="${esc(r.note)}" placeholder="Note: why this rule exists">
        ${problems.map(p => `<div class="error-text">${esc(p)} This rule is skipped until fixed.</div>`).join('')}</td>
      <td class="num">${a ? (a.ruleHits.get(r.id) || 0) : '—'}</td>
      <td><div class="actions" style="margin:0;flex-wrap:nowrap">
        <button class="small" data-action="rule-move" data-idx="${i}" data-dir="-1" aria-label="Move rule ${i + 1} up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="small" data-action="rule-move" data-idx="${i}" data-dir="1" aria-label="Move rule ${i + 1} down" ${i === state.rules.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="small danger" data-action="rule-delete" data-idx="${i}" aria-label="Delete rule ${i + 1}">✕</button></div></td></tr>`;
    }).join('')}
    </tbody></table></div>
    <p class="small muted">“First matches” = keywords whose intent was decided by this rule (keywords with a manual override are not counted). Full documentation: <a href="docs/INTENT_RULES.md">docs/INTENT_RULES.md</a>.</p>
  </section>`;
}
function ruleTestHtml() {
  if (!ui.ruleTest.trim()) return '<span class="muted small">Type a keyword to see which rule matches.</span>';
  const r = classify(ui.ruleTest, state.rules);
  return r.ruleId
    ? `${intentBadge(r.intent)} <span class="small">matched rule #${r.ruleIndex + 1} on “${esc(r.term)}” (normalised: “${esc(normalizeKeyword(ui.ruleTest))}”)</span>`
    : `${intentBadge('unclassified')} <span class="small">no enabled rule matched “${esc(normalizeKeyword(ui.ruleTest))}”</span>`;
}

// ---------- Clusters ----------
function renderClusters() {
  if (!state.keywords.length) return `<div class="page-head"><h1>Clusters</h1></div>` + emptyState('Nothing to cluster yet', 'Import keywords or load the sample data first.', sampleBtn + toKeywordsBtn);
  const t = state.settings.clusterThreshold;
  return `
  <div class="page-head"><div><h1>Clusters</h1><p>${A().clusters.length} cluster(s) from ${state.keywords.length} keyword(s)</p></div></div>
  <section class="card">
    <h2>How keywords are grouped</h2>
    <p class="small">Each keyword is reduced to <strong>core terms</strong> (normalised words${state.settings.foldPlurals ? ', plurals folded' : ''}, minus stopwords and intent modifiers such as “best”, “how”, “free”). Keywords are processed by volume (highest first; missing volume last, then A→Z). Each joins the existing cluster whose <strong>seed</strong> has the highest Jaccard similarity (shared terms ÷ all distinct terms) if it reaches the threshold; otherwise it starts a new cluster. Same data + same settings = same clusters.</p>
    <div class="row">
      <div class="field"><label for="threshold">Similarity threshold: <strong id="threshold-val">${t.toFixed(2)}</strong></label>
        <input id="threshold" type="range" min="0.2" max="1" step="0.05" value="${t}" data-change="threshold" data-input="threshold-preview"></div>
      <span class="small muted">Lower = fewer, broader clusters. Higher = more, tighter clusters. Also used to match competitor topics and our pages.</span>
    </div>
  </section>
  <section class="card">
    <div class="row" style="margin-bottom:10px"><div class="field"><label for="cl-q">Find a keyword</label><input id="cl-q" type="search" value="${esc(ui.clusterQuery)}" data-input="cl-q"></div></div>
    <div id="cluster-list">${clusterListHtml()}</div>
  </section>`;
}
function clusterListHtml() {
  const a = A();
  const q = normalizeKeyword(ui.clusterQuery);
  const list = a.scores.map(s => a.clusters.find(c => c.id === s.id)).filter(c => !q || c.members.some(m => normalizeKeyword(m.keyword).includes(q)));
  if (!list.length) return '<p class="muted">No cluster contains that keyword.</p>';
  return `<p class="small muted">Sorted by priority score. Expand a cluster to see why each keyword is in it.</p>` + list.map(c => {
    const s = a.summaries.get(c.id);
    const sc = a.scoreById.get(c.id);
    return `<details class="cluster"><summary>
      <span class="seed">${esc(c.seed)}</span>${intentBadge(s.intent)}${gapBadge(s.gapStatus)}
      <span class="meta">${s.size} keyword(s) · volume ${s.totalVolume === null ? 'missing' : n0(s.totalVolume)}${s.volumeKnown < s.size && s.totalVolume !== null ? ` (${s.size - s.volumeKnown} missing)` : ''} · difficulty ${s.avgDifficulty ?? 'missing'} · head terms: ${esc(c.headTerms.join(', '))} · score ${sc.score ?? 'n/a'}</span>
    </summary><div class="body">
      <div class="table-wrap"><table><thead><tr><th>Keyword</th><th>Core terms</th><th class="num">Similarity</th><th>Why it’s here</th><th class="num">Volume</th><th class="num">Difficulty</th><th>Intent</th></tr></thead><tbody>
      ${c.members.map(m => { const k = a.keywordsById.get(m.id); return `<tr><td>${m.isSeed ? '<strong>' + esc(m.keyword) + '</strong>' : esc(m.keyword)}</td><td class="small">${esc(m.tokens.join(', '))}</td><td class="num">${m.similarity.toFixed(2)}</td><td class="small">${esc(explainMember(m, c))}</td><td class="num">${showNum(k.volume)}</td><td class="num">${showNum(k.difficulty)}</td><td>${intentBadge(a.intents.get(m.id).intent)}</td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="actions"><button class="small" data-action="open-brief" data-id="${esc(c.id)}">${state.briefs[c.id] ? 'Open brief' : 'Create brief'}</button></div>
    </div></details>`;
  }).join('');
}

// ---------- Content gaps ----------
function simpleImportBlock(kind, title, fields, count, templateHref, sampleHref) {
  return `<section class="card">
    <h2>${esc(title)} <span class="muted small">(${count} row(s))</span></h2>
    <p class="small muted">Columns: ${fields.map(f => `<code>${f.synonyms[0].replace(/ /g, '_')}</code>${f.required ? ' (required)' : ''}`).join(', ')}.</p>
    <div class="row">
      <div class="field"><label for="${kind}-file">CSV file</label><input id="${kind}-file" type="file" accept=".csv,text/csv" data-change="simple-file" data-kind="${kind}"></div>
      <a class="btn" href="${templateHref}" download>Template</a><a class="btn" href="${sampleHref}" download>Sample</a>
      ${count ? `<button class="danger" data-action="simple-clear" data-kind="${kind}">Clear</button>` : ''}
    </div>
    <details style="margin-top:8px"><summary class="small">…or paste CSV text</summary>
      <label for="${kind}-paste" class="small">CSV text (first row = headers)</label><textarea id="${kind}-paste"></textarea>
      <div class="actions"><button data-action="simple-paste" data-kind="${kind}">Read pasted CSV</button></div></details>
    ${ui.simpleReport && ui.simpleReport.kind === kind ? `<p class="small ${ui.simpleReport.warnings.length ? 'error-text' : 'ok-text'}">${esc(ui.simpleReport.text)}</p>` : ''}
  </section>`;
}
function renderGaps() {
  const imports = `<div class="grid two">
    ${simpleImportBlock('competitors', 'Competitor coverage CSV', COMPETITOR_FIELDS, state.competitors.length, 'sample-data/competitors-template.csv', 'sample-data/competitors-sample.csv')}
    ${simpleImportBlock('ourPages', 'Our pages CSV', OUR_PAGE_FIELDS, state.ourPages.length, 'sample-data/our-pages-template.csv', 'sample-data/our-pages-sample.csv')}
  </div>`;
  const head = `<div class="page-head"><div><h1>Content gaps</h1><p>Topics competitors cover that you don’t.</p></div></div>`;
  if (!state.keywords.length) return head + imports + emptyState('Import keywords first', 'Gaps are measured against your keyword clusters, so import keyword research (or the sample) first.', sampleBtn + toKeywordsBtn);
  const a = A();
  if (!a.gaps.hasCompetitorData) return head + imports + emptyState('No competitor data yet', 'Import a CSV listing competitor domains, URLs and the topic or keyword each page covers. Gap status is shown as “missing input” until then — nothing is guessed.', '<a class="btn" href="sample-data/competitors-template.csv" download>Download competitor template</a>');
  const all = a.scores.map(s => ({ s: a.summaries.get(s.id), g: a.gaps.byCluster.get(s.id), sc: s }));
  const counts = { gap: 0, contested: 0, ours: 0, untapped: 0 };
  all.forEach(x => { counts[x.g.status] = (counts[x.g.status] || 0) + 1; });
  const rows = all.filter(x => ui.gapFilter === 'all' || x.g.status === ui.gapFilter);
  const series = [{ key: 'gap', label: 'Matches a gap cluster', color: PALETTE[3] }, { key: 'contested', label: 'Matches a cluster we also cover', color: PALETTE[1] }, { key: 'unmatched', label: 'Not in our keyword research', color: PALETTE[5] }];
  const chartRows = a.gaps.domains.map(d => ({ label: d.domain, segments: [{ key: 'gap', value: d.gap }, { key: 'contested', value: d.contested }, { key: 'unmatched', value: d.unmatched }] }));
  return head + imports + `
  ${a.gaps.hasOurPages ? '' : '<div class="banner" style="margin-bottom:16px">No “our pages” CSV imported: coverage is judged only from ranking URLs in your keyword data, so some clusters may show as gaps that you actually cover.</div>'}
  <div class="kpis">
    ${kpi('Gaps', n0(counts.gap), 'competitors cover, we don’t')}
    ${kpi('Contested', n0(counts.contested), 'both cover')}
    ${kpi('Ours only', n0(counts.ours), 'we cover, they don’t')}
    ${kpi('Untapped', n0(counts.untapped), 'nobody in the data covers')}
    ${kpi('Topics outside our research', n0(a.gaps.unmatchedTopics.length), 'competitor topics, no keyword match')}
  </div>
  <section class="card"><h2>Competitor topics by match</h2>
    ${stackedBarChart(chartRows, series, { title: 'Competitor topics by how they match our clusters', labelWidth: 200, width: 760 })}${legend(series)}
    ${fallbackTable(['Competitor', 'Gap', 'Contested', 'Not in research', 'Total'], a.gaps.domains.map(d => [d.domain, d.gap, d.contested, d.unmatched, d.total]))}
  </section>
  <section class="card">
    <div class="page-head"><h2>Clusters by coverage</h2>
      <div class="field" style="margin:0"><label for="gap-filter">Show</label><select id="gap-filter" data-change="gap-filter">
        ${[['all', 'All clusters'], ['gap', 'Gaps only'], ['contested', 'Contested'], ['ours', 'Ours only'], ['untapped', 'Untapped']].map(([v, l]) => `<option value="${v}" ${ui.gapFilter === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="table-wrap scroll-y"><table><thead><tr><th>Cluster</th><th>Status</th><th>Competitors (matched topic)</th><th>Our coverage</th><th class="num">Known volume</th><th class="num">Score</th><th></th></tr></thead><tbody>
    ${rows.map(({ s, g, sc }) => `<tr><td>${esc(s.seed)}</td><td>${gapBadge(g.status)}</td>
      <td class="small">${g.competitors.map(c => `${esc(c.domain)} — “${esc(c.topic)}” (${c.similarity.toFixed(2)})`).join('<br>') || '<span class="muted">none</span>'}</td>
      <td class="small">${[...g.ourPages.map(p => esc(p.url.replace(/^https?:\/\//, ''))), ...g.rankingUrls.filter(u => !g.ourPages.some(p => p.url === u)).map(u => esc(u.replace(/^https?:\/\//, '')) + ' <span class="muted">(ranking URL)</span>')].join('<br>') || '<span class="muted">none</span>'}</td>
      <td class="num">${showNum(s.totalVolume)}</td><td class="num">${sc.score ?? 'n/a'}</td>
      <td><button class="small" data-action="open-brief" data-id="${esc(s.id)}">Brief</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No clusters with this status.</td></tr>'}
    </tbody></table></div>
  </section>
  <section class="card"><h2>Competitor topics not in your keyword research (${a.gaps.unmatchedTopics.length})</h2>
    <p class="small muted">These topics matched no keyword cluster at the current threshold. Their search volume and difficulty are <strong>missing inputs</strong> — research them before prioritising.</p>
    ${a.gaps.unmatchedTopics.length ? `<div class="table-wrap"><table><thead><tr><th>Topic</th><th>Competitors</th><th>Volume</th><th>URLs</th></tr></thead><tbody>
    ${a.gaps.unmatchedTopics.map(t => `<tr><td>${esc(t.topic)}</td><td>${esc(t.domains.join(', '))}</td><td>${MISSING}</td><td class="small">${t.urls.map(u => esc(u)).join('<br>')}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="ok-text">Every competitor topic matched one of your clusters.</p>'}
  </section>`;
}

// ---------- Briefs ----------
function renderBriefs() {
  const head = `<div class="page-head"><div><h1>Content briefs</h1><p>Generated from a cluster, then fully editable. Saved in this browser.</p></div></div>`;
  if (!state.keywords.length && !Object.keys(state.briefs).length) return head + emptyState('No clusters yet', 'Import keywords or load the sample data, then generate a brief from any cluster.', sampleBtn + toKeywordsBtn);
  const a = state.keywords.length ? A() : null;
  const options = a ? a.scores.map((s, i) => `<option value="${esc(s.id)}" ${ui.briefCluster === s.id ? 'selected' : ''}>#${i + 1} · ${esc(a.summaries.get(s.id).seed)} (score ${s.score ?? 'n/a'})${state.briefs[s.id] ? ' ✓ saved' : ''}</option>`).join('') : '';
  const saved = Object.entries(state.briefs);
  const b = ui.briefCluster ? state.briefs[ui.briefCluster] : null;
  const clusterExists = a && a.clusters.some(c => c.id === ui.briefCluster);
  let editor = '';
  if (b) {
    editor = `<section class="card">
      <div class="page-head"><h2>Editing: ${esc(b.primaryKeyword)}</h2>
        <div class="actions" style="margin:0"><button class="primary" data-action="brief-export">Export Markdown</button>${clusterExists ? '<button data-action="brief-regenerate">Regenerate</button>' : ''}<button class="danger" data-action="brief-delete">Delete</button></div></div>
      ${!clusterExists ? '<p class="banner">This cluster no longer exists at the current threshold or after keyword edits. The saved brief is kept and can still be edited and exported.</p>' : ''}
      <p class="small muted">Changes save automatically when you leave a field. Outline: one heading per line, <code>## </code> for H2 and <code>### </code> for H3.</p>
      <div class="brief-grid">
        <div class="field wide"><label for="bf-title">Working title</label><input id="bf-title" type="text" style="width:100%" data-change="brief-field" data-field="workingTitle" value="${esc(b.workingTitle)}"></div>
        <div class="field"><label for="bf-primary">Primary keyword</label><input id="bf-primary" type="text" style="width:100%" data-change="brief-field" data-field="primaryKeyword" value="${esc(b.primaryKeyword)}"></div>
        <div class="field"><label for="bf-intent">Search intent</label><select id="bf-intent" data-change="brief-field" data-field="intent">${[...INTENTS, 'unclassified'].map(i => `<option value="${i}" ${b.intent === i ? 'selected' : ''}>${INTENT_LABELS[i]}</option>`).join('')}</select></div>
        <div class="field wide"><label for="bf-audience">Audience</label><textarea id="bf-audience" data-change="brief-field" data-field="audience">${esc(b.audience)}</textarea></div>
        <div class="field"><label for="bf-outline">Outline (H2/H3)</label><textarea id="bf-outline" class="tall" data-change="brief-field" data-field="outline">${esc(b.outline)}</textarea></div>
        <div class="field"><label for="bf-secondary">Secondary keywords (one per line)</label><textarea id="bf-secondary" class="tall" data-change="brief-field" data-field="secondaryKeywords">${esc(b.secondaryKeywords)}</textarea></div>
        <div class="field"><label for="bf-questions">Questions to answer (one per line)</label><textarea id="bf-questions" data-change="brief-field" data-field="questions" placeholder="No question-form keywords in this cluster. Add your own.">${esc(b.questions)}</textarea></div>
        <div class="field"><label for="bf-links">Internal-link opportunities (one per line)</label><textarea id="bf-links" data-change="brief-field" data-field="internalLinks">${esc(b.internalLinks)}</textarea></div>
        <div class="field"><label for="bf-data">Data notes</label><textarea id="bf-data" data-change="brief-field" data-field="dataNotes">${esc(b.dataNotes)}</textarea></div>
        <div class="field"><label for="bf-notes">Writer notes</label><textarea id="bf-notes" data-change="brief-field" data-field="notes">${esc(b.notes)}</textarea></div>
      </div>
    </section>`;
  } else if (ui.briefCluster && clusterExists) {
    editor = `<section class="card empty"><h2>No brief for this cluster yet</h2><p>Generate a draft from the cluster’s keywords, intent, question-form keywords and your pages. Every field is editable afterwards.</p><div class="actions" style="justify-content:center"><button class="primary" data-action="brief-generate">Generate brief</button></div></section>`;
  }
  return head + `
  <section class="card">
    <div class="row">
      <div class="field" style="flex:1 1 320px"><label for="brief-cluster">Cluster (sorted by priority)</label>
        <select id="brief-cluster" style="width:100%" data-change="brief-cluster"><option value="">— choose a cluster —</option>${options}</select></div>
      ${saved.length ? `<button data-action="brief-export-all">Export all ${saved.length} brief(s) (.md)</button>` : ''}
    </div>
  </section>
  ${editor}
  <section class="card"><h2>Saved briefs (${saved.length})</h2>
    ${saved.length ? `<ul class="plain">${saved.map(([id, br]) => `<li><button class="small" data-action="open-brief" data-id="${esc(id)}">${esc(br.workingTitle || br.primaryKeyword)}</button> <span class="muted small">${esc(INTENT_LABELS[br.intent] || '')}${a && !a.clusters.some(c => c.id === id) ? ' · cluster not present at current settings' : ''}</span></li>`).join('')}</ul>` : '<p class="muted">None yet. Choose a cluster above and generate a brief.</p>'}
  </section>`;
}

// ---------- Priorities ----------
function renderPriorities() {
  const head = `<div class="page-head"><div><h1>Priorities</h1><p>Explainable weighted score per cluster, from available inputs only.</p></div></div>`;
  if (!state.keywords.length) return head + emptyState('Nothing to prioritise yet', 'Import keywords or load the sample data first.', sampleBtn + toKeywordsBtn);
  const a = A();
  const w = state.settings.weights;
  const iv = state.settings.intentValues;
  const wProblems = validateWeights(w), ivProblems = validateIntentValues(iv);
  const top = a.scores.filter(s => s.score !== null).slice(0, 15);
  const series = FACTORS.map(f => ({ key: f, label: FACTOR_LABELS[f], color: FACTOR_COLORS[f] }));
  const chartRows = top.map(s => ({ label: a.summaries.get(s.id).seed, segments: FACTORS.map(f => ({ key: f, value: s.factors[f].contribution || 0 })) }));
  const factorCell = (s, f) => {
    const x = s.factors[f];
    if (x.weight === 0) return '<span class="muted small">weight 0</span>';
    if (x.value === null) return MISSING;
    let raw = x.raw;
    if (f === 'volume') raw = n0(raw);
    if (f === 'intent') raw = INTENT_LABELS[raw];
    if (f === 'gap') raw = GAP_STATUS[raw].short;
    if (f === 'rank') raw = '#' + raw;
    return `${x.value.toFixed(2)}<span class="raw">${esc(raw)}</span>`;
  };
  return head + `
  <section class="card">
    <h2>Scoring criteria</h2>
    <p class="small">Score = 100 × Σ(weight × factor) ÷ Σ(weights of factors that have data). Each factor is 0–1. A factor with no data is <strong>excluded</strong> (not guessed) and listed as a missing input; “input coverage” shows how much of the total weight was usable. Full formula and worked example: <a href="docs/SCORING.md">docs/SCORING.md</a>.</p>
    <div class="row">
      ${FACTORS.map(f => `<div class="field"><label for="w-${f}">${esc(FACTOR_LABELS[f])}</label><input id="w-${f}" type="number" min="0" step="1" style="width:110px" data-change="weight" data-factor="${f}" value="${w[f]}"></div>`).join('')}
    </div>
    <p class="small muted" style="margin-top:8px">Total weight: ${FACTORS.reduce((t, f) => t + (w[f] || 0), 0)} (weights are relative; they need not add to 100).</p>
    <h3 style="margin-top:12px">Intent value (0–1)</h3>
    <div class="row">${Object.keys(DEFAULT_INTENT_VALUES).map(k => `<div class="field"><label for="iv-${k}">${INTENT_LABELS[k]}</label><input id="iv-${k}" type="number" min="0" max="1" step="0.05" style="width:110px" data-change="intent-value" data-intent="${k}" value="${iv[k]}"></div>`).join('')}</div>
    ${[...wProblems, ...ivProblems].map(p => `<p class="error-text">${esc(p)}</p>`).join('')}
    <details class="fallback"><summary>How each factor is calculated</summary><ul class="plain small">
      <li><strong>Search demand</strong>: log10(1 + cluster’s known volume) ÷ log10(1 + largest cluster volume). Missing if no keyword in the cluster has volume.</li>
      <li><strong>Ease</strong>: 1 − (average known difficulty ÷ 100). Missing if no difficulty values.</li>
      <li><strong>Intent value</strong>: the table above, for the cluster’s majority intent. Missing if all keywords are unclassified.</li>
      <li><strong>Competitor gap</strong>: gap ${GAP_VALUES.gap}, untapped ${GAP_VALUES.untapped}, contested ${GAP_VALUES.contested}, ours only ${GAP_VALUES.ours}. Missing if no competitor CSV.</li>
      <li><strong>Rank opportunity</strong> (best current rank): 1–3 → 0.1, 4–10 → 1.0, 11–20 → 0.8, 21–50 → 0.5, 51+ → 0.3. Missing if no rank values (blank rank means unknown, not “not ranking”).</li>
    </ul></details>
    <div class="actions"><button data-action="weights-reset">Reset weights and intent values</button></div>
  </section>
  <section class="card"><h2>Top ${top.length} by score — contribution of each factor</h2>
    ${top.length ? stackedBarChart(chartRows, series, { title: 'Score contributions by factor', max: 100, labelWidth: 240, width: 900 }) + legend(series) : '<p class="muted">No cluster can be scored with the current inputs and weights.</p>'}
    ${fallbackTable(['#', 'Cluster', ...FACTORS.map(f => FACTOR_LABELS[f]), 'Score'], top.map((s, i) => [i + 1, a.summaries.get(s.id).seed, ...FACTORS.map(f => s.factors[f].contribution === null ? 'missing' : s.factors[f].contribution.toFixed(1)), s.score]))}
  </section>
  <section class="card">
    <div class="page-head"><h2>Prioritised recommendations (${a.scores.length})</h2>
      <div class="actions" style="margin:0"><button data-action="export-recs-csv">Export CSV</button><button data-action="export-recs-md">Export Markdown</button></div></div>
    <div class="table-wrap scroll-y"><table><thead><tr><th class="num">#</th><th>Cluster</th><th class="num">Score</th><th class="num">Input coverage</th>${FACTORS.map(f => `<th>${esc(FACTOR_LABELS[f])}</th>`).join('')}<th>Recommended action</th><th></th></tr></thead><tbody>
    ${a.scores.map((s, i) => { const sum = a.summaries.get(s.id); const miss = missingInputs(s); return `<tr><td class="num">${i + 1}</td><td>${esc(sum.seed)}<div class="kw-norm">${sum.size} keyword(s)${miss.length ? ' · missing: ' + esc(miss.join(', ')) : ''}</div></td>
      <td class="num score">${s.score ?? 'n/a'}</td><td class="num">${Math.round(s.coverage * 100)}%</td>
      ${FACTORS.map(f => `<td class="factor-cell">${factorCell(s, f)}</td>`).join('')}
      <td class="small">${esc(recommendedAction(sum, a.gaps.byCluster.get(s.id)))}</td>
      <td><button class="small" data-action="open-brief" data-id="${esc(s.id)}">Brief</button></td></tr>`; }).join('')}
    </tbody></table></div>
  </section>`;
}

// ---------- Data ----------
function renderData() {
  return `<div class="page-head"><div><h1>Data</h1><p>Everything is stored only in this browser (localStorage).</p></div></div>
  ${storageOk ? '' : '<div class="banner" style="margin-bottom:16px">Browser storage is unavailable (private mode or blocked). Your work will be lost on reload — use “Back up data”.</div>'}
  <div class="grid two">
    <section class="card"><h2>Backup and restore</h2>
      <p class="small muted">A backup is a JSON file with keywords, rules, settings, competitor data, pages and briefs. Restoring replaces current data after validation.</p>
      <div class="actions"><button class="primary" data-action="backup">Back up data (.json)</button></div>
      <div class="field" style="margin-top:12px"><label for="restore-file">Restore from backup</label><input id="restore-file" type="file" accept=".json,application/json" data-change="restore"></div>
    </section>
    <section class="card"><h2>Sample data and reset</h2>
      <p class="small muted">The sample is synthetic: a fictional time-tracking SaaS “Fernleaf” (fernleaf.example.com), three fictional competitors and 77 keywords with illustrative volumes. Some values are deliberately missing.</p>
      <div class="actions">${sampleBtn}<button class="danger" data-action="reset">Reset all data</button></div>
    </section>
  </div>
  <section class="card"><h2>CSV templates and samples</h2>
    <ul class="plain">
      <li><a href="sample-data/keywords-template.csv" download>keywords-template.csv</a> · <a href="sample-data/keywords-sample.csv" download>keywords-sample.csv</a> (synthetic)</li>
      <li><a href="sample-data/competitors-template.csv" download>competitors-template.csv</a> · <a href="sample-data/competitors-sample.csv" download>competitors-sample.csv</a> (synthetic)</li>
      <li><a href="sample-data/our-pages-template.csv" download>our-pages-template.csv</a> · <a href="sample-data/our-pages-sample.csv" download>our-pages-sample.csv</a> (synthetic)</li>
    </ul>
    <p class="small muted">Current data: ${state.keywords.length} keyword(s), ${state.rules.length} rule(s), ${state.competitors.length} competitor row(s), ${state.ourPages.length} page(s), ${Object.keys(state.briefs).length} brief(s).</p>
  </section>`;
}

// ---------- actions ----------
function startKeywordImport(text, fileName) {
  let parsed;
  try { parsed = parseCSVWithHeaders(text); } catch (e) { setStatus(`Could not read ${fileName}: ${e.message}`, 'bad'); return; }
  if (!parsed.headers.length || !parsed.rows.length) { setStatus(`${fileName} has no data rows. The first row must be headers, followed by at least one keyword row.`, 'bad'); return; }
  ui.pendingImport = { headers: parsed.headers, rows: parsed.rows, mapping: guessMapping(parsed.headers, KEYWORD_FIELDS), fileName };
  ui.importReport = null;
  render();
  setStatus(`Read ${parsed.rows.length} row(s) from ${fileName}. Check the column mapping, then import.`);
}
function importSimple(kind, text, fileName) {
  let parsed;
  try { parsed = parseCSVWithHeaders(text); } catch (e) { setStatus(`Could not read ${fileName}: ${e.message}`, 'bad'); return; }
  if (!parsed.rows.length) { setStatus(`${fileName} has no data rows.`, 'bad'); return; }
  try {
    const res = importSimpleRows(parsed.headers, parsed.rows, kind === 'competitors' ? COMPETITOR_FIELDS : OUR_PAGE_FIELDS);
    state[kind] = res.items;
    ui.simpleReport = { kind, warnings: res.warnings, text: `Imported ${res.items.length} row(s) from ${fileName}.${res.warnings.length ? ` Skipped ${res.warnings.length}: ` + res.warnings.slice(0, 5).map(w => `row ${w.row} ${w.message}`).join('; ') : ''}` };
    commit(`Imported ${res.items.length} ${kind === 'competitors' ? 'competitor' : 'page'} row(s).`);
  } catch (e) { setStatus(`${fileName}: ${e.message}`, 'bad'); }
}

async function loadSample(_el, quiet = false) {
  if ((state.keywords.length || state.competitors.length) && !confirm('Replace current data with the synthetic sample? Back up first if you want to keep it.')) return;
  try {
    const [kw, comp, pages] = await Promise.all(['keywords-sample.csv', 'competitors-sample.csv', 'our-pages-sample.csv']
      .map(f => fetch('sample-data/' + f).then(r => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.text(); })));
    const k = parseCSVWithHeaders(kw);
    const res = importKeywordRows(k.rows, guessMapping(k.headers, KEYWORD_FIELDS), 1);
    const c = parseCSVWithHeaders(comp), p = parseCSVWithHeaders(pages);
    const s = defaultState();
    s.keywords = res.records; s.nextId = res.nextId; s.isSample = true;
    s.competitors = importSimpleRows(c.headers, c.rows, COMPETITOR_FIELDS).items;
    s.ourPages = importSimpleRows(p.headers, p.rows, OUR_PAGE_FIELDS).items;
    state = s;
    ui.pendingImport = null; ui.importReport = null; ui.briefCluster = ''; ui.simpleReport = null;
    commit(quiet ? '' : `Loaded synthetic sample: ${s.keywords.length} keywords, ${s.competitors.length} competitor topics, ${s.ourPages.length} pages.`);
    return true;
  } catch (e) {
    setStatus(`Could not load sample data (${e.message}). Open the app through a local web server (see README), not as a file:// page.`, 'bad');
    return false;
  }
}

function openBrief(id) {
  ui.briefCluster = id;
  if (location.hash !== '#briefs') location.hash = '#briefs'; else render();
}
function generateFor(id) {
  const a = A();
  const c = a.clusters.find(x => x.id === id);
  if (!c) { setStatus('That cluster no longer exists. Choose another.', 'bad'); return; }
  state.briefs[id] = { ...generateBrief(c, { keywordsById: a.keywordsById, intent: a.summaries.get(id).intent, ourPages: state.ourPages, threshold: a.threshold, fold: a.fold }), updatedAt: new Date().toISOString() };
  commit(`Generated a brief for “${c.seed}”. Edit any field; changes save automatically.`);
}

const actions = {
  'load-sample': loadSample,
  'kw-paste': () => { const t = document.getElementById('kw-paste').value; if (!t.trim()) return setStatus('Paste CSV text first.', 'bad'); startKeywordImport(t, 'pasted CSV'); },
  'cancel-import': () => { ui.pendingImport = null; render(); setStatus('Import cancelled.'); },
  'dismiss-report': () => { ui.importReport = null; render(); },
  'do-import': () => {
    const p = ui.pendingImport; if (!p) return;
    const mode = document.querySelector('input[name="import-mode"]:checked')?.value || 'append';
    try {
      const res = importKeywordRows(p.rows, p.mapping, state.nextId);
      if (!res.records.length) { setStatus('No rows had a keyword, so nothing was imported. Check the keyword column mapping.', 'bad'); return; }
      if (mode === 'replace') { state.keywords = res.records; state.isSample = false; state.dismissedDuplicates = []; }
      else state.keywords = state.keywords.concat(res.records);
      state.nextId = res.nextId;
      ui.pendingImport = null;
      ui.importReport = { imported: res.records.length, skipped: res.skipped, warnings: res.warnings, mode: mode === 'replace' ? 'replaced existing' : 'appended' };
      commit(`Imported ${res.records.length} keyword(s).${res.warnings.length ? ` ${res.warnings.length} warning(s) — see the import report.` : ''}`, res.warnings.length ? 'warn' : 'good');
    } catch (e) { setStatus(e.message, 'bad'); }
  },
  merge: el => {
    const g = A().duplicates.find(x => x.key === el.dataset.key); if (!g) return;
    const r = mergeDuplicateGroup(state.keywords, g.ids);
    state.keywords = r.keywords;
    commit(`Merged ${r.removedIds.length + 1} rows into “${state.keywords.find(k => k.id === r.canonicalId).keyword}”.`);
  },
  'merge-all': () => {
    const groups = A().duplicates; let n = 0;
    for (const g of groups) { const r = mergeDuplicateGroup(state.keywords, g.ids); state.keywords = r.keywords; n += r.removedIds.length; }
    commit(`Merged ${groups.length} group(s); removed ${n} duplicate row(s).`);
  },
  'dismiss-dup': el => { state.dismissedDuplicates.push(el.dataset.key); commit('Marked as not duplicates.'); },
  undismiss: () => { state.dismissedDuplicates = []; commit('Dismissed duplicate groups are shown again.'); },
  'kw-delete': el => {
    const k = state.keywords.find(x => x.id === el.dataset.id); if (!k) return;
    if (!confirm(`Delete “${k.keyword}”?`)) return;
    state.keywords = state.keywords.filter(x => x.id !== k.id);
    commit(`Deleted “${k.keyword}”.`);
  },
  'export-keywords': () => { download('keywords-processed.csv', keywordsCSV(state, A()), 'text/csv'); setStatus('Exported processed keywords CSV.'); },
  'rule-add': () => {
    const id = 'r' + (Math.max(0, ...state.rules.map(r => Number(String(r.id).replace(/\D/g, '')) || 0)) + 1);
    state.rules.push({ id, enabled: true, intent: 'informational', match: 'contains', terms: 'new term', note: '' });
    commit('Added a rule at the bottom. Edit its terms and move it into position.');
  },
  'rules-reset': () => { if (!confirm('Replace all intent rules with the defaults?')) return; state.rules = DEFAULT_RULES.map(r => ({ ...r })); commit('Intent rules reset to defaults.'); },
  'rule-move': el => {
    const i = Number(el.dataset.idx), j = i + Number(el.dataset.dir);
    if (j < 0 || j >= state.rules.length) return;
    [state.rules[i], state.rules[j]] = [state.rules[j], state.rules[i]];
    commit(`Moved rule to position ${j + 1}.`);
  },
  'rule-delete': el => { const i = Number(el.dataset.idx); if (!confirm(`Delete rule #${i + 1}?`)) return; state.rules.splice(i, 1); commit('Rule deleted.'); },
  'simple-paste': el => { const kind = el.dataset.kind; const t = document.getElementById(kind + '-paste').value; if (!t.trim()) return setStatus('Paste CSV text first.', 'bad'); importSimple(kind, t, 'pasted CSV'); },
  'simple-clear': el => { const kind = el.dataset.kind; if (!confirm('Clear this data?')) return; state[kind] = []; ui.simpleReport = null; commit('Cleared.'); },
  'open-brief': el => openBrief(el.dataset.id),
  'brief-generate': () => generateFor(ui.briefCluster),
  'brief-regenerate': () => { if (!confirm('Regenerate this brief from the cluster? Your edits will be replaced.')) return; generateFor(ui.briefCluster); },
  'brief-delete': () => { if (!confirm('Delete this brief?')) return; delete state.briefs[ui.briefCluster]; commit('Brief deleted.'); },
  'brief-export': () => { const b = state.briefs[ui.briefCluster]; if (!b) return; download(`brief-${slug(b.primaryKeyword)}.md`, briefToMarkdown(b), 'text/markdown'); setStatus('Exported brief as Markdown.'); },
  'brief-export-all': () => {
    const all = Object.values(state.briefs).map(briefToMarkdown).join('\n---\n\n');
    download('content-briefs.md', all, 'text/markdown'); setStatus(`Exported ${Object.keys(state.briefs).length} brief(s) as Markdown.`);
  },
  'export-recs-csv': () => { download('prioritised-recommendations.csv', recommendationsCSV(A()), 'text/csv'); setStatus('Exported recommendations CSV.'); },
  'export-recs-md': () => { download('prioritised-recommendations.md', recommendationsMarkdown(state, A(), { limit: 1000 }), 'text/markdown'); setStatus('Exported recommendations Markdown.'); },
  'weights-reset': () => { state.settings.weights = { ...DEFAULT_WEIGHTS }; state.settings.intentValues = { ...DEFAULT_INTENT_VALUES }; commit('Weights and intent values reset to defaults.'); },
  backup: () => { download(`seo-content-intelligence-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(makeBackup(state), null, 2), 'application/json'); setStatus('Backup downloaded.'); },
  'start-own': () => {
    rememberStartEmpty();
    state = defaultState(); ui.pendingImport = null; ui.importReport = null; ui.briefCluster = ''; ui.simpleReport = null;
    if (ui.tab !== 'overview' && ui.tab !== 'keywords') history.replaceState(null, '', '#overview');
    commit('Sample cleared. Import your own keyword CSV, or load the sample again.');
  },
  reset: () => {
    if (!confirm('Delete all keywords, rules, settings, competitor data, pages and briefs from this browser? This cannot be undone.')) return;
    rememberStartEmpty();
    state = defaultState(); ui.pendingImport = null; ui.importReport = null; ui.briefCluster = ''; ui.simpleReport = null;
    commit('All data reset.');
  }
};

const changeHandlers = {
  'kw-file': async el => { const f = el.files[0]; if (!f) return; startKeywordImport(await f.text(), f.name); },
  'simple-file': async el => { const f = el.files[0]; if (!f) return; importSimple(el.dataset.kind, await f.text(), f.name); },
  'map-field': el => { ui.pendingImport.mapping[el.dataset.field] = Number(el.value); render(); },
  fold: el => { state.settings.foldPlurals = el.checked; commit(`Plural folding ${el.checked ? 'on' : 'off'}.`); },
  'kw-filter': el => { ui.kw[el.dataset.key] = el.value; document.getElementById('kw-table').innerHTML = keywordTableHtml(); },
  'kw-field': el => {
    const k = state.keywords.find(x => x.id === el.dataset.id); if (!k) return;
    const f = el.dataset.field;
    const { value, error } = parseField(f, el.value);
    if (error) { setStatus(`“${k.keyword}”: ${error}. Value not changed.`, 'bad'); el.value = k[f] ?? ''; return; }
    k[f] = value;
    commit(`Updated ${f} for “${k.keyword}”${value === null ? ' (now missing)' : ''}.`);
  },
  'kw-intent': el => {
    const k = state.keywords.find(x => x.id === el.dataset.id); if (!k) return;
    k.intentOverride = el.value || null;
    commit(el.value ? `Intent for “${k.keyword}” set to ${INTENT_LABELS[el.value]} (override).` : `Intent for “${k.keyword}” back to automatic.`);
  },
  'rule-field': el => {
    const r = state.rules[Number(el.dataset.idx)]; if (!r) return;
    r[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value;
    const problems = validateRule(r);
    commit(problems.length ? `Rule saved but skipped until fixed: ${problems[0]}` : 'Rule updated; intents recalculated.', problems.length ? 'warn' : 'good');
  },
  threshold: el => { state.settings.clusterThreshold = Math.round(Number(el.value) * 100) / 100; commit(`Similarity threshold set to ${state.settings.clusterThreshold}. Clusters, gaps and scores recalculated.`); },
  'gap-filter': el => { ui.gapFilter = el.value; render(); },
  'brief-cluster': el => { ui.briefCluster = el.value; render(); },
  'brief-field': el => {
    const b = state.briefs[ui.briefCluster]; if (!b) return;
    b[el.dataset.field] = el.value; b.updatedAt = new Date().toISOString();
    save(); setStatus('Brief saved.');
  },
  weight: el => {
    const v = Number(el.value);
    if (el.value === '' || !Number.isFinite(v) || v < 0) { setStatus('Weights must be numbers ≥ 0.', 'bad'); el.value = state.settings.weights[el.dataset.factor]; return; }
    const next = { ...state.settings.weights, [el.dataset.factor]: v };
    const problems = validateWeights(next);
    if (problems.length) { setStatus(problems[0], 'bad'); el.value = state.settings.weights[el.dataset.factor]; return; }
    state.settings.weights = next;
    commit('Weights updated; scores recalculated.');
  },
  'intent-value': el => {
    const v = Number(el.value);
    if (el.value === '' || !(v >= 0 && v <= 1)) { setStatus('Intent values must be between 0 and 1.', 'bad'); el.value = state.settings.intentValues[el.dataset.intent]; return; }
    state.settings.intentValues[el.dataset.intent] = v;
    commit('Intent values updated; scores recalculated.');
  },
  restore: async el => {
    const f = el.files[0]; if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch { setStatus(`${f.name} is not valid JSON.`, 'bad'); el.value = ''; return; }
    const v = validateState(data);
    if (!v.ok) { setStatus('Backup rejected: ' + v.errors.slice(0, 4).join(' '), 'bad'); el.value = ''; return; }
    if (!confirm('Replace current data with this backup?')) { el.value = ''; return; }
    state = v.state; ui.briefCluster = ''; ui.pendingImport = null;
    commit(`Restored ${state.keywords.length} keyword(s) and ${Object.keys(state.briefs).length} brief(s) from ${f.name}.`);
  }
};

const inputHandlers = {
  'kw-q': el => { ui.kw.q = el.value; document.getElementById('kw-table').innerHTML = keywordTableHtml(); },
  'cl-q': el => { ui.clusterQuery = el.value; document.getElementById('cluster-list').innerHTML = clusterListHtml(); },
  'rule-test': el => { ui.ruleTest = el.value; document.getElementById('rule-test-out').innerHTML = ruleTestHtml(); },
  'threshold-preview': el => { document.getElementById('threshold-val').textContent = Number(el.value).toFixed(2); }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  e.preventDefault();
  const fn = actions[el.dataset.action];
  if (fn) Promise.resolve(fn(el)).catch(err => { console.error(err); setStatus('Action failed: ' + err.message, 'bad'); });
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const fn = changeHandlers[el.dataset.change];
  if (fn) Promise.resolve(fn(el)).catch(err => { console.error(err); setStatus('Update failed: ' + err.message, 'bad'); });
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-input]');
  if (el && inputHandlers[el.dataset.input]) inputHandlers[el.dataset.input](el);
});
window.addEventListener('hashchange', () => { setStatus(''); render(); document.getElementById('main').focus({ preventScroll: true }); window.scrollTo(0, 0); });

// First visit (nothing saved, sample not declined): open the synthetic sample so the overview is populated.
if (!hadSavedState && !startEmptyChosen()) {
  document.getElementById('main').innerHTML = '<p class="muted">Loading the synthetic sample…</p>';
  loadSample(null, true).then(ok => { if (!ok) render(); });
} else {
  render();
}
