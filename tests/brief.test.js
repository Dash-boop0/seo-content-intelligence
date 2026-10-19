import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterKeywords } from '../src/lib/cluster.js';
import { generateBrief, briefToMarkdown, titleCase, asQuestion } from '../src/lib/brief.js';

const kws = [
  { id: 'k1', keyword: 'time blocking', volume: 2000, difficulty: 20 },
  { id: 'k2', keyword: 'what is time blocking', volume: 1900, difficulty: null },
  { id: 'k3', keyword: 'time blocking template', volume: 1000, difficulty: 20 },
  { id: 'k4', keyword: 'how to use time blocking', volume: null, difficulty: 12 }
];
const byId = new Map(kws.map(k => [k.id, k]));
const ourPages = [
  { url: 'https://me.example.com/blog/time-blocking', title: 'Time blocking guide', topic: 'time blocking' },
  { url: 'https://me.example.com/templates', title: 'Free templates', topic: 'templates' },
  { url: 'https://me.example.com/pricing', title: 'Pricing', topic: 'pricing' }
];

test('helpers', () => {
  assert.equal(titleCase('time tracking for freelancers'), 'Time Tracking for Freelancers');
  assert.equal(asQuestion('what is time blocking'), 'What is time blocking?');
});
test('generates a brief from a cluster with questions, outline and internal links', () => {
  const [c] = clusterKeywords(kws, { threshold: 0.6 });
  assert.equal(c.members.length, 4);
  const b = generateBrief(c, { keywordsById: byId, intent: 'informational', ourPages, threshold: 0.6 });
  assert.equal(b.clusterId, 'c:time blocking');
  assert.equal(b.primaryKeyword, 'time blocking');
  assert.equal(b.workingTitle, 'Time Blocking: A Practical Guide');
  assert.match(b.audience, /^People learning about time blocking who/);
  assert.equal(b.questions, 'What is time blocking?\nHow to use time blocking?');
  assert.deepEqual(b.outline.split('\n'), [
    '## Time Blocking: Overview', '## Time Blocking Template', '## Frequently Asked Questions',
    '### What is time blocking?', '### How to use time blocking?', '## Summary and Next Steps'
  ]);
  const links = b.internalLinks.split('\n');
  assert.equal(links.length, 2, 'pricing page shares no terms');
  assert.match(links[0], /^https:\/\/me\.example\.com\/blog\/time-blocking .*shared terms: blocking, time\) \[may already target this topic/);
  assert.match(links[1], /^https:\/\/me\.example\.com\/templates .*shared terms: template\)$/);
  assert.match(b.dataNotes, /Search volume missing for 1 of 4/);
  assert.match(b.dataNotes, /Keyword difficulty missing for 1 of 4/);
});
test('without our pages the brief says links could not be checked', () => {
  const [c] = clusterKeywords(kws, { threshold: 0.6 });
  const b = generateBrief(c, { keywordsById: byId, intent: 'unclassified', ourPages: [] });
  assert.equal(b.internalLinks, '');
  assert.match(b.dataNotes, /No "our pages" data/);
  assert.match(b.audience, /Audience not yet defined/);
});
test('Markdown export renders every section and outline as nested list', () => {
  const [c] = clusterKeywords(kws, { threshold: 0.6 });
  const b = { ...generateBrief(c, { keywordsById: byId, intent: 'informational', ourPages, threshold: 0.6 }), notes: 'Use original screenshots.' };
  const md = briefToMarkdown(b);
  assert.ok(md.startsWith('# Time Blocking: A Practical Guide\n'));
  assert.match(md, /- \*\*Search intent:\*\* Informational/);
  assert.match(md, /\n- H2: Time Blocking Template\n/);
  assert.match(md, /\n {2}- H3: What is time blocking\?\n/);
  assert.match(md, /## Questions to answer\n\n- What is time blocking\?/);
  assert.match(md, /## Internal-link opportunities\n\n- https:\/\/me\.example\.com\/blog\/time-blocking/);
  assert.match(md, /## Notes\n\nUse original screenshots\./);
  const empty = briefToMarkdown({ primaryKeyword: 'x', intent: 'commercial' });
  assert.match(empty, /_No outline yet._/);
  assert.match(empty, /_No question-form keywords in this cluster._/);
});
