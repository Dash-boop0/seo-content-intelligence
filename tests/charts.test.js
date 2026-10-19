import { test } from 'node:test';
import assert from 'node:assert/strict';
import { donutChart, stackedBarChart, esc, niceAxisMax } from '../src/lib/charts.js';

test('escapes markup', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});
test('donut handles empty data and labels totals', () => {
  assert.match(donutChart([{ label: 'A', value: 0 }], { title: 'T' }), /No data/);
  const svg = donutChart([{ label: 'A', value: 3 }, { label: 'B', value: 1 }], { title: 'Mix' });
  assert.match(svg, /role="img"/);
  assert.match(svg, /A: 3 \(75%\)/);
  assert.match(svg, /<title id="t-Mix">Mix<\/title>/);
});
test('stacked bars escape labels and scale to max', () => {
  const svg = stackedBarChart([{ label: '<b>', segments: [{ key: 's', value: 50 }] }], [{ key: 's', label: 'S', color: '#000' }], { max: 100, width: 640, labelWidth: 220 });
  assert.ok(!svg.includes('<b>'));
  assert.match(svg, /&lt;b&gt;/);
  // plot width = 640 - 220 - 56 = 364; 50% -> 182
  assert.match(svg, /width="182\.00"/);
});
test('nice axis maximum', () => {
  assert.deepEqual([7, 28, 100, 3, 0, 0.3].map(niceAxisMax), [8, 40, 100, 4, 1, 0.4]);
});
