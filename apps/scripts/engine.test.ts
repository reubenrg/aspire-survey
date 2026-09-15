/**
 * Tests for the parts of the engine that decide what goes into the database.
 * Run with `npm test`.
 *
 * These are worth having because the output is SQL and column mappings: a
 * mistake here is silent, and only shows up as wrong or missing data long after
 * responses have been collected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRow, columnsFor, defaultColumn } from '../Aspire-Survey/src/engine/definition.ts';
import { generateCreateTableSql } from '../Aspire-Survey/src/engine/generateSql.ts';
import { demoSurvey } from '../Aspire-Survey/src/surveys/demo.ts';
import type { SurveyDefinition } from '../Aspire-Survey/src/engine/types.ts';

test('column names are derived as snake_case', () => {
  assert.equal(defaultColumn('employeeId'), 'employee_id');
  assert.equal(defaultColumn('s2Change01'), 's2_change01');
  assert.equal(defaultColumn('one-thing'), 'one_thing');
});

test('generated create table is syntactically well formed', () => {
  const sql = generateCreateTableSql(demoSurvey);
  // the bug this file was written for: a comma before the closing paren
  assert.doesNotMatch(sql, /,\s*\)\s*;/, 'trailing comma before closing paren');
  assert.match(sql, /create table if not exists public\.survey_engine_demo \(/);
  assert.equal((sql.match(/\(/g) || []).length, (sql.match(/\)/g) || []).length, 'unbalanced parens');
});

test('the identity column is not null and unique', () => {
  const sql = generateCreateTableSql(demoSurvey);
  assert.match(sql, /employee_id text not null unique/);
});

test('responses are insert-only, never readable with the public key', () => {
  const sql = generateCreateTableSql(demoSurvey);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for insert\n\s*to anon/);
  assert.doesNotMatch(sql, /for select/, 'a select policy would expose responses');
});

test('the response table is granted to anon, or PostgREST cannot see it', () => {
  // A policy alone does not expose a table: without this grant every request
  // fails with PGRST205, which is exactly how stage 2 first failed.
  const sql = generateCreateTableSql(demoSurvey);
  assert.match(sql, /grant insert on public\.survey_engine_demo to anon, authenticated;/);
  assert.doesNotMatch(sql, /grant select on public\.survey_engine_demo/, 'responses must stay unreadable');
});

test('two questions writing the same column is rejected', () => {
  const clash: SurveyDefinition = {
    ...demoSurvey,
    sections: [{
      id: 's', title: 'S', questions: [
        { id: 'employeeId', type: 'text', label: 'A' },
        { id: 'employee_id', type: 'text', label: 'B' },
      ],
    }],
  };
  assert.throws(() => generateCreateTableSql(clash), /both write to the column/);
});

test('a hostile slug cannot reach the generated SQL', () => {
  const evil: SurveyDefinition = { ...demoSurvey, tableName: 'x; drop table users; --' };
  assert.throws(() => generateCreateTableSql(evil), /not a valid lowercase identifier/);
});

test('matrix columns are wide enough for the longest row variant', () => {
  // the fallback list has 1 row, but role variants have 2
  const names = columnsFor(demoSurvey).map(c => c.name);
  assert.ok(names.includes('q_role_01'));
  assert.ok(names.includes('q_role_02'));
});

test('checkbox answers map to an array column', () => {
  const col = columnsFor(demoSurvey).find(c => c.name === 'factors');
  assert.equal(col?.type, 'text[]');
});

test('a hidden conditional writes null, not its abandoned value', () => {
  const row = buildRow(demoSurvey, {
    aspireContribution: 'No',
    aspireDetail: 'typed before changing my mind',
  });
  assert.equal(row.aspire_detail, null);
});

test('a visible conditional keeps its value', () => {
  const row = buildRow(demoSurvey, {
    aspireContribution: 'Yes, significantly',
    aspireDetail: 'the habit prompt',
  });
  assert.equal(row.aspire_detail, 'the habit prompt');
});

test('matrix rows land in the column matching their position', () => {
  const row = buildRow(demoSurvey, {
    role: 'Trainer',
    roleAnswers: {
      'I adjust my training based on evidence of learner needs.': 'Agree',
      'I check whether learning is being applied after training.': 'Neutral',
    },
  });
  assert.equal(row.q_role_01, 'Agree');
  assert.equal(row.q_role_02, 'Neutral');
});

test('Other free text is dropped when Other is not chosen', () => {
  const chosen = buildRow(demoSurvey, { factors: ['Other'], factors__other: 'my reason' });
  assert.equal(chosen.q_factors_other, 'my reason');

  const notChosen = buildRow(demoSurvey, { factors: ['Formal training'], factors__other: 'stale' });
  assert.equal(notChosen.q_factors_other, null);
});
