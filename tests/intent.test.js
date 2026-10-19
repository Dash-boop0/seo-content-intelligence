import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, classify, resolveIntent, validateRule, matchRule, isQuestion, parseTerms } from '../src/lib/intent.js';

const cases = [
  ['fernleaf login', 'navigational', 0, 'login'],
  ['fernleaf pricing', 'transactional', 1, 'pricing'],
  ['buy time tracking software', 'transactional', 1, 'buy'],
  ['best time tracking software', 'commercial', 2, 'best'],
  ['fernleaf vs hourglass', 'commercial', 2, 'vs'],
  ['how to track billable hours', 'informational', 3, 'how'],
  ['What is time blocking?', 'informational', 3, 'what'],
  ['timesheet template', 'informational', 4, 'template'],
  ['fernleaf', 'navigational', 5, 'fernleaf'],
  ['time tracking app', 'commercial', 6, 'app'],
  ['pomodoro timer', 'unclassified', -1, null]
];
test('default rules classify known examples (first match wins)', () => {
  for (const [kw, intent, idx, term] of cases) {
    const r = classify(kw, DEFAULT_RULES);
    assert.equal(r.intent, intent, kw);
    assert.equal(r.ruleIndex, idx, kw);
    assert.equal(r.term, term, kw);
  }
});
test('whole-word matching: "top" does not match "desktop", "trial" does not match "industrial"', () => {
  assert.equal(classify('desktop timer', DEFAULT_RULES).intent, 'unclassified');
  assert.equal(classify('industrial timer', DEFAULT_RULES).intent, 'unclassified');
});
test('rule order matters and disabled rules are skipped', () => {
  const rules = [
    { id: 'a', enabled: true, intent: 'navigational', match: 'contains', terms: 'acme' },
    { id: 'b', enabled: true, intent: 'transactional', match: 'contains', terms: 'pricing' }
  ];
  assert.equal(classify('acme pricing', rules).intent, 'navigational');
  assert.equal(classify('acme pricing', [rules[1], rules[0]]).intent, 'transactional');
  assert.equal(classify('acme pricing', [{ ...rules[0], enabled: false }, rules[1]]).intent, 'transactional');
});
test('match types: starts, ends, regex; invalid rules are reported and skipped', () => {
  assert.equal(matchRule({ enabled: true, intent: 'informational', match: 'starts', terms: 'how to' }, 'how to cook'), 'how to');
  assert.equal(matchRule({ enabled: true, intent: 'informational', match: 'starts', terms: 'how to' }, 'learn how to cook'), null);
  assert.equal(matchRule({ enabled: true, intent: 'commercial', match: 'ends', terms: 'reviews' }, 'acme reviews'), 'reviews');
  assert.equal(matchRule({ enabled: true, intent: 'commercial', match: 'regex', terms: '\\bvs\\b' }, 'a vs b'), 'vs');
  const bad = { id: 'x', enabled: true, intent: 'commercial', match: 'regex', terms: '([' };
  assert.match(validateRule(bad)[0], /Invalid regular expression/);
  assert.equal(classify('anything', [bad]).intent, 'unclassified');
  assert.equal(validateRule({ intent: 'nope', match: 'contains', terms: '' }).length, 2);
});
test('manual override wins over rules', () => {
  assert.deepEqual(resolveIntent({ keyword: 'best crm', intentOverride: 'transactional' }, DEFAULT_RULES).source, 'override');
  assert.equal(resolveIntent({ keyword: 'best crm', intentOverride: 'transactional' }, DEFAULT_RULES).intent, 'transactional');
  assert.equal(resolveIntent({ keyword: 'best crm', intentOverride: null }, DEFAULT_RULES).source, 'rule');
  assert.equal(resolveIntent({ keyword: 'zzz', intentOverride: null }, DEFAULT_RULES).source, 'none');
});
test('question detection and term parsing', () => {
  assert.equal(isQuestion('how is overtime calculated'), true);
  assert.equal(isQuestion('overtime calculated?'), true);
  assert.equal(isQuestion('overtime calculator'), false);
  assert.deepEqual(parseTerms(' Log In, ,SIGN-IN '), ['log in', 'sign in']);
});
