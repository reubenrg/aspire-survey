/** Tests for turning untrusted AI output into a safe survey definition. Run with `npm test`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonObject, sanitizeGeneratedDefinition } from '../Aspire-Survey/src/engine/aiDefinition.ts';
import { validateSurveyStructure } from '../Aspire-Survey/src/admin/builderValidation.ts';

const ok = (raw: unknown) => {
  const r = sanitizeGeneratedDefinition(raw);
  assert.ok(!('error' in r), 'error' in r ? r.error : '');
  return r as Exclude<typeof r, { error: string }>;
};

test('JSON is found inside prose and code fences, and braces inside strings do not confuse it', () => {
  assert.deepEqual(extractJsonObject('Here you go:\n```json\n{"a": 1, "b": {"c": "}"}}\n```\nEnjoy'), { a: 1, b: { c: '}' } });
  assert.deepEqual(extractJsonObject('{"a":"say \\"hi\\" {"}'), { a: 'say "hi" {' });
  assert.equal(extractJsonObject('no json here'), null);
  assert.equal(extractJsonObject('{"unterminated": '), null);
});

test('a well-formed draft becomes a valid definition', () => {
  const { definition, dropped } = ok({
    title: 'Safety pulse', welcome: { heading: 'Hello', body: ['Short survey.'] }, thankYou: { heading: 'Thanks', body: 'Done.' },
    sections: [{ id: 'Safety', title: 'Safety', questions: [
      { id: 'Feel Safe', type: 'rating', label: 'Do you feel safe?', required: true, max: 7, shape: 'star' },
      { id: 'concerns', type: 'checkbox', label: 'Any concerns?', options: ['Lighting', 'Equipment', 'Other'] },
      { id: 'grid', type: 'matrix', label: 'Rate', rows: ['A', 'B'], scale: ['Bad', 'OK', 'Good'] },
      { id: 'why', type: 'textarea', label: 'Tell us more', maxLength: 500 },
    ] }],
  });
  assert.equal(dropped.length, 0);
  assert.equal(definition.slug, 'safety-pulse');
  assert.deepEqual(definition.sections[0].questions.map(q => q.id), ['feel_safe', 'concerns', 'grid', 'why']);
  assert.equal(validateSurveyStructure(definition).filter(i => i.severity === 'error').length, 0);
});

test('unknown types, uploads, signatures and personal-data types are never drafted', () => {
  const { definition, dropped } = ok({
    title: 'T', sections: [{ id: 's', title: 'S', questions: [
      { id: 'a', type: 'text', label: 'Fine' },
      { id: 'b', type: 'file', label: 'Upload your ID' },
      { id: 'c', type: 'signature', label: 'Sign' },
      { id: 'd', type: 'email', label: 'Your email' },
      { id: 'e', type: 'fullname', label: 'Your name' },
      { id: 'f', type: 'javascript', label: 'Run this' },
    ] }],
  });
  assert.deepEqual(definition.sections[0].questions.map(q => q.id), ['a']);
  assert.equal(dropped.length, 5);
});

test('malformed questions are dropped, not repaired into something misleading', () => {
  const { definition, dropped } = ok({
    title: 'T', sections: [{ id: 's', title: 'S', questions: [
      { id: 'a', type: 'radio', label: 'One choice only', options: ['x'] },
      { id: 'b', type: 'radio', label: 'Duplicates collapse', options: ['x', 'x', 'y'] },
      { id: 'c', type: 'matrix', label: 'No scale', rows: ['r'] },
      { id: 'd', type: 'text' },
      { id: 'e', type: 'sum', label: 'One item', rows: ['only'] },
      'not an object', null,
    ] }],
  });
  assert.deepEqual(definition.sections[0].questions.map(q => q.id), ['b']);
  assert.deepEqual((definition.sections[0].questions[0] as { options: string[] }).options, ['x', 'y']);
  assert.ok(dropped.length >= 4);
});

test('ids are made safe and unique; invented logic and unknown properties are stripped', () => {
  const { definition } = ok({
    title: 'T', sections: [
      { id: 's', title: 'A', questions: [
        { id: 'Same!', type: 'text', label: 'One', showIf: { questionId: 'ghost', equals: ['x'] }, evil: '<script>', onclick: 'x()' },
        { id: 'Same!', type: 'text', label: 'Two' },
      ] },
      { id: 's', title: 'B', questions: [{ id: 'same', type: 'text', label: 'Three' }] },
    ],
  });
  const qs = definition.sections.flatMap(s => s.questions);
  assert.equal(new Set(qs.map(q => q.id)).size, 3);
  assert.equal(new Set(definition.sections.map(s => s.id)).size, 2);
  for (const q of qs) {
    assert.ok(!('showIf' in q) && !('evil' in q) && !('onclick' in q));
    assert.match(q.id, /^[a-z0-9_]+$/);
  }
});

test('numbers are clamped into sane ranges and required is only ever a real boolean', () => {
  const { definition } = ok({
    title: 'T', sections: [{ id: 's', title: 'S', questions: [
      { id: 'r', type: 'rating', label: 'R', max: 999, required: 'yes' },
      { id: 'r2', type: 'rating', label: 'R2', max: 1 },
      { id: 'sl', type: 'slider', label: 'S', min: 10, max: 5 },
      { id: 'h', type: 'heading', label: 'Title', required: true },
    ] }],
  });
  const [r, r2, sl, h] = definition.sections[0].questions as unknown as Record<string, unknown>[];
  assert.equal(r.max, 10);
  assert.equal(r.required, undefined);
  assert.equal(r2.max, 3);
  assert.equal(sl.max, 100, 'a max below the min falls back to the default');
  assert.equal(h.required, undefined, 'a heading is never required');
});

test('nonsense in, a clear error out', () => {
  for (const bad of [null, 'text', 42, {}, { sections: [] }, { sections: 'x' }, { title: 'T', sections: [{ questions: [] }] }, { title: 'T', sections: [{ questions: [{ type: 'file', label: 'x' }] }] }]) {
    const r = sanitizeGeneratedDefinition(bad);
    assert.ok('error' in r, JSON.stringify(bad));
  }
});

test('size limits stop a runaway response', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ id: `q${i}`, type: 'text', label: `Q ${i}` }));
  const { definition } = ok({ title: 'T', sections: Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, title: `S${i}`, questions: many })) });
  assert.ok(definition.sections.length <= 12);
  assert.ok(definition.sections.every(s => s.questions.length <= 40));
  const long = ok({ title: 'x'.repeat(5000), sections: [{ title: 'S', questions: [{ type: 'text', label: 'y'.repeat(5000) }] }] });
  assert.ok(long.definition.title.length <= 120 && long.definition.sections[0].questions[0].label.length <= 500);
});
