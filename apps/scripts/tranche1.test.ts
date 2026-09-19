/**
 * Tests for: bulk question paste, hidden fields, save-and-continue storage, and
 * translation progress. Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBulkQuestions } from '../Aspire-Survey/src/engine/bulkParse.ts';
import { buildRow, columnsFor } from '../Aspire-Survey/src/engine/definition.ts';
import { hiddenFromSearch, loadProgress, progressFits, saveProgress, clearProgress } from '../Aspire-Survey/src/engine/progress.ts';
import { translationProgress } from '../Aspire-Survey/src/engine/translatable.ts';
import { validateSurveyStructure } from '../Aspire-Survey/src/admin/builderValidation.ts';
import { addQuestions } from '../Aspire-Survey/src/admin/builderOps.ts';
import type { SurveyDefinition } from '../Aspire-Survey/src/engine/types.ts';

const parse = (text: string) => parseBulkQuestions(text, { sectionId: 's1', startIndex: 0 });

// ── Bulk paste ───────────────────────────────────────────────────────────

test('choices become a single-choice question; a trailing * makes it required and numbering is ignored', () => {
  const { questions } = parse('1. How often do you shop with us? *\nWeekly\nMonthly\nRarely');
  assert.equal(questions.length, 1);
  const q = questions[0];
  assert.equal(q.type, 'radio');
  assert.equal(q.label, 'How often do you shop with us?');
  assert.equal(q.required, true);
  assert.deepEqual('options' in q && q.options, ['Weekly', 'Monthly', 'Rarely']);
  assert.equal(q.id, 's1_q1');
});

test('blocks are separated by blank lines and ids run on from the start index', () => {
  const r = parseBulkQuestions('First one\n\nSecond one\n\n\n\nThird one', { sectionId: 's2', startIndex: 3 });
  assert.deepEqual(r.questions.map(q => q.id), ['s2_q4', 's2_q5', 's2_q6']);
});

test('ids never collide with existing ones', () => {
  const r = parseBulkQuestions('A\n\nB', { sectionId: 's1', startIndex: 0, existingIds: new Set(['s1_q1']) });
  assert.equal(new Set(r.questions.map(q => q.id)).size, 2);
  assert.ok(!r.questions.some(q => q.id === 's1_q1'));
});

test('type inference: yes/no, NPS, rating, multi-select hint, email, long text', () => {
  const type = (t: string) => parse(t).questions[0].type;
  assert.equal(type('Do you agree?\nYes\nNo'), 'yesno');
  assert.equal(type('Recommend us?\n0\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10'), 'nps');
  assert.equal(type('Rate us\n1\n2\n3\n4\n5'), 'rating');
  assert.equal(type('Select all that apply\nA\nB\nC'), 'checkbox');
  assert.equal(type('Your email address'), 'email');
  assert.equal(type('Any comments for us?'), 'textarea');
  assert.equal(type('Your name'), 'text');
});

test('a forced type tag wins, and is removed from the label', () => {
  const q = parse('Pick your team (dropdown)\nA\nB')[ 'questions' ][0];
  assert.equal(q.type, 'select');
  assert.equal(q.label, 'Pick your team');
  assert.equal(parse('Rank these (ranking)\nA\nB\nC').questions[0].type, 'ranking');
  assert.equal(parse('Tell us more (long)').questions[0].type, 'textarea');
});

test('[other] adds an Other choice with its own column; [na] adds a last "not applicable" choice', () => {
  const q = parse('Which channel?\nEmail\nPhone\n[other] Something else\n[na] Not applicable').questions[0];
  assert.equal(q.type, 'radio');
  assert.deepEqual('options' in q && q.options, ['Email', 'Phone', 'Not applicable', 'Other']);
  assert.equal('otherColumn' in q && q.otherColumn, 's1_q1_other');
});

test('rows plus ">" scale lines make a matrix', () => {
  const q = parse('Rate our service\nProduct\nSupport\n> Excellent\n> Average\n> Poor').questions[0];
  assert.equal(q.type, 'matrix');
  if (q.type === 'matrix') {
    assert.deepEqual(q.rows, ['Product', 'Support']);
    assert.deepEqual(q.scale, ['Excellent', 'Average', 'Poor']);
    assert.equal(q.columnPrefix, 's1_q1');
  }
});

test('a single choice is padded and warned about rather than silently accepted', () => {
  const r = parse('Pick one (dropdown)\nOnly option');
  assert.equal(r.questions[0].type, 'select');
  assert.equal(r.warnings.length, 1);
});

test('empty input, blank lines and CRLF line endings are handled', () => {
  assert.equal(parse('').questions.length, 0);
  assert.equal(parse('   \n\n  ').questions.length, 0);
  assert.equal(parse('One\r\nA\r\nB\r\n\r\nTwo').questions.length, 2);
});

test('bullets and "a)" prefixes on choices are stripped', () => {
  const q = parse('Pick\n- Red\n* Blue\na) Green').questions[0];
  assert.deepEqual('options' in q && q.options, ['Red', 'Blue', 'Green']);
});

test('addQuestions appends to the chosen section only', () => {
  const def: SurveyDefinition = {
    slug: 'x', title: 'X', welcome: { heading: 'h', body: [] }, thankYou: { heading: 't', body: 'b' },
    sections: [{ id: 's1', title: 'One', questions: [] }, { id: 's2', title: 'Two', questions: [] }],
  };
  const next = addQuestions(def, 1, parse('A\n\nB').questions);
  assert.equal(next.sections[0].questions.length, 0);
  assert.equal(next.sections[1].questions.length, 2);
  assert.equal(addQuestions(def, 1, []), def);
});

// ── Hidden fields ────────────────────────────────────────────────────────

function withHidden(): SurveyDefinition {
  return {
    slug: 'h', title: 'H', hiddenFields: ['source', 'Campaign'],
    welcome: { heading: 'h', body: [] }, thankYou: { heading: 't', body: 'b' },
    sections: [{ id: 's', title: 'S', questions: [{ id: 'q1', type: 'text', label: 'Q' }] }],
  };
}

test('hidden fields come out of the link, trimmed and capped; unknown parameters are ignored', () => {
  const v = hiddenFromSearch(withHidden(), '?source=%20email%20&Campaign=' + 'x'.repeat(900) + '&evil=1');
  assert.equal(v.source, 'email');
  assert.equal(v.Campaign.length, 500);
  assert.equal('evil' in v, false);
  assert.deepEqual(hiddenFromSearch({ ...withHidden(), hiddenFields: undefined }, '?source=a'), {});
});

test('hidden fields get their own text columns and are written with the response', () => {
  const def = withHidden();
  const cols = columnsFor(def).map(c => `${c.name}:${c.type}`);
  assert.ok(cols.includes('source:text'));
  assert.ok(cols.includes('campaign:text'));
  const row = buildRow(def, { q1: 'hi', source: 'email' });
  assert.equal(row.source, 'email');
  assert.equal(row.campaign, null, 'a missing parameter is null, not undefined');
});

test('a hidden field cannot clash with a question, a reserved column or another hidden field', () => {
  const bad = (hiddenFields: string[]) => validateSurveyStructure({ ...withHidden(), hiddenFields })
    .filter(i => i.severity === 'error' && i.subject === 'survey').map(i => i.message).join('|');
  assert.match(bad(['q1']), /clashes/);
  assert.match(bad(['submitted_at']), /clashes/);
  assert.match(bad(['resp_department']), /clashes/);
  assert.match(bad(['a', 'A']), /twice/);
  assert.match(bad(['1bad']), /must start with a letter/);
  assert.match(bad(['has space']), /must start with a letter/);
  assert.equal(bad(['source', 'utm_campaign']), '');
});

// ── Save and continue ────────────────────────────────────────────────────

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

test('progress round-trips, expires after 30 days, and tolerates garbage or blocked storage', () => {
  const mem = new MemoryStorage();
  (globalThis as unknown as { localStorage: unknown }).localStorage = mem;
  const t0 = 1_000_000_000_000;

  assert.equal(loadProgress('k', t0), null);
  saveProgress('k', { answers: { a: 'x', r: ['1', '2'] }, index: 2, history: [0, 1] }, t0);
  const back = loadProgress('k', t0 + 1000);
  assert.deepEqual(back?.answers, { a: 'x', r: ['1', '2'] });
  assert.equal(back?.index, 2);

  assert.equal(loadProgress('k', t0 + 31 * 24 * 3600 * 1000), null, 'older than 30 days is dropped');
  assert.equal(mem.data.size, 0, 'and removed');

  mem.setItem('aspire-progress:bad', '{not json');
  assert.equal(loadProgress('bad', t0), null);
  mem.setItem('aspire-progress:odd', JSON.stringify({ index: 'x' }));
  assert.equal(loadProgress('odd', t0), null);

  saveProgress('k2', { answers: {}, index: 0, history: [] }, t0);
  clearProgress('k2');
  assert.equal(loadProgress('k2', t0), null);

  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); },
  };
  assert.doesNotThrow(() => saveProgress('k', { answers: {}, index: 0, history: [] }));
  assert.equal(loadProgress('k'), null);
  assert.doesNotThrow(() => clearProgress('k'));
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

test('a saved position that no longer fits an edited survey is not offered', () => {
  const def = withHidden();
  assert.equal(progressFits({ answers: {}, index: 0, history: [], savedAt: 1 }, def), true);
  assert.equal(progressFits({ answers: {}, index: 3, history: [], savedAt: 1 }, def), false);
  assert.equal(progressFits({ answers: {}, index: 0, history: [5], savedAt: 1 }, def), false);
});

// ── Translation progress ─────────────────────────────────────────────────

test('translation progress counts each language separately and ignores blanks', () => {
  const def = withHidden();
  const before = translationProgress(def);
  assert.equal(before[0].done, 0);
  assert.ok(before[0].total > 0);

  def.i18n = { Q: { ta: 'கேள்வி', hi: ' ' }, [def.title]: { ta: 'x' } };
  const p = translationProgress(def);
  const ta = p.find(x => x.lang === 'ta')!;
  const hi = p.find(x => x.lang === 'hi')!;
  assert.equal(ta.done, 2);
  assert.equal(hi.done, 0, 'whitespace does not count as translated');
  assert.equal(ta.percent, Math.round((2 / ta.total) * 100));
});
