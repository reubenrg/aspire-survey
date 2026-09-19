/**
 * Tests for the richer question types (constant sum, multiple text, heading,
 * full name, phone, image choice, file, signature) and dynamic options
 * (carry-forward and per-option rules). Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRow, columnsFor, isBlank, nextSectionIndex, resolveOptions, sectionPath, visibleQuestions, flatQuestions,
} from '../Aspire-Survey/src/engine/definition.ts';
import { validateAnswer, validateSection } from '../Aspire-Survey/src/engine/validation.ts';
import { validateSurveyStructure } from '../Aspire-Survey/src/admin/builderValidation.ts';
import { questionColumns } from '../Aspire-Survey/src/admin/questionMeta.ts';
import { hasStringAnswer, hasOptions, convertQuestion, newQuestion, QUESTION_TYPES } from '../Aspire-Survey/src/engine/questionFactory.ts';
import { translatableStrings } from '../Aspire-Survey/src/engine/translatable.ts';
import { validateAdditive } from '../Aspire-Survey/src/engine/additive.ts';
import { checkFile, safeFileName, uploadPath, fileNameOf } from '../Aspire-Survey/src/engine/uploadRules.ts';
import { duplicateQuestion } from '../Aspire-Survey/src/admin/builderOps.ts';
import type { Question, SurveyDefinition } from '../Aspire-Survey/src/engine/types.ts';

const wrap = (questions: Question[]): SurveyDefinition => ({
  slug: 'r', title: 'R', welcome: { heading: 'h', body: [] }, thankYou: { heading: 't', body: 'b' },
  sections: [{ id: 's1', title: 'S', questions }],
});

// ── Constant sum ─────────────────────────────────────────────────────────

const sum: Question = { id: 'budget', type: 'sum', label: 'Split 100', rows: ['Ads', 'Events', 'Tools'], total: 100, columnPrefix: 'budget', required: true };

test('a constant sum must add up exactly; a blank row counts as zero', () => {
  assert.equal(validateAnswer(sum, { Ads: '50', Events: '30', Tools: '20' }, {}), null);
  assert.equal(validateAnswer(sum, { Ads: '60', Events: '40' }, {}), null, 'a row left empty is 0');
  assert.match(validateAnswer(sum, { Ads: '50', Events: '30', Tools: '10' }, {}) ?? '', /add up to 100.*90/);
  assert.match(validateAnswer(sum, { Ads: '80', Events: '30', Tools: '10' }, {}) ?? '', /120/);
  assert.match(validateAnswer(sum, { Ads: '-5', Events: '105' }, {}) ?? '', /0 or more/);
  assert.match(validateAnswer(sum, { Ads: 'abc', Events: '100' }, {}) ?? '', /0 or more/);
  // floating point: 33.3 + 33.3 + 33.4 is exactly 100 to the user
  assert.equal(validateAnswer(sum, { Ads: '33.3', Events: '33.3', Tools: '33.4' }, {}), null);
});

test('an untouched required sum is "required", not "adds up to 0"', () => {
  assert.equal(validateAnswer(sum, undefined, {}), 'This question is required.');
  assert.equal(validateAnswer(sum, { Ads: '', Events: '', Tools: '' }, {}), 'This question is required.');
  assert.equal(validateAnswer({ ...sum, required: false }, {}, {}), null);
});

test('sum and multitext write one column per row, positionally, like a matrix', () => {
  const mt: Question = { id: 'addr', type: 'multitext', label: 'Address', rows: ['Line 1', 'City'], columnPrefix: 'addr' };
  const def = wrap([sum, mt]);
  assert.deepEqual(columnsFor(def).map(c => c.name), ['budget_01', 'budget_02', 'budget_03', 'addr_01', 'addr_02']);
  const row = buildRow(def, { budget: { Ads: '50', Events: '', Tools: '50' }, addr: { 'Line 1': '1 Main St' } });
  assert.deepEqual([row.budget_01, row.budget_02, row.budget_03], ['50', null, '50']);
  assert.deepEqual([row.addr_01, row.addr_02], ['1 Main St', null]);
});

test('sum rows are analysed as numbers and multitext rows as identifying text', () => {
  const kinds = Object.fromEntries(questionColumns(wrap([sum, { id: 'addr', type: 'multitext', label: 'A', rows: ['x'], columnPrefix: 'addr' }])).map(c => [c.column, c.kind]));
  assert.deepEqual(kinds, { budget_01: 'numeric', budget_02: 'numeric', budget_03: 'numeric', addr_01: 'identifier' });
});

// ── Heading, name, phone ─────────────────────────────────────────────────

test('a heading stores nothing, never blocks, and is skipped by columns and analytics', () => {
  const h: Question = { id: 'intro', type: 'heading', label: 'About you', hint: 'Tell us a bit.', required: true };
  const def = wrap([h, { id: 'q', type: 'text', label: 'Q' }]);
  assert.deepEqual(columnsFor(def).map(c => c.name), ['q']);
  assert.equal('intro' in buildRow(def, {}), false);
  assert.equal(isBlank(h, undefined, {}), false);
  assert.equal(validateAnswer(h, undefined, {}), null);
  assert.deepEqual(questionColumns(def).map(c => c.column), ['q']);
});

test('phone numbers: plausible formats pass, junk does not', () => {
  const p: Question = { id: 'p', type: 'phone', label: 'Phone' };
  for (const ok of ['+91 98765 43210', '(555) 123-4567', '5551234567', '+1.555.123.4567']) assert.equal(validateAnswer(p, ok, {}), null, ok);
  for (const bad of ['12345', 'call me', '555-CALL-NOW', '1'.repeat(20)]) assert.ok(validateAnswer(p, bad, {}), bad);
});

test('a required full name needs both parts', () => {
  const n: Question = { id: 'who', type: 'fullname', label: 'Name', required: true };
  assert.match(validateAnswer(n, 'Asha', { who__first: 'Asha', who__last: '' }) ?? '', /first and last/);
  assert.equal(validateAnswer(n, 'Asha Rao', { who__first: 'Asha', who__last: 'Rao' }), null);
  assert.equal(validateAnswer({ ...n, required: false }, 'Asha', { who__first: 'Asha' }), null);
});

// ── Image choice ─────────────────────────────────────────────────────────

test('image choice is text when single and a list when multiple, and both are analysed as choices', () => {
  const single: Question = { id: 'logo', type: 'image', label: 'Pick', options: ['A', 'B'], images: ['https://x/a.png', 'https://x/b.png'] };
  const multi: Question = { ...single, id: 'logos', multiple: true, minSelections: 1, maxSelections: 2 } as Question;
  const def = wrap([single, multi]);
  const cols = Object.fromEntries(columnsFor(def).map(c => [c.name, c.type]));
  assert.deepEqual(cols, { logo: 'text', logos: 'text[]' });
  assert.deepEqual(buildRow(def, { logo: 'A', logos: ['A', 'B'] }), { logo: 'A', logos: ['A', 'B'] });
  assert.deepEqual(buildRow(def, {}).logos, []);
  assert.equal(questionColumns(def).find(c => c.column === 'logos')?.kind, 'multiselect');
  assert.equal(questionColumns(def).find(c => c.column === 'logo')?.kind, 'choice');
  assert.match(validateAnswer(multi, ['A', 'B', 'C'], {}) ?? '', /no more than 2/);
});

test('image choice with a non-https picture is a publish error; a missing picture is only a warning', () => {
  const q: Question = { id: 'i', type: 'image', label: 'I', options: ['A', 'B'], images: ['http://insecure/a.png', ''] };
  const issues = validateSurveyStructure(wrap([q]));
  assert.ok(issues.some(i => i.severity === 'error' && /https/.test(i.message)));
  assert.ok(issues.some(i => i.severity === 'warning' && /without a picture/.test(i.message)));
});

// ── File and signature ───────────────────────────────────────────────────

test('file and signature answers are stored as text paths and never aggregated', () => {
  const def = wrap([{ id: 'cv', type: 'file', label: 'CV' }, { id: 'sig', type: 'signature', label: 'Sign' }]);
  assert.deepEqual(columnsFor(def).map(c => `${c.name}:${c.type}`), ['cv:text', 'sig:text']);
  assert.deepEqual(questionColumns(def).map(c => c.kind), ['identifier', 'identifier']);
  assert.equal(buildRow(def, { cv: 'r/abc/cv.pdf' }).cv, 'r/abc/cv.pdf');
  assert.equal(buildRow(def, {}).sig, null);
});

test('upload rules: size, type, empty files, and safe object paths', () => {
  const ok = { name: 'cv.pdf', size: 1000, type: 'application/pdf' };
  assert.equal(checkFile(ok, {}), null);
  assert.match(checkFile({ ...ok, size: 0 }, {}) ?? '', /empty/);
  assert.match(checkFile({ ...ok, size: 6 * 1024 * 1024 }, { maxSizeMb: 5 }) ?? '', /larger than 5 MB/);
  assert.match(checkFile({ ...ok, size: 11 * 1024 * 1024 }, { maxSizeMb: 50 }) ?? '', /larger than 10 MB/, 'the platform ceiling is 10 MB whatever an author sets');
  assert.match(checkFile({ name: 'x.exe', size: 10, type: 'application/x-msdownload' }, {}) ?? '', /Please choose/);
  assert.match(checkFile(ok, { accept: 'images' }) ?? '', /an image/);
  assert.equal(checkFile({ name: 'p.png', size: 10, type: 'image/png' }, { accept: 'images' }), null);

  assert.ok(!safeFileName('../../etc/passwd').includes('/'), 'no path separators survive, so a name can never escape its folder');
  assert.equal(safeFileName('../../etc/passwd'), '_.._etc_passwd');
  assert.equal(safeFileName('résumé (final).pdf'), 'resume_final_.pdf');
  assert.equal(safeFileName('   '), '_');
  assert.equal(safeFileName('.hidden'), 'hidden');
  assert.ok(safeFileName('a'.repeat(300) + '.pdf').length <= 80);
  const path = uploadPath('my-survey', 'CV final.pdf', 'fixed-id');
  assert.equal(path, 'my-survey/fixed-id/CV_final.pdf');
  assert.equal(path.split('/').length, 3, 'slug / id / file - the shape the bucket policy demands');
  assert.equal(fileNameOf(path), 'CV_final.pdf');
});

// ── Dynamic options ──────────────────────────────────────────────────────

const used: Question = { id: 'used', type: 'checkbox', label: 'Which do you use?', options: ['Email', 'Chat', 'Phone', 'Other'] };
const fav: Question = { id: 'fav', type: 'radio', label: 'Favourite?', options: ['(fallback)'], optionsFrom: { questionId: 'used', mode: 'selected' } };
const unused: Question = { id: 'unused', type: 'checkbox', label: 'Which would you try?', options: ['x'], optionsFrom: { questionId: 'used', mode: 'unselected' } };

test('carry-forward offers what was selected, or what was left unselected', () => {
  const all = [used, fav, unused];
  assert.deepEqual(resolveOptions(fav, { used: ['Chat', 'Email'] }, all), ['Email', 'Chat'], 'authored order, not click order');
  assert.deepEqual(resolveOptions(unused, { used: ['Chat', 'Email'] }, all), ['Phone', 'Other']);
  assert.deepEqual(resolveOptions(unused, {}, all), ['Email', 'Chat', 'Phone', 'Other'], 'nothing selected: everything is unselected');
  assert.deepEqual(resolveOptions(fav, {}, all), []);
  assert.deepEqual(resolveOptions({ ...fav, optionsFrom: { questionId: 'gone', mode: 'selected' } }, { used: ['Chat'] }, all), []);
});

test('a carry-forward question with nothing to offer is hidden, and its answer is not stored', () => {
  const def = wrap([used, fav]);
  const all = flatQuestions(def);
  assert.deepEqual(visibleQuestions(def.sections[0], {}, all).map(q => q.id), ['used']);
  assert.deepEqual(visibleQuestions(def.sections[0], { used: ['Chat'] }, all).map(q => q.id), ['used', 'fav']);
  assert.equal(buildRow(def, { used: [], fav: 'Chat' }).fav, null);
  assert.equal(buildRow(def, { used: ['Chat'], fav: 'Chat' }).fav, 'Chat');
});

test('a page whose only question is an empty carry-forward is skipped', () => {
  const def: SurveyDefinition = {
    ...wrap([]),
    sections: [
      { id: 's1', title: 'One', questions: [used] },
      { id: 's2', title: 'Two', questions: [fav] },
      { id: 's3', title: 'Three', questions: [{ id: 'z', type: 'text', label: 'Z' }] },
    ],
  };
  assert.deepEqual(sectionPath(def, { used: [] }), [0, 2]);
  assert.deepEqual(sectionPath(def, { used: ['Chat'] }), [0, 1, 2]);
  assert.equal(nextSectionIndex(def, 0, { used: [] }), 2);
});

test('a choice that stops being offered is refused at submit', () => {
  const all = [used, fav];
  assert.equal(validateAnswer(fav, 'Chat', { used: ['Chat'] }, all), null);
  assert.match(validateAnswer(fav, 'Phone', { used: ['Chat'] }, all) ?? '', /no longer available/);
  assert.ok(validateSection({ id: 's', title: 'S', questions: [used, fav] }, { used: ['Email'], fav: 'Chat' }, all).fav);
});

test('per-option display rules hide options whose rule fails, keep unruled ones, and refuse a hidden pick', () => {
  const region: Question = { id: 'region', type: 'radio', label: 'Region', options: ['North', 'South'] };
  const store: Question = {
    id: 'store', type: 'select', label: 'Store', options: ['Delhi', 'Chennai', 'Online'],
    optionLogic: { Delhi: { questionId: 'region', equals: ['North'] }, Chennai: { questionId: 'region', equals: ['South'] } },
  };
  const all = [region, store];
  assert.deepEqual(resolveOptions(store, { region: 'North' }, all), ['Delhi', 'Online']);
  assert.deepEqual(resolveOptions(store, { region: 'South' }, all), ['Chennai', 'Online']);
  assert.deepEqual(resolveOptions(store, {}, all), ['Online']);
  assert.match(validateAnswer(store, 'Chennai', { region: 'North' }, all) ?? '', /no longer available/);
  assert.equal(validateAnswer(store, 'Online', { region: 'North' }, all), null);
  // ranking must rank exactly what is on offer
  const rank: Question = { ...store, id: 'rank', type: 'ranking' } as Question;
  assert.equal(validateAnswer(rank, ['Delhi', 'Online'], { region: 'North' }, [region, rank]), null);
  assert.match(validateAnswer(rank, ['Delhi', 'Chennai', 'Online'], { region: 'North' }, [region, rank]) ?? '', /no longer available/);
});

test('builder validation: carry-forward and option rules must point at earlier questions', () => {
  const later: Question = { id: 'later', type: 'radio', label: 'Later', options: ['a', 'b'] };
  const early: Question = { id: 'early', type: 'radio', label: 'Early', options: ['x', 'y'], optionsFrom: { questionId: 'later', mode: 'selected' } };
  const msgs = validateSurveyStructure(wrap([early, later])).map(i => i.message).join('|');
  assert.match(msgs, /carries choices forward from "Later", which comes after it/);

  const ghost: Question = { id: 'g', type: 'radio', label: 'G', options: ['a', 'b'], optionsFrom: { questionId: 'nope', mode: 'selected' } };
  assert.match(validateSurveyStructure(wrap([ghost])).map(i => i.message).join('|'), /does not exist or has no options/);

  const rule: Question = { id: 'r', type: 'radio', label: 'R', options: ['a', 'b'], optionLogic: { a: { questionId: 'r', equals: ['a'] }, zzz: { questionId: 'x', equals: ['1'] } } };
  const m2 = validateSurveyStructure(wrap([{ id: 'x', type: 'text', label: 'X' }, rule])).map(i => i.message).join('|');
  assert.match(m2, /depend on itself/);
  assert.match(m2, /no longer one of its options/);
});

// ── Column safety and factory ────────────────────────────────────────────

test('two questions sharing a column prefix are a publish error', () => {
  const a: Question = { id: 'a', type: 'sum', label: 'A', rows: ['1', '2'], total: 10, columnPrefix: 'same' };
  const b: Question = { id: 'b', type: 'multitext', label: 'B', rows: ['1'], columnPrefix: 'same' };
  assert.match(validateSurveyStructure(wrap([a, b])).map(i => i.message).join('|'), /Two questions write to the column "same_01"/);
});

test('every new type can be created and converted, and a duplicate never shares columns', () => {
  const section = { id: 's1', title: 'S', questions: [] as Question[] };
  for (const type of QUESTION_TYPES) {
    const q = newQuestion(section, type);
    assert.equal(q.type, type);
    for (const other of QUESTION_TYPES) assert.equal(convertQuestion(q, other).type, other);
  }
  assert.equal(new Set(QUESTION_TYPES).size, QUESTION_TYPES.length);
  assert.ok(QUESTION_TYPES.includes('heading') && QUESTION_TYPES.includes('signature'));

  const def = wrap([sum]);
  const dup = duplicateQuestion(def, 0, 0);
  const cols = columnsFor(dup).map(c => c.name);
  assert.equal(new Set(cols).size, cols.length);
});

test('logic can read simple answers but not grids, files or headings', () => {
  for (const t of ['sum', 'multitext', 'heading', 'file', 'signature', 'matrix'] as const) assert.equal(hasStringAnswer(t), false, t);
  for (const t of ['fullname', 'phone', 'image', 'radio', 'nps'] as const) assert.equal(hasStringAnswer(t), true, t);
  assert.equal(hasOptions({ id: 'i', type: 'image', label: 'I', options: ['a'], images: [''] }), true);
});

test('translatable strings include rows and image labels; changing a sum to another type is refused once responses exist', () => {
  const strings = translatableStrings(wrap([sum, { id: 'i', type: 'image', label: 'Pick', options: ['Cat', 'Dog'], images: ['', ''] }]));
  for (const s of ['Ads', 'Events', 'Cat', 'Dog', 'Split 100']) assert.ok(strings.includes(s), s);

  const before = wrap([sum]);
  const after = wrap([{ id: 'budget', type: 'text', label: 'Split 100' }]);
  assert.ok(validateAdditive(before, after, true).some(i => i.severity === 'error'));
  // and reordering a sum's items is caught the way a matrix's rows are
  const reordered = wrap([{ ...sum, rows: ['Events', 'Ads', 'Tools'] } as Question]);
  assert.ok(validateAdditive(before, reordered, true).some(i => /moved|removed/.test(i.message)));
});
