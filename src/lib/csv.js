// RFC 4180 CSV parser and serializer. Pure functions, no DOM access.
// Handles: quoted fields, escaped quotes (""), commas/newlines inside quotes,
// UTF-8 BOM, CRLF / LF / CR line endings, trailing newline.

/**
 * Parse CSV text into an array of rows (each row an array of strings).
 * Throws an Error with a line number if a quoted field is never closed.
 */
export function parseCSV(text) {
  if (typeof text !== 'string') throw new TypeError('CSV input must be text');
  let s = text;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let quoteStartLine = 0;
  let line = 1;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      if (c === '\n') line++;
      if (c === '\r') { line++; if (s[i + 1] === '\n') { field += '\r\n'; i += 2; continue; } }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { inQuotes = true; quoteStartLine = line; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
      if (c === '\r' && s[i + 1] === '\n') i++;
      i++; line++; continue;
    }
    field += c; i++;
  }
  if (inQuotes) throw new Error(`Unclosed quoted field starting on line ${quoteStartLine}. Check for a missing closing quote (").`);
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  // Drop fully blank lines (a single empty field).
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

/**
 * Parse CSV with a header row. Returns { headers, rows } where rows are arrays
 * aligned to headers (short rows are padded with '').
 */
export function parseCSVWithHeaders(text) {
  const all = parseCSV(text);
  if (all.length === 0) return { headers: [], rows: [] };
  const headers = all[0].map(h => h.trim());
  const rows = all.slice(1).map(r => {
    const out = r.slice(0, Math.max(headers.length, r.length));
    while (out.length < headers.length) out.push('');
    return out;
  });
  return { headers, rows };
}

const INJECTION_START = /^[=+\-@\t\r]/;

/** Escape one cell for CSV output, with CSV-injection protection for strings. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s;
  if (typeof value === 'number') {
    s = Number.isFinite(value) ? String(value) : '';
  } else {
    s = String(value);
    if (INJECTION_START.test(s)) s = "'" + s;
  }
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Serialize an array of rows (arrays) to CSV text with CRLF line endings. */
export function toCSV(rows) {
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
