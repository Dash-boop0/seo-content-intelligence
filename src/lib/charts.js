// Hand-drawn inline SVG charts returned as strings. Pure functions.
// Every chart has role="img", a <title>/<desc>, and the caller renders a data table fallback.

export const PALETTE = ['#2F5BEA', '#E07A1F', '#1F9E89', '#C2417A', '#7A5AF8', '#8C8C8C'];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmt = n => (Math.round(n * 10) / 10).toLocaleString('en-US');

/**
 * Donut chart. data: [{ label, value, color }]. Returns SVG markup.
 * Zero-total data yields an empty-ring chart with a "No data" label.
 */
export function donutChart(data, { title = 'Chart', size = 200, thickness = 34 } = {}) {
  const total = data.reduce((a, d) => a + (d.value > 0 ? d.value : 0), 0);
  const r = size / 2 - thickness / 2 - 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = total === 0 ? '' : data.filter(d => d.value > 0).map((d, i) => {
    const len = (d.value / total) * circ;
    const seg = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${d.color || PALETTE[i % PALETTE.length]}" stroke-width="${thickness}"
      stroke-dasharray="${len.toFixed(3)} ${(circ - len).toFixed(3)}" stroke-dashoffset="${(-offset).toFixed(3)}" transform="rotate(-90 ${c} ${c})"><title>${esc(d.label)}: ${d.value} (${Math.round((d.value / total) * 100)}%)</title></circle>`;
    offset += len;
    return seg;
  }).join('');
  const desc = data.map(d => `${d.label}: ${d.value}`).join(', ');
  return `<svg class="chart donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-labelledby="t-${esc(title).replace(/\W/g, '')}">
  <title id="t-${esc(title).replace(/\W/g, '')}">${esc(title)}</title><desc>${esc(desc)}</desc>
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${thickness}"/>
  ${arcs}
  <text x="${c}" y="${c - 4}" text-anchor="middle" class="donut-total">${total === 0 ? 'No data' : fmt(total)}</text>
  ${total === 0 ? '' : `<text x="${c}" y="${c + 16}" text-anchor="middle" class="donut-sub">total</text>`}
</svg>`;
}

/**
 * Horizontal stacked bar chart.
 * rows: [{ label, segments: [{ key, value }] }], series: [{ key, label, color }]
 * max: axis maximum (defaults to the largest row total).
 */
export function stackedBarChart(rows, series, { title = 'Chart', width = 640, rowHeight = 26, labelWidth = 220, max = null, unit = '' } = {}) {
  const totals = rows.map(r => r.segments.reduce((a, s) => a + (s.value > 0 ? s.value : 0), 0));
  const axisMax = max ?? niceAxisMax(Math.max(1, ...totals));
  const plotW = width - labelWidth - 56;
  const top = 8;
  const h = top + rows.length * rowHeight + 24;
  const colorOf = key => series.find(s => s.key === key)?.color || PALETTE[5];
  const labelOf = key => series.find(s => s.key === key)?.label || key;
  const bars = rows.map((r, i) => {
    let x = labelWidth;
    const y = top + i * rowHeight;
    const segs = r.segments.filter(s => s.value > 0).map(s => {
      const w = (s.value / axisMax) * plotW;
      const rect = `<rect x="${x.toFixed(2)}" y="${y + 4}" width="${Math.max(0, w).toFixed(2)}" height="${rowHeight - 8}" fill="${colorOf(s.key)}"><title>${esc(r.label)} — ${esc(labelOf(s.key))}: ${fmt(s.value)}${unit}</title></rect>`;
      x += w;
      return rect;
    }).join('');
    const label = r.label.length > 30 ? r.label.slice(0, 29) + '…' : r.label;
    return `<text x="${labelWidth - 8}" y="${y + rowHeight / 2 + 4}" text-anchor="end" class="bar-label">${esc(label)}</text>${segs}
      <text x="${(x + 6).toFixed(2)}" y="${y + rowHeight / 2 + 4}" class="bar-value">${totals[i] === 0 && !r.segments.length ? 'n/a' : fmt(totals[i]) + unit}</text>`;
  }).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const x = labelWidth + t * plotW;
    return `<line x1="${x}" x2="${x}" y1="${top}" y2="${h - 20}" class="grid"/><text x="${x}" y="${h - 6}" text-anchor="middle" class="axis">${fmt(t * axisMax)}</text>`;
  }).join('');
  return `<svg class="chart bars" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" preserveAspectRatio="xMinYMin meet" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>${ticks}${bars}</svg>`;
}

/** Round an axis maximum up so its four tick intervals are 1, 2 or 5 × 10^k (e.g. 7 → 8, 28 → 40, 100 → 100). */
export function niceAxisMax(m) {
  if (!(m > 0)) return 1;
  const raw = m / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const mults = p >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10]; // 2.5 only where the step stays a whole number
  const step = mults.map(x => x * p).find(x => x >= raw - 1e-9);
  return step * 4;
}

/** Legend markup for a series list. */
export function legend(series) {
  return `<ul class="legend">${series.map(s => `<li><span class="swatch" style="background:${s.color}"></span>${esc(s.label)}</li>`).join('')}</ul>`;
}
