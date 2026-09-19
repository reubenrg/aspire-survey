/**
 * Tests for Admin V2 Sprint 3: Builder V2's structural operations and
 * publish-time validation. Run with `npm test`.
 *
 * What autosave's optimistic-concurrency guard, draft/published isolation,
 * version creation on publish and the analyst-cannot-mutate RLS boundary
 * actually guarantee lives in the database, not in JavaScript - those were
 * proven directly against the real project this session (see the session's
 * SQL proof), the same way Sprint 2's privacy proof was. What belongs here
 * is the pure logic: the structural edit operations (builderOps.ts, the
 * actual functions the Builder's buttons call, not a reimplementation of
 * them) and the validation layer that gates Preview/Publish.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ops from '../Aspire-Survey/src/admin/builderOps.ts';
import { validateSurveyStructure, isPublishable, newSectionId } from '../Aspire-Survey/src/admin/builderValidation.ts';
import { duplicateTitle, duplicateSlug } from '../Aspire-Survey/src/admin/duplication.ts';
import { newQuestion, convertQuestion, hasStringAnswer } from '../Aspire-Survey/src/engine/questionFactory.ts';
import type { SurveyDefinition } from '../Aspire-Survey/src/engine/types';

function baseDef(): SurveyDefinition {
  return {
    slug: 'test-survey',
    title: 'Test Survey',
    uniqueBy: 'employeeId',
    welcome: { heading: 'Hi', body: ['Welcome'] },
    thankYou: { heading: 'Thanks', body: 'Done' },
    sections: [
      {
        id: 'sec1', title: 'Section One',
        questions: [
          { id: 'employeeId', type: 'text', label: 'Employee ID', required: true },
          { id: 'q1', type: 'radio', label: 'Pick one', options: ['A', 'B'] },
        ],
      },
      { id: 'sec2', title: 'Section Two', questions: [] },
    ],
  };
}

// ── Section operations ───────────────────────────────────────────────────

test('add section appends with a unique id and selectable title', () => {
  const def = ops.addSection(baseDef());
  assert.equal(def.sections.length, 3);
  assert.equal(def.sections[2].id, 'section_3');
  assert.equal(def.sections[2].questions.length, 0);
});

test('newSectionId skips ids already in use', () => {
  const def = baseDef();
  def.sections.push({ id: 'section_3', title: 'x', questions: [] });
  assert.equal(newSectionId(def.sections), 'section_4');
});

test('move section reorders and is a no-op past either end', () => {
  const def = baseDef();
  const moved = ops.moveSection(def, 1, -1);
  assert.deepEqual(moved.sections.map(s => s.id), ['sec2', 'sec1']);

  const noop = ops.moveSection(def, 0, -1);
  assert.deepEqual(noop.sections.map(s => s.id), def.sections.map(s => s.id));
});

test('duplicate section copies its questions with fresh ids and no conditions', () => {
  const def = ops.duplicateSection(baseDef(), 0);
  assert.equal(def.sections.length, 3);
  const copy = def.sections[1];
  assert.equal(copy.title, 'Section One (copy)');
  assert.equal(copy.questions.length, 2);
  assert.notEqual(copy.questions[0].id, 'employeeId');
  assert.equal(copy.questions.every(q => q.showIf === undefined), true);
});

test('delete section removes only an empty one', () => {
  const def = baseDef();
  const blocked = ops.deleteSection(def, 0); // has questions
  assert.equal(blocked.sections.length, 2);

  const removed = ops.deleteSection(def, 1); // empty
  assert.equal(removed.sections.length, 1);
});

// ── Question operations ──────────────────────────────────────────────────

test('add question appends a question of the requested type to the section', () => {
  const def = ops.addQuestion(baseDef(), 1, 'checkbox');
  assert.equal(def.sections[1].questions.length, 1);
  assert.equal(def.sections[1].questions[0].type, 'checkbox');
});

test('reorder question moves within its section and is a no-op past either end', () => {
  const def = baseDef();
  const moved = ops.moveQuestion(def, 0, 0, 1);
  assert.deepEqual(moved.sections[0].questions.map(q => q.id), ['q1', 'employeeId']);

  const noop = ops.moveQuestion(def, 0, 0, -1);
  assert.deepEqual(noop.sections[0].questions.map(q => q.id), def.sections[0].questions.map(q => q.id));
});

test('moving a question between sections removes it from the old one, adds it to the new one, and clears its condition', () => {
  const def = baseDef();
  def.sections[0].questions[1] = { ...def.sections[0].questions[1], showIf: { questionId: 'employeeId', equals: ['x'] } };
  const moved = ops.moveQuestionToSection(def, 0, 1, 1);
  assert.equal(moved.sections[0].questions.length, 1);
  assert.equal(moved.sections[1].questions.length, 1);
  assert.equal(moved.sections[1].questions[0].id, 'q1');
  assert.equal(moved.sections[1].questions[0].showIf, undefined);
});

test('duplicate question inserts a copy right after the original with a new id', () => {
  const def = ops.duplicateQuestion(baseDef(), 0, 1);
  assert.equal(def.sections[0].questions.length, 3);
  assert.equal(def.sections[0].questions[2].label, 'Pick one');
  assert.notEqual(def.sections[0].questions[2].id, 'q1');
});

test('delete question removes it and clears any condition elsewhere that depended on it', () => {
  const def = baseDef();
  def.sections[1].questions.push({ id: 'q2', type: 'text', label: 'Depends', showIf: { questionId: 'q1', equals: ['A'] } });
  const next = ops.deleteQuestion(def, 0, 1); // removes q1
  assert.equal(next.sections[0].questions.length, 1);
  const dependant = next.sections[1].questions.find(q => q.id === 'q2');
  assert.equal(dependant?.showIf, undefined);
});

// ── Question type conversion ─────────────────────────────────────────────

test('converting to a choice type keeps existing options; converting away drops them', () => {
  const text = newQuestion({ id: 's', title: '', questions: [] }, 'text');
  const asRadio = convertQuestion(text, 'radio');
  assert.deepEqual('options' in asRadio ? asRadio.options : null, ['Option one', 'Option two']);
  const backToText = convertQuestion(asRadio, 'text');
  assert.equal('options' in backToText, false);
});

// Widened deliberately when the rule engine gained operators (contains,
// greater-than, answered...): every type except a matrix now has a single
// comparable answer. A matrix answers many things at once and still cannot be
// a condition's source.
test('every question type except a matrix can be the source of a condition', () => {
  for (const type of ['text', 'textarea', 'select', 'radio', 'checkbox', 'rating', 'nps', 'yesno', 'number', 'date', 'email', 'slider', 'ranking'] as const) {
    assert.equal(hasStringAnswer(type), true, type);
  }
  assert.equal(hasStringAnswer('matrix'), false);
});

// ── Publish-time structural validation ───────────────────────────────────

test('a survey with no questions is not publishable', () => {
  const def = baseDef();
  def.sections = [{ id: 's', title: 'Empty', questions: [] }];
  const issues = validateSurveyStructure(def);
  assert.equal(isPublishable(issues), false);
  assert.ok(issues.some(i => /no questions/.test(i.message)));
});

test('a blank question label is flagged', () => {
  const def = baseDef();
  def.sections[0].questions[1].label = '  ';
  const issues = validateSurveyStructure(def);
  assert.equal(isPublishable(issues), false);
});

test('a choice question with no options is flagged', () => {
  const def = baseDef();
  (def.sections[0].questions[1] as { options: string[] }).options = [];
  const issues = validateSurveyStructure(def);
  assert.ok(issues.some(i => i.subject === 'q1' && /no options/.test(i.message)));
});

test('an invalid max-selection count is flagged, including more than there are options', () => {
  const def = baseDef();
  def.sections[0].questions.push({ id: 'multi', type: 'checkbox', label: 'Pick', options: ['A', 'B'], maxSelections: 5 });
  const issues = validateSurveyStructure(def);
  assert.ok(issues.some(i => i.subject === 'multi' && /up to 5/.test(i.message)));
});

test('duplicate internal ids across the survey are flagged', () => {
  const def = baseDef();
  def.sections[1].questions.push({ id: 'q1', type: 'text', label: 'Clash' });
  const issues = validateSurveyStructure(def);
  assert.ok(issues.some(i => /share the answer key "q1"/.test(i.message)));
});

test('a self-referencing condition is flagged', () => {
  const def = baseDef();
  def.sections[0].questions[1] = { ...def.sections[0].questions[1], showIf: { questionId: 'q1', equals: ['A'] } };
  const issues = validateSurveyStructure(def);
  assert.ok(issues.some(i => i.subject === 'q1' && /depend on itself/.test(i.message)));
});

test('a condition pointing at a deleted/missing source question is flagged', () => {
  const def = baseDef();
  def.sections[1].questions.push({ id: 'q2', type: 'text', label: 'Depends', showIf: { questionId: 'ghost', equals: ['x'] } });
  const issues = validateSurveyStructure(def);
  assert.ok(issues.some(i => i.subject === 'q2' && /no longer exists/.test(i.message)));
});

test('a condition checking for a deleted option on its source question is flagged', () => {
  const def = baseDef();
  def.sections[1].questions.push({ id: 'q2', type: 'text', label: 'Depends', showIf: { questionId: 'q1', equals: ['C'] } });
  const issues = validateSurveyStructure(def);
  assert.ok(issues.some(i => i.subject === 'q2' && /no longer exist/.test(i.message)));
});

test('a condition depending on a matrix question is flagged, but a checkbox source is now valid', () => {
  const def = baseDef();
  def.sections[0].questions[1] = { id: 'q1', type: 'matrix', label: 'Grid', rows: ['r'], scale: ['a'], columnPrefix: 'q1' };
  def.sections[1].questions.push({ id: 'q2', type: 'text', label: 'Depends', showIf: { questionId: 'q1', equals: ['A'] } });
  const issues = validateSurveyStructure(def);
  assert.ok(issues.some(i => i.subject === 'q2' && /Conditions cannot read a matrix/.test(i.message)));

  const ok = baseDef();
  ok.sections[0].questions[1] = { id: 'q1', type: 'checkbox', label: 'Pick', options: ['A', 'B'] };
  ok.sections[1].questions.push({ id: 'q2', type: 'text', label: 'Depends', showIf: { questionId: 'q1', equals: ['A'] } });
  assert.equal(validateSurveyStructure(ok).some(i => i.subject === 'q2'), false);
});

test('a malformed matrix (no rows, no scale, or no column prefix) is flagged', () => {
  const def = baseDef();
  def.sections[1].questions.push({ id: 'm1', type: 'matrix', label: 'Grid', rows: [], scale: [], columnPrefix: '' });
  const issues = validateSurveyStructure(def);
  const subjects = issues.filter(i => i.subject === 'm1').map(i => i.message);
  assert.ok(subjects.some(m => /no statements/.test(m)));
  assert.ok(subjects.some(m => /no scale/.test(m)));
  assert.ok(subjects.some(m => /no column prefix/.test(m)));
});

test('a well-formed survey with no conditions is publishable', () => {
  const issues = validateSurveyStructure(baseDef());
  assert.equal(isPublishable(issues), true);
});

// ── Duplicate survey naming (Part 25: excludes responses/invitations by construction — see duplication.ts) ──

test('duplicating a survey appends "(copy)" to the title and derives a slug from it', () => {
  assert.equal(duplicateTitle('Engagement Pulse'), 'Engagement Pulse (copy)');
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  assert.equal(duplicateSlug('Engagement Pulse', 'engagement-pulse', slugify), 'engagement-pulse-copy');
});

test('duplicating a survey with a slug-unfriendly title still falls back to a usable slug', () => {
  const slugify = () => ''; // simulates a title that slugifies to nothing
  assert.equal(duplicateSlug('★★★', 'original-slug', slugify), 'original-slug-copy');
});
