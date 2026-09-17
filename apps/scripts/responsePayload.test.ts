/**
 * Guards the contract between the respondent client and
 * submit_invited_response(): the payload it sends must be keyed by real
 * response-table COLUMN names, not by question ids.
 *
 * This existed as an unwritten assumption and was violated in practice -
 * InvitePage sent raw answers straight through, so a matrix question (whose
 * answers live under its question id as a row-label -> value object) matched
 * no column at all and every matrix answer was silently discarded while the
 * submission still reported success. These tests pin the invariant down.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRow, columnsFor } from '../Aspire-Survey/src/engine/definition.ts';
import type { SurveyDefinition } from '../Aspire-Survey/src/engine/types.ts';

const definition = {
  slug: 'behaviour-change',
  title: 'Behaviour Change',
  welcome: { heading: 'Welcome', body: ['x'] },
  thankYou: { heading: 'Thanks', body: 'y' },
  sections: [
    {
      id: 'awareness',
      title: 'Awareness',
      questions: [
        {
          id: 'awareness_m', type: 'matrix', label: 'Agree?', columnPrefix: 'aw', required: true,
          rows: ['I understand the change', 'I understand why it matters'],
          scale: ['Disagree', 'Agree'],
        },
      ],
    },
    {
      id: 'obstacles',
      title: 'Obstacles',
      questions: [
        { id: 'stage_now', type: 'radio', label: 'Where are you?', options: ['Started', 'Not started'], required: true },
        { id: 'obstacles_list', type: 'checkbox', label: 'What blocked you?', options: ['Time', 'Other'] },
        { id: 'what_would_help', type: 'textarea', label: 'What would help?' },
      ],
    },
  ],
} as unknown as SurveyDefinition;

const answers = {
  awareness_m: { 'I understand the change': 'Agree', 'I understand why it matters': 'Disagree' },
  stage_now: 'Started',
  obstacles_list: ['Time'],
  what_would_help: 'Nothing much',
};

test('the submitted payload is keyed by column names, never by question ids', () => {
  const keys = Object.keys(buildRow(definition, answers)).sort();
  const columns = columnsFor(definition).map(c => c.name).sort();
  assert.deepEqual(keys, columns);
});

test('a matrix question contributes one column per row, not a single nested object', () => {
  const row = buildRow(definition, answers);
  assert.equal(row.aw_01, 'Agree');
  assert.equal(row.aw_02, 'Disagree');
  // The question id itself must not survive into the payload - it matches no
  // column, so anything sent under it is dropped by the database function.
  assert.ok(!('awareness_m' in row));
});

test('every non-matrix question still maps to its own derived column', () => {
  const row = buildRow(definition, answers);
  assert.equal(row.stage_now, 'Started');
  assert.deepEqual(row.obstacles_list, ['Time']);
  assert.equal(row.what_would_help, 'Nothing much');
});

test('an unanswered checkbox sends an empty array, so a NOT NULL text[] column still accepts it', () => {
  const row = buildRow(definition, { stage_now: 'Started' });
  assert.deepEqual(row.obstacles_list, []);
});

test('an unanswered matrix row writes null rather than being omitted from the payload', () => {
  const row = buildRow(definition, { awareness_m: { 'I understand the change': 'Agree' } });
  assert.equal(row.aw_01, 'Agree');
  assert.equal(row.aw_02, null);
  assert.ok('aw_02' in row);
});
