import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseCSVWithHeaders, toCSV, csvCell } from '../src/lib/csv.js';

test('parses simple rows with CRLF and trailing newline', () => {
  assert.deepEqual(parseCSV('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});
test('handles quotes, escaped quotes, commas and newlines inside quotes', () => {
  const rows = parseCSV('k,v\n"time tracking, invoicing",1\n"say ""hi""",2\n"multi\nline",3');
  assert.deepEqual(rows, [['k', 'v'], ['time tracking, invoicing', '1'], ['say "hi"', '2'], ['multi\nline', '3']]);
});
test('strips UTF-8 BOM and handles lone CR line endings', () => {
  assert.deepEqual(parseCSV('﻿a,b\r1,2'), [['a', 'b'], ['1', '2']]);
});
test('keeps empty fields and skips blank lines', () => {
  assert.deepEqual(parseCSV('a,b,c\n1,,3\n\n,,\n'), [['a', 'b', 'c'], ['1', '', '3'], ['', '', '']]);
});
test('throws a helpful error on an unclosed quote', () => {
  assert.throws(() => parseCSV('a,b\n"open,2\n3,4'), /Unclosed quoted field starting on line 2/);
});
test('empty input gives no rows; headers parse pads short rows', () => {
  assert.deepEqual(parseCSV(''), []);
  assert.deepEqual(parseCSVWithHeaders(''), { headers: [], rows: [] });
  assert.deepEqual(parseCSVWithHeaders(' A , B \n1').rows, [['1', '']]);
  assert.deepEqual(parseCSVWithHeaders(' A , B \n1').headers, ['A', 'B']);
});
test('serializer quotes when needed and protects against CSV injection', () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-x'), "'-x");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell(-5), '-5', 'numbers are not prefixed');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(NaN), '');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(toCSV([['a', 'b'], [1, 'x\ny']]), 'a,b\r\n1,"x\ny"\r\n');
});
test('round trip: serialize then parse returns the same values', () => {
  const rows = [['keyword', 'note'], ['a, b', 'line1\nline2'], ['quote "q"', '']];
  assert.deepEqual(parseCSV(toCSV(rows)), rows);
});
