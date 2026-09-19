/**
 * Tests for survey logic: rule evaluation, page routing (display + skip
 * logic), piping, validation, randomisation, and how the newer question types
 * map to database columns. Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, isEmptyAnswer, normalizeLogic, pipe, pipedQuestionIds, stripPipes } from '../Aspire-Survey/src/engine/logic.ts';
import {
  buildRow, columnsFor, firstSectionIndex, nextSectionIndex, sectionPath, sectionShown,
} from '../Aspire-Survey/src/engine/definition.ts';
import { validateAnswer, validateSection } from '../Aspire-Survey/src/engine/validation.ts';
import { newSeed, seededShuffle, shuffleOptions } from '../Aspire-Survey/src/engine/randomize.ts';
import { validateSurveyStructure } from '../Aspire-Survey/src/admin/builderValidation.ts';
import { questionColumns } from '../Aspire-Survey/src/admin/questionMeta.ts';
import { convertQuestion, newQuestion, QUESTION_TYPES } from '../Aspire-Survey/src/engine/questionFactory.ts';
import { deleteQuestion, deleteSection, duplicateQuestion } from '../Aspire-Survey/src/admin/builderOps.ts';
import { translatableStrings } from '../Aspire-Survey/src/engine/translatable.ts';
import { validateAdditive } from '../Aspire-Survey/src/engine/additive.ts';
import type { Answers, Question, SurveyDefinition } from '../Aspire-Survey/src/engine/types.ts';

// ── Rules ────────────────────────────────────────────────────────────────

test('the original {questionId, equals} shape is read as one equals rule', () => {
  const g = normalizeLogic({ questionId: 'a', equals: ['x', 'y'] });
  assert.deepEqual(g, { match: 'all', rules: [{ questionId: 'a', op: 'equals', value: ['x', 'y'] }] });
  assert.equal(evaluate({ questionId: 'a', equals: ['x', 'y'] }, { a: 'y' }), true);
  assert.equal(evaluate({ questionId: 'a', equals: ['x', 'y'] }, { a: 'z' }), false);
  // legacy behaviour: an unanswered source never satisfies an equals condition
  assert.equal(evaluate({ questionId: 'a', equals: ['x'] }, {}), false);
});

test('no logic, or a group with no rules, does not restrict', () => {
  assert.equal(evaluate(undefined, {}), true);
  assert.equal(evaluate({ match: 'all', rules: [] }, {}), true);
});

test('all / any grouping', () => {
  const rules = [
    { questionId: 'a', op: 'equals' as const, value: ['1'] },
    { questionId: 'b', op: 'equals' as const, value: ['2'] },
  ];
  assert.equal(evaluate({ match: 'all', rules }, { a: '1', b: '2' }), true);
  assert.equal(evaluate({ match: 'all', rules }, { a: '1', b: '9' }), false);
  assert.equal(evaluate({ match: 'any', rules }, { a: '1', b: '9' }), true);
  assert.equal(evaluate({ match: 'any', rules }, { a: '0', b: '9' }), false);
});

test('numeric comparisons read the answer as a number, not text', () => {
  const rule = (op: 'gt' | 'gte' | 'lt' | 'lte', v: string) => ({ match: 'all' as const, rules: [{ questionId: 'n', op, value: [v] }] });
  // "10" > "9" is false as text, true as a number - the bug this guards against
  assert.equal(evaluate(rule('gt', '9'), { n: '10' }), true);
  assert.equal(evaluate(rule('gte', '10'), { n: '10' }), true);
  assert.equal(evaluate(rule('lt', '10'), { n: '10' }), false);
  assert.equal(evaluate(rule('lte', '6'), { n: '6' }), true);
  assert.equal(evaluate(rule('gt', '6'), { n: 'abc' }), false);
  assert.equal(evaluate(rule('gt', '6'), {}), false);
});

test('dates compare as ISO dates', () => {
  const r = { match: 'all' as const, rules: [{ questionId: 'd', op: 'lt' as const, value: ['2026-06-01'] }] };
  assert.equal(evaluate(r, { d: '2026-05-31' }), true);
  assert.equal(evaluate(r, { d: '2026-06-01' }), false);
});

test('contains works on a selected option and on text (case-insensitive)', () => {
  const some = (q: string, op: 'contains' | 'notContains', v: string) => ({ match: 'all' as const, rules: [{ questionId: q, op, value: [v] }] });
  assert.equal(evaluate(some('c', 'contains', 'B'), { c: ['A', 'B'] }), true);
  assert.equal(evaluate(some('c', 'notContains', 'B'), { c: ['A', 'B'] }), false);
  assert.equal(evaluate(some('c', 'contains', 'B'), { c: ['A'] }), false);
  assert.equal(evaluate(some('t', 'contains', 'pay'), { t: 'Poor PAYMENT terms' }), true);
  // a substring is not an option match
  assert.equal(evaluate(some('c', 'contains', 'Bo'), { c: ['Bob'] }), false);
});

test('answered / not answered, including empty selections and blank strings', () => {
  const a = (op: 'answered' | 'notAnswered') => ({ match: 'all' as const, rules: [{ questionId: 'q', op }] });
  assert.equal(evaluate(a('answered'), { q: 'x' }), true);
  assert.equal(evaluate(a('answered'), { q: '  ' }), false);
  assert.equal(evaluate(a('answered'), { q: [] }), false);
  assert.equal(evaluate(a('notAnswered'), {}), true);
  assert.equal(isEmptyAnswer({ r1: '', r2: '' }), true);
  assert.equal(isEmptyAnswer({ r1: '3' }), false);
});

test('notEquals is true when the question is unanswered, false when it matches', () => {
  const r = { match: 'all' as const, rules: [{ questionId: 'a', op: 'notEquals' as const, value: ['x'] }] };
  assert.equal(evaluate(r, {}), true);
  assert.equal(evaluate(r, { a: 'x' }), false);
  assert.equal(evaluate(r, { a: 'y' }), true);
});

test('a matrix answer never satisfies a comparison', () => {
  const r = { match: 'all' as const, rules: [{ questionId: 'm', op: 'equals' as const, value: ['3'] }] };
  assert.equal(evaluate(r, { m: { row: '3' } }), false);
});

// ── Piping ───────────────────────────────────────────────────────────────

test('piping substitutes an earlier answer, uses a fallback, and joins multi-select', () => {
  assert.equal(pipe('Hi {{answer:name}}!', { name: 'Asha' }), 'Hi Asha!');
  assert.equal(pipe('Hi {{answer:name|there}}!', {}), 'Hi there!');
  assert.equal(pipe('Hi {{answer:name}}!', {}), 'Hi !');
  assert.equal(pipe('You picked {{answer:c}}.', { c: ['A', 'B'] }), 'You picked A, B.');
  assert.equal(pipe('No placeholders', { name: 'x' }), 'No placeholders');
  assert.deepEqual(pipedQuestionIds('{{answer:a}} and {{ answer:b|x }}'), ['a', 'b']);
  assert.equal(stripPipes('You rated us {{answer:csat|-}} out of 5'), 'You rated us [earlier answer] out of 5');
  assert.equal(stripPipes('plain'), 'plain');
});

// ── Routing ──────────────────────────────────────────────────────────────

function routed(): SurveyDefinition {
  return {
    slug: 'r', title: 'R',
    welcome: { heading: 'h', body: [] },
    thankYou: { heading: 't', body: 'b' },
    sections: [
      {
        id: 's1', title: 'One',
        questions: [{ id: 'employed', type: 'yesno', label: 'Employed?', required: true }],
        jumps: [{ when: { questionId: 'employed', equals: ['No'] }, to: 's4' }],
      },
      { id: 's2', title: 'Work', questions: [{ id: 'role', type: 'text', label: 'Role' }] },
      {
        id: 's3', title: 'Managers', showIf: { questionId: 'role', equals: ['Manager'] },
        questions: [{ id: 'team', type: 'number', label: 'Team size' }],
      },
      { id: 's4', title: 'Feedback', questions: [{ id: 'nps', type: 'nps', label: 'Recommend?' }] },
    ],
  };
}

test('a matching skip rule jumps forward; otherwise the survey continues in order', () => {
  const def = routed();
  assert.deepEqual(sectionPath(def, { employed: 'No' }), [0, 3]);
  assert.deepEqual(sectionPath(def, { employed: 'Yes', role: 'Engineer' }), [0, 1, 3]);
  assert.deepEqual(sectionPath(def, { employed: 'Yes', role: 'Manager' }), [0, 1, 2, 3]);
});

test('a page display rule hides the whole page', () => {
  const def = routed();
  assert.equal(sectionShown(def.sections[2], { role: 'Engineer' }), false);
  assert.equal(sectionShown(def.sections[2], { role: 'Manager' }), true);
});

test("'end' finishes the survey and backward or unknown jumps are ignored (no loops)", () => {
  const def = routed();
  def.sections[0].jumps = [{ when: { match: 'all', rules: [] }, to: 'end' }];
  assert.deepEqual(sectionPath(def, {}), [0]);
  assert.equal(nextSectionIndex(def, 0, {}), def.sections.length);

  def.sections[1].jumps = [{ when: { match: 'all', rules: [] }, to: 's1' }, { when: { match: 'all', rules: [] }, to: 'nowhere' }];
  def.sections[0].jumps = undefined;
  assert.deepEqual(sectionPath(def, {}), [0, 1, 3]);
});

test('the first matching jump wins', () => {
  const def = routed();
  def.sections[0].jumps = [
    { when: { questionId: 'employed', equals: ['No'] }, to: 's3' },
    { when: { questionId: 'employed', equals: ['No'] }, to: 's4' },
  ];
  // s3 is hidden (role empty), so routing continues past it to s4
  assert.deepEqual(sectionPath(def, { employed: 'No' }), [0, 3]);
});

test('a page whose questions are all hidden is skipped', () => {
  const def = routed();
  def.sections[1].questions = [{ id: 'role', type: 'text', label: 'Role', showIf: { questionId: 'employed', equals: ['Yes'] } }];
  assert.deepEqual(sectionPath(def, { employed: 'No' }), [0, 3]);
  assert.equal(firstSectionIndex(def, {}), 0);
});

test('answers from pages the respondent was routed past are not written', () => {
  const def = routed();
  const answers: Answers = { employed: 'No', role: 'Manager', team: '9', nps: '10' };
  const row = buildRow(def, answers);
  assert.equal(row.employed, 'No');
  assert.equal(row.role, null, 'skipped page must not leave a stale answer');
  assert.equal(row.team, null);
  assert.equal(row.nps, '10');
});

// ── Validation ───────────────────────────────────────────────────────────

const q = <T extends Question>(x: T) => x;

test('required, and blank optional answers are always fine', () => {
  assert.match(validateAnswer(q({ id: 'a', type: 'text', label: 'A', required: true }), '  ', {}) ?? '', /required/);
  assert.equal(validateAnswer(q({ id: 'a', type: 'number', label: 'A', min: 5 }), undefined, {}), null);
});

test('text length and pattern', () => {
  const t = q({ id: 't', type: 'text', label: 'T', minLength: 3, maxLength: 5, pattern: '[A-Z]{3,5}', patternMessage: 'Capitals only' });
  assert.match(validateAnswer(t, 'AB', {}) ?? '', /at least 3/);
  assert.match(validateAnswer(t, 'ABCDEFG', {}) ?? '', /5 characters/);
  assert.equal(validateAnswer(t, 'abcd', {}), 'Capitals only');
  assert.equal(validateAnswer(t, 'ABCD', {}), null);
  // an invalid author pattern never traps a respondent
  assert.equal(validateAnswer(q({ id: 't', type: 'text', label: 'T', pattern: '(' }), 'x', {}), null);
});

test('email, number, date', () => {
  assert.equal(validateAnswer(q({ id: 'e', type: 'email', label: 'E' }), 'a@b.co', {}), null);
  assert.ok(validateAnswer(q({ id: 'e', type: 'email', label: 'E' }), 'a@b', {}));
  const n = q({ id: 'n', type: 'number', label: 'N', min: 1, max: 10, integer: true });
  assert.ok(validateAnswer(n, '0', {}));
  assert.ok(validateAnswer(n, '11', {}));
  assert.ok(validateAnswer(n, '2.5', {}));
  assert.ok(validateAnswer(n, 'abc', {}));
  assert.equal(validateAnswer(n, '10', {}), null);
  const d = q({ id: 'd', type: 'date', label: 'D', min: '2026-01-01', max: '2026-12-31' });
  assert.equal(validateAnswer(d, '2026-06-15', {}), null);
  assert.ok(validateAnswer(d, '2025-12-31', {}));
  assert.ok(validateAnswer(d, '2026-02-30', {}), 'a date that does not exist is rejected');
});

test('rating, nps, slider, yes/no bounds', () => {
  assert.equal(validateAnswer(q({ id: 'r', type: 'rating', label: 'R', max: 5 }), '5', {}), null);
  assert.ok(validateAnswer(q({ id: 'r', type: 'rating', label: 'R', max: 5 }), '6', {}));
  assert.equal(validateAnswer(q({ id: 'n', type: 'nps', label: 'N' }), '0', {}), null);
  assert.ok(validateAnswer(q({ id: 'n', type: 'nps', label: 'N' }), '11', {}));
  assert.ok(validateAnswer(q({ id: 's', type: 'slider', label: 'S', min: 0, max: 10 }), '11', {}));
  assert.ok(validateAnswer(q({ id: 'y', type: 'yesno', label: 'Y' }), 'Maybe', {}));
});

test('checkbox min/max selections and ranking completeness', () => {
  const c = q({ id: 'c', type: 'checkbox', label: 'C', options: ['a', 'b', 'c'], minSelections: 2, maxSelections: 2 });
  assert.ok(validateAnswer(c, ['a'], {}));
  assert.equal(validateAnswer(c, ['a', 'b'], {}), null);
  assert.ok(validateAnswer(c, ['a', 'b', 'c'], {}));
  const r = q({ id: 'r', type: 'ranking', label: 'R', options: ['x', 'y', 'z'] });
  assert.ok(validateAnswer(r, ['x', 'y'], {}));
  assert.ok(validateAnswer(r, ['x', 'y', 'y'], {}));
  assert.equal(validateAnswer(r, ['z', 'x', 'y'], {}), null);
});

test('hidden questions never block, and a partly-filled optional matrix is flagged', () => {
  const section = {
    id: 's', title: 'S',
    questions: [
      q({ id: 'a', type: 'text', label: 'A' }),
      q({ id: 'b', type: 'text', label: 'B', required: true, showIf: { questionId: 'a', equals: ['show'] } }),
      q({ id: 'm', type: 'matrix', label: 'M', rows: ['r1', 'r2'], scale: ['1', '2'], columnPrefix: 'm' }),
    ],
  };
  assert.deepEqual(validateSection(section, { a: 'nope' }), {});
  assert.ok(validateSection(section, { a: 'show' }).b);
  assert.ok(validateSection(section, { m: { r1: '1' } }).m);
  assert.deepEqual(validateSection(section, { m: { r1: '1', r2: '2' } }), {});
});

// ── Randomisation ────────────────────────────────────────────────────────

test('shuffling is stable for one seed, differs across seeds, and keeps every item', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  assert.deepEqual(seededShuffle(items, 42, 'q1'), seededShuffle(items, 42, 'q1'));
  assert.notDeepEqual(seededShuffle(items, 42, 'q1'), seededShuffle(items, 43, 'q1'));
  assert.deepEqual([...seededShuffle(items, 7, 'q')].sort(), items);
  assert.deepEqual(items, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'input is not mutated');
  assert.equal(typeof newSeed(), 'number');
});

test('"Other" and "None of the above" stay last when options are shuffled', () => {
  for (let seed = 0; seed < 25; seed++) {
    const out = shuffleOptions(['A', 'B', 'C', 'Other', 'None of the above'], seed, 'q');
    assert.deepEqual(out.slice(-2), ['Other', 'None of the above']);
    assert.equal(out.length, 5);
  }
});

// ── Storage ──────────────────────────────────────────────────────────────

function typed(): SurveyDefinition {
  return {
    slug: 't', title: 'T',
    welcome: { heading: 'h', body: [] },
    thankYou: { heading: 't', body: 'Thanks {{answer:name|friend}}' },
    sections: [{
      id: 's', title: 'S',
      questions: [
        { id: 'name', type: 'text', label: 'Name' },
        { id: 'rate', type: 'rating', label: 'Rate', max: 5 },
        { id: 'nps', type: 'nps', label: 'NPS' },
        { id: 'yn', type: 'yesno', label: 'YN' },
        { id: 'age', type: 'number', label: 'Age' },
        { id: 'dob', type: 'date', label: 'DOB' },
        { id: 'mail', type: 'email', label: 'Mail' },
        { id: 'sl', type: 'slider', label: 'Slider' },
        { id: 'rank', type: 'ranking', label: 'Rank', options: ['a', 'b', 'c'] },
      ],
    }],
  };
}

test('new types map to the right physical column types', () => {
  const cols = Object.fromEntries(columnsFor(typed()).map(c => [c.name, c.type]));
  assert.equal(cols.rank, 'text[]');
  for (const k of ['name', 'rate', 'nps', 'yn', 'age', 'dob', 'mail', 'sl']) assert.equal(cols[k], 'text', k);
});

test('buildRow writes scalars as text and a ranking as an ordered array', () => {
  const row = buildRow(typed(), { name: 'A', rate: '4', nps: '9', yn: 'Yes', age: '31', rank: ['c', 'a', 'b'] });
  assert.equal(row.rate, '4');
  assert.equal(row.nps, '9');
  assert.equal(row.age, '31');
  assert.equal(row.dob, null);
  assert.deepEqual(row.rank, ['c', 'a', 'b']);
  assert.deepEqual(buildRow(typed(), {}).rank, [], 'unanswered ranking is an empty array, not null (NOT NULL text[])');
});

test('analysis kinds for the new types; email is never aggregated', () => {
  const kinds = Object.fromEntries(questionColumns(typed()).map(c => [c.column, c.kind]));
  assert.deepEqual(kinds, {
    name: 'text', rate: 'rating', nps: 'nps', yn: 'choice', age: 'numeric',
    dob: 'text', mail: 'identifier', sl: 'numeric', rank: 'ranking',
  });
});

test('changing a ranking to a text question needs a different column and is refused when responses exist', () => {
  const prev = typed();
  const next = typed();
  next.sections[0].questions = next.sections[0].questions.map(x => (x.id === 'rank' ? { id: 'rank', type: 'text', label: 'Rank' } : x));
  assert.ok(validateAdditive(prev, next, true).some(i => i.severity === 'error' && i.subject === 'rank'));
});

// ── Factory & builder integrity ─────────────────────────────────────────

test('every type in the picker can be created, converted to and from, and passes structural validation', () => {
  const section = { id: 's1', title: 'S', questions: [] as Question[] };
  for (const type of QUESTION_TYPES) {
    const made = newQuestion(section, type);
    assert.equal(made.type, type);
    for (const other of QUESTION_TYPES) assert.equal(convertQuestion(made, other).type, other);
  }
  assert.equal(new Set(QUESTION_TYPES).size, QUESTION_TYPES.length);
});

test('builder validation: bad limits, bad rules, bad jumps and bad pipes are errors', () => {
  const def = routed();
  def.sections[1].questions = [
    { id: 'age', type: 'number', label: 'Age', min: 10, max: 1 },
    { id: 'sl', type: 'slider', label: 'Slider', min: 5, max: 5 },
    { id: 'rt', type: 'rating', label: 'Rate', max: 20 },
    { id: 'rk', type: 'ranking', label: 'Rank', options: ['only'] },
    { id: 'pt', type: 'text', label: 'Pipes {{answer:ghost}}' },
    { id: 'lt', type: 'text', label: 'Later {{answer:nps}}' },
    { id: 'cmp', type: 'text', label: 'C', showIf: { match: 'all', rules: [{ questionId: 'role_txt', op: 'gt', value: ['x'] }] } },
  ];
  def.sections[0].jumps = [{ when: { questionId: 'employed', equals: ['No'] }, to: 'gone' }];
  def.sections[3].jumps = [{ when: { questionId: 'nps', equals: ['1'] }, to: 's1' }];
  const msgs = validateSurveyStructure(def).map(i => i.message).join('\n');
  assert.match(msgs, /minimum above its maximum/);
  assert.match(msgs, /needs a maximum above its minimum/);
  assert.match(msgs, /between 3 and 10/);
  assert.match(msgs, /at least two options to rank/);
  assert.match(msgs, /pipes in an answer from "ghost"/);
  assert.match(msgs, /pipes in "Recommend\?".*comes after/);
  assert.match(msgs, /goes to a page that no longer exists/);
  assert.match(msgs, /goes backwards/);
});

test('builder validation: comparison rules need a numeric source and a numeric value', () => {
  const def = routed();
  def.sections[1].questions = [
    { id: 'role', type: 'text', label: 'Role' },
    { id: 'x', type: 'text', label: 'X', showIf: { match: 'all', rules: [{ questionId: 'role', op: 'gt', value: ['5'] }] } },
    { id: 'y', type: 'text', label: 'Y', showIf: { match: 'all', rules: [{ questionId: 'employed', op: 'equals', value: ['Maybe'] }] } },
    { id: 'z', type: 'text', label: 'Z', showIf: { match: 'all', rules: [{ questionId: 'employed', op: 'equals', value: [] }] } },
  ];
  const msgs = validateSurveyStructure(def).map(i => i.message).join('\n');
  assert.match(msgs, /not a number, rating, score, slider or date/);
  assert.match(msgs, /options? "Maybe".*no longer exist/);
  assert.match(msgs, /no value to compare against/);
});

test('a well-formed survey using every new feature is publishable', () => {
  const issues = validateSurveyStructure(routed()).filter(i => i.severity === 'error');
  assert.deepEqual(issues, []);
  assert.deepEqual(validateSurveyStructure(typed()).filter(i => i.severity === 'error'), []);
});

test('deleting a question or page cleans up every rule that pointed at it', () => {
  const def = routed();
  const afterQ = deleteQuestion(def, 0, 0); // 'employed'
  assert.equal(afterQ.sections[0].jumps?.length, 0);

  const withRule = routed();
  withRule.sections[3].questions = [];
  const afterSection = deleteSection(withRule, 3);
  assert.equal(afterSection.sections[0].jumps?.length, 0, 'jump to the deleted page is removed');
});

test('duplicating a matrix gives the copy its own column prefix', () => {
  const def: SurveyDefinition = {
    slug: 'm', title: 'M', welcome: { heading: 'h', body: [] }, thankYou: { heading: 't', body: 'b' },
    sections: [{ id: 's', title: 'S', questions: [{ id: 'grid', type: 'matrix', label: 'G', rows: ['r'], scale: ['a'], columnPrefix: 'grid' }] }],
  };
  const dup = duplicateQuestion(def, 0, 0);
  const prefixes = dup.sections[0].questions.map(x => (x.type === 'matrix' ? x.columnPrefix : ''));
  assert.equal(new Set(prefixes).size, 2);
  const cols = columnsFor(dup).map(c => c.name);
  assert.equal(new Set(cols).size, cols.length, 'no two questions write to the same column');
});

test('every respondent-facing string of the new types is offered for translation', () => {
  const def = typed();
  def.sections[0].questions.push(
    { id: 'r2', type: 'rating', label: 'R2', lowLabel: 'Poor', highLabel: 'Great' },
    { id: 'y2', type: 'yesno', label: 'Y2', yesLabel: 'Sure', noLabel: 'Nope' },
    { id: 'n2', type: 'number', label: 'N2', unit: 'years', placeholder: 'e.g. 5' },
    { id: 't2', type: 'text', label: 'T2', pattern: '\\d+', patternMessage: 'Digits only' },
  );
  const strings = translatableStrings(def);
  for (const expected of ['Poor', 'Great', 'Sure', 'Nope', 'years', 'e.g. 5', 'Digits only', 'a', 'b', 'c']) {
    assert.ok(strings.includes(expected), expected);
  }
});

// ── NPS / rating arithmetic ─────────────────────────────────────────────

import { fillScale, meanFromDistribution, npsFromDistribution } from '../Aspire-Survey/src/admin/npsMath.ts';

test('NPS is promoters minus detractors as a share of all answers; passives only dilute', () => {
  const r = npsFromDistribution([
    { value: '10', n: 4 }, { value: '9', n: 2 }, { value: '8', n: 3 }, { value: '7', n: 1 },
    { value: '6', n: 2 }, { value: '0', n: 1 },
  ]);
  assert.deepEqual([r.promoters, r.passives, r.detractors, r.total], [6, 4, 3, 13]);
  assert.equal(r.score, 23.1); // (6-3)/13
  assert.equal(npsFromDistribution([]).score, null);
  // values outside 0-10 or non-integers are not scores
  assert.equal(npsFromDistribution([{ value: '11', n: 5 }, { value: 'x', n: 5 }, { value: '5.5', n: 5 }]).total, 0);
});

test('mean and scale filling ignore junk and keep zero-count steps in order', () => {
  assert.equal(meanFromDistribution([{ value: '1', n: 1 }, { value: '5', n: 3 }, { value: 'n/a', n: 9 }]), 4);
  assert.equal(meanFromDistribution([]), null);
  assert.deepEqual(fillScale([{ value: '2', n: 3 }], 1, 3), [
    { value: '1', n: 0 }, { value: '2', n: 3 }, { value: '3', n: 0 },
  ]);
});
