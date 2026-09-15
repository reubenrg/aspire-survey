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
import { migrationForNewColumns, validateAdditive } from '../Aspire-Survey/src/engine/additive.ts';
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

// ── Sprint 3: additive-only guard ──────────────────────────────────────────

const withResponses = true;

function edit(fn: (d: SurveyDefinition) => SurveyDefinition): SurveyDefinition {
  return fn(JSON.parse(JSON.stringify(demoSurvey)) as SurveyDefinition);
}

test('no responses yet means anything may change', () => {
  const gutted = edit(d => ({ ...d, sections: [d.sections[0]] }));
  assert.equal(validateAdditive(demoSurvey, gutted, false).length, 0);
});

test('adding a question is always allowed', () => {
  const added = edit(d => {
    d.sections[0].questions.push({ id: 'newOne', type: 'text', label: 'Added later' });
    return d;
  });
  assert.equal(validateAdditive(demoSurvey, added, withResponses).length, 0);
});

test('deleting a question with stored answers is blocked', () => {
  const removed = edit(d => {
    d.sections[2].questions = d.sections[2].questions.filter(q => q.id !== 'oneThing');
    return d;
  });
  const errs = validateAdditive(demoSurvey, removed, withResponses).filter(i => i.severity === 'error');
  assert.equal(errs.length, 1);
  assert.match(errs[0].message, /was removed/);
});

test('reordering matrix rows is blocked, and says which column would be reinterpreted', () => {
  const swapped = edit(d => {
    const m = d.sections[1].questions[0] as { rows: string[] };
    [m.rows[0], m.rows[1]] = [m.rows[1], m.rows[0]];
    return d;
  });
  const errs = validateAdditive(demoSurvey, swapped, withResponses).filter(i => i.severity === 'error');
  assert.ok(errs.length >= 2, 'both moved rows should be reported');
  assert.match(errs[0].message, /q_change_01/);
  assert.match(errs[0].message, /moved from position 1 to 2/);
});

test('appending a matrix row is allowed', () => {
  const appended = edit(d => {
    (d.sections[1].questions[0] as { rows: string[] }).rows.push('A brand new statement');
    return d;
  });
  assert.equal(validateAdditive(demoSurvey, appended, withResponses).filter(i => i.severity === 'error').length, 0);
});

test('changing a question type that changes column storage is blocked', () => {
  const retyped = edit(d => {
    const q = d.sections[2].questions.find(x => x.id === 'factors')!;
    // checkbox (text[]) -> radio (text)
    return { ...d, sections: d.sections.map(s => ({
      ...s, questions: s.questions.map(x => x.id === 'factors'
        ? { id: x.id, type: 'radio' as const, label: x.label, options: (q as { options: string[] }).options }
        : x),
    })) };
  });
  const errs = validateAdditive(demoSurvey, retyped, withResponses).filter(i => i.severity === 'error');
  assert.ok(errs.some(e => /text\[\]/.test(e.message)));
});

test('renaming a question id is blocked because it moves the column', () => {
  const renamed = edit(d => {
    d.sections[2].questions[0].id = 'oneThingRenamed';
    return d;
  });
  const errs = validateAdditive(demoSurvey, renamed, withResponses).filter(i => i.severity === 'error');
  assert.ok(errs.some(e => /was removed/.test(e.message)));
});

test('dropping an option warns but does not block', () => {
  const trimmed = edit(d => {
    const q = d.sections[2].questions.find(x => x.id === 'factors') as { options: string[] };
    q.options = q.options.filter(o => o !== 'Personal effort');
    return d;
  });
  const issues = validateAdditive(demoSurvey, trimmed, withResponses);
  assert.equal(issues.filter(i => i.severity === 'error').length, 0);
  assert.equal(issues.filter(i => i.severity === 'warning').length, 1);
});

test('changing the identity question is blocked', () => {
  const swappedId = edit(d => ({ ...d, uniqueBy: 'employeeName' }));
  const errs = validateAdditive(demoSurvey, swappedId, withResponses).filter(i => i.severity === 'error');
  assert.ok(errs.some(e => /unique constraint/.test(e.message)));
});

test('added questions produce ALTER statements for the missing columns', () => {
  const added = edit(d => {
    d.sections[0].questions.push({ id: 'shiftPattern', type: 'checkbox', label: 'Shifts', options: ['Day'] });
    return d;
  });
  const sql = migrationForNewColumns(demoSurvey, added, 'survey_engine_demo');
  assert.match(sql, /add column if not exists shift_pattern text\[\]/);
  assert.doesNotMatch(sql, /employee_id/, 'existing columns must not be re-added');
});
