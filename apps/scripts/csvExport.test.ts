/**
 * Pins the CSV/formula-injection defense in csvCell(): a cell whose text
 * begins with =, +, -, @, a tab or a carriage return is how Excel/Google
 * Sheets recognise the start of a formula, so a respondent's own free-text
 * answer could otherwise execute a formula (or exfiltrate other cells) in
 * whoever exports and opens the file. Also pins toCsv()'s header/row shape,
 * since reportStore.ts's exportResponsesCsv() and the legacy report export
 * both depend on it for every response export in the product.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from '../Aspire-Survey/src/admin/csvExport.ts';

test('a cell starting with = is prefixed with a leading quote, not left executable', () => {
  // The formula also contains " and , , which independently trigger CSV
  // quoting - both defenses apply, and the leading apostrophe survives inside it.
  assert.equal(csvCell('=HYPERLINK("https://evil/","click")'), '"\'=HYPERLINK(""https://evil/"",""click"")"');
});

test('the other formula-trigger characters (+, -, @, tab, CR) are escaped the same way', () => {
  assert.equal(csvCell('+1 555 0100'), '\'+1 555 0100');
  assert.equal(csvCell('-42'), '\'-42');
  assert.equal(csvCell('@mention'), '\'@mention');
  assert.equal(csvCell('\tindented'), '\'\tindented');
  // \r also matches the CSV-quoting regex on its own, so this cell is both
  // apostrophe-escaped and quoted.
  assert.equal(csvCell('\rcarriage'), '"\'\rcarriage"');
});

test('an ordinary answer with no leading trigger character is left untouched', () => {
  assert.equal(csvCell('Strongly agree'), 'Strongly agree');
  assert.equal(csvCell('Operations - EMEA'), 'Operations - EMEA');
});

test('a value containing a comma, quote or newline is wrapped in quotes with doubled internal quotes', () => {
  assert.equal(csvCell('Smith, John'), '"Smith, John"');
  assert.equal(csvCell('She said "hi"'), '"She said ""hi"""');
  assert.equal(csvCell('line one\nline two'), '"line one\nline two"');
});

test('a formula-triggering value that also needs quoting gets both defenses, in order', () => {
  // Quoted after the leading apostrophe is added, so Excel/Sheets still see
  // a literal string cell rather than a formula wrapped in quotes.
  assert.equal(csvCell('=A1,B1'), '"\'=A1,B1"');
});

test('null and undefined render as an empty cell, not the literal string', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
});

test('an array (checkbox answer) joins with "; " before the same escaping rules apply', () => {
  assert.equal(csvCell(['Email', 'Slack']), 'Email; Slack');
  assert.equal(csvCell(['=cmd', 'ok']), '\'=cmd; ok');
});

test('toCsv derives headers from the first row and one line per row, CRLF-joined', () => {
  const csv = toCsv([
    { name: 'Alice', note: '=SUM(A1:A9)' },
    { name: 'Bob, Jr.', note: 'fine' },
  ]);
  assert.equal(csv, 'name,note\r\nAlice,\'=SUM(A1:A9)\r\n"Bob, Jr.",fine');
});

test('toCsv on an empty row set returns an empty string rather than a bare header', () => {
  assert.equal(toCsv([]), '');
});
