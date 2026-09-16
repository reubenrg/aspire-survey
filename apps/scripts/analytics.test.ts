/**
 * Tests for Admin V2 Sprint 4: response centre, analytics and export - the
 * parts that are pure functions and can run without a live Supabase
 * connection. Run with `npm test`.
 *
 * The privacy-critical guarantees (confidentiality threshold suppression,
 * cross-filter suppression, ANONYMOUS_TRACKED unlinkability holding through
 * analytics, CONFIDENTIAL identity permission, small-group re-identification
 * via raw rows, exact-timestamp correlation) are database-layer facts, not
 * JavaScript logic - engine/questionFactory.ts-style unit tests would only
 * be testing a reimplementation of the SQL, not the actual guarantee. Those
 * were proven directly against the real project this session (500 synthetic
 * responses across 22 employees in 4 departments, two invitation-based
 * surveys, three role/permission combinations), the same way Sprint 2's and
 * Sprint 3's proofs were, and are not duplicated here. What belongs here is
 * everything a JS mistake could silently get wrong: which columns are which
 * analysis kind, matrix scoring, pagination arithmetic, CSV formatting, and
 * version compatibility.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionColumns, groupMatrixRows } from '../Aspire-Survey/src/admin/questionMeta.ts';
import { averagePosition } from '../Aspire-Survey/src/admin/matrixMath.ts';
import { totalPages, hasNextPage, hasPreviousPage } from '../Aspire-Survey/src/admin/pagination.ts';
import { csvCell, toCsv } from '../Aspire-Survey/src/admin/csvExport.ts';
import { compatibleVersions, isColumnCompatibleAcrossAllVersions } from '../Aspire-Survey/src/admin/versionCompat.ts';
import { generateCreateTableSql } from '../Aspire-Survey/src/engine/generateSql.ts';
import { demoSurvey } from '../Aspire-Survey/src/surveys/demo.ts';
import type { SurveyDefinition } from '../Aspire-Survey/src/engine/types';

function survey(overrides: Partial<SurveyDefinition> = {}): SurveyDefinition {
  return {
    slug: 'test', title: 'Test', uniqueBy: 'employeeId',
    welcome: { heading: 'h', body: ['b'] }, thankYou: { heading: 't', body: 'b' },
    sections: [{
      id: 's', title: 'Section',
      questions: [
        { id: 'employeeId', type: 'text', label: 'Employee ID', required: true },
        { id: 'mood', type: 'radio', label: 'How do you feel?', options: ['Good', 'Bad'] },
        { id: 'topics', type: 'checkbox', label: 'Topics', options: ['A', 'B', 'C'] },
        { id: 'notes', type: 'textarea', label: 'Anything else?' },
        {
          id: 'agreement', type: 'matrix', label: 'Rate these', columnPrefix: 'agree',
          rows: ['Statement one', 'Statement two'],
          scale: ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'],
        },
      ],
    }],
    ...overrides,
  };
}

// ── Question classification (feeds Part 6's per-type rendering) ─────────

test('single-choice and dropdown questions are classified as "choice" (bar chart with count/percentage)', () => {
  const cols = questionColumns(survey());
  const mood = cols.find(c => c.column === 'mood');
  assert.equal(mood?.kind, 'choice');
  assert.deepEqual(mood?.options, ['Good', 'Bad']);
});

test('checkbox questions are classified as "multiselect", never as a plain choice', () => {
  const cols = questionColumns(survey());
  assert.equal(cols.find(c => c.column === 'topics')?.kind, 'multiselect');
});

test('text and textarea questions are classified as "text" - Part 6 requires these are never turned into a frequency distribution', () => {
  const cols = questionColumns(survey());
  const notes = cols.find(c => c.column === 'notes');
  assert.equal(notes?.kind, 'text');
  // "text" is a distinct kind from "choice"/"multiselect", which is what the
  // analytics screens actually switch on to decide whether to show a
  // distribution or a plain count - misclassifying this would be exactly
  // the Part 6 violation ("do not expose individual text responses").
  assert.notEqual(notes?.kind, 'choice');
});

test('a matrix question becomes one "matrix-row" entry per row, carrying the shared scale', () => {
  const cols = questionColumns(survey());
  const rows = cols.filter(c => c.kind === 'matrix-row');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].scale, ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree']);
  assert.equal(rows[0].label, 'Statement one');
});

test('groupMatrixRows collects a matrix question\'s rows back under one question id', () => {
  const cols = questionColumns(survey());
  const groups = groupMatrixRows(cols);
  assert.equal(groups.size, 1);
  assert.equal(groups.get('agreement')?.length, 2);
});

test('a rowsByAnswer matrix exposes the union of every variant\'s row labels, by position', () => {
  const def = survey({
    sections: [{
      id: 's', title: 'S',
      questions: [{
        id: 'roleAnswers', type: 'matrix', label: 'l', columnPrefix: 'role',
        rows: ['Fallback row'], scale: ['Disagree', 'Agree'],
        rowsByAnswer: { questionId: 'role', map: { HR: ['HR stmt 1', 'HR stmt 2'], QA: ['QA stmt 1'] } },
      }],
    }],
  });
  const cols = questionColumns(def);
  assert.equal(cols.length, 2); // width = max(1, 2, 1) = 2
  assert.equal(cols[0].label, 'HR stmt 1'); // first variant with a row at position 0 wins
  assert.equal(cols[1].label, 'HR stmt 2');
});

// ── Matrix scoring (Part 6: no misleading averages) ──────────────────────

test('average position scores by scale order, not by the label text', () => {
  const scale = ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'];
  // 2 people said Agree (pos 4), 1 said Strongly Agree (pos 5): (4+4+5)/3
  const avg = averagePosition({ Agree: 2, 'Strongly Agree': 1 }, scale);
  assert.equal(avg, (4 + 4 + 5) / 3);
});

test('average position is null, not zero or NaN, when nobody answered', () => {
  assert.equal(averagePosition({}, ['A', 'B', 'C']), null);
});

// ── Pagination (Part 3: real database paging) ─────────────────────────────

test('totalPages rounds up and is never less than 1, even for zero responses', () => {
  assert.equal(totalPages(0, 25), 1);
  assert.equal(totalPages(25, 25), 1);
  assert.equal(totalPages(26, 25), 2);
  assert.equal(totalPages(500, 25), 20);
});

test('hasNextPage / hasPreviousPage bound the page range correctly', () => {
  assert.equal(hasPreviousPage(0), false);
  assert.equal(hasPreviousPage(1), true);
  assert.equal(hasNextPage(0, 25, 25), false); // exactly one page
  assert.equal(hasNextPage(0, 25, 26), true); // one more row on page 2
  assert.equal(hasNextPage(19, 25, 500), false); // last page of 20
});

// ── CSV export formatting ─────────────────────────────────────────────────

test('CSV cells quote values containing commas, quotes or newlines; leave plain values bare', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('she said "hi"'), '"she said ""hi"""');
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
});

test('CSV array cells (checkbox answers) join with a semicolon rather than breaking the column count', () => {
  assert.equal(csvCell(['A', 'B']), 'A; B');
});

test('toCsv produces a header row plus one row per record, with \\r\\n line endings', () => {
  const csv = toCsv([{ mood: 'Good', notes: 'fine' }, { mood: 'Bad', notes: 'not, great' }]);
  assert.equal(csv, 'mood,notes\r\nGood,fine\r\nBad,"not, great"');
});

test('toCsv on an empty response set produces an empty string, not a lone header', () => {
  assert.equal(toCsv([]), '');
});

// ── Version compatibility (Part 13) ───────────────────────────────────────

test('a column present with the same storage type across versions is reported compatible in both', () => {
  const v1 = { version_number: 1, definition: survey() };
  const v2 = { version_number: 2, definition: survey() }; // identical shape
  assert.deepEqual(compatibleVersions([v1, v2], 'mood', 'text'), [1, 2]);
});

test('a version where the column does not exist yet is excluded, not silently treated as compatible', () => {
  const v1 = { version_number: 1, definition: survey({ sections: [{ id: 's', title: 'S', questions: [{ id: 'employeeId', type: 'text', label: 'Employee ID', required: true }] }] }) };
  const v2 = { version_number: 2, definition: survey() }; // v2 added "mood"
  assert.deepEqual(compatibleVersions([v1, v2], 'mood', 'text'), [2]);
});

test('a column whose storage type changed between versions (checkbox replacing radio) is never combined', () => {
  const v1 = { version_number: 1, definition: survey() }; // mood is a radio -> text column
  const changed = survey();
  changed.sections[0].questions[1] = { id: 'mood', type: 'checkbox', label: 'How do you feel?', options: ['Good', 'Bad'] }; // now text[]
  const v2 = { version_number: 2, definition: changed };
  assert.deepEqual(compatibleVersions([v1, v2], 'mood', 'text'), [1]);
  assert.equal(isColumnCompatibleAcrossAllVersions([v1, v2], 'mood'), false);
});

test('isColumnCompatibleAcrossAllVersions is true when every version that has the column agrees on its type', () => {
  const v1 = { version_number: 1, definition: survey() };
  const v2 = { version_number: 2, definition: survey() };
  assert.equal(isColumnCompatibleAcrossAllVersions([v1, v2], 'mood'), true);
});

// ── generateSql privacy-mode schema (Sprint 4's own generator changes) ────

test('ANONYMOUS mode emits exactly the same SQL as before this sprint (no segmentation columns, blanket grant)', () => {
  const sql = generateCreateTableSql(demoSurvey);
  assert.doesNotMatch(sql, /resp_department/);
  assert.doesNotMatch(sql, /employee_id uuid references/);
  assert.match(sql, /grant select, insert on public\.survey_engine_demo to authenticated;/);
});

test('ANONYMOUS_TRACKED emits segmentation columns but no employee_id, and restricts the analyst grant to a column list', () => {
  const clean = { ...demoSurvey, uniqueBy: undefined, sections: demoSurvey.sections.map(s => (s.id === 'about' ? { ...s, questions: s.questions.filter(q => q.id !== 'employeeId' && q.id !== 'employeeName') } : s)) };
  const sql = generateCreateTableSql(clean, 'ANONYMOUS_TRACKED');
  assert.match(sql, /resp_department text,/);
  assert.doesNotMatch(sql, /employee_id uuid references/);
  assert.doesNotMatch(sql, /grant select \(.*resp_department/); // never in the grantable list
  assert.match(sql, /grant select \(/); // restricted, not blanket
});

test('CONFIDENTIAL emits an employee_id column referencing employees, excluded from the analyst grant', () => {
  const clean = { ...demoSurvey, uniqueBy: undefined, sections: demoSurvey.sections.map(s => (s.id === 'about' ? { ...s, questions: s.questions.filter(q => q.id !== 'employeeId' && q.id !== 'employeeName') } : s)) };
  const sql = generateCreateTableSql(clean, 'CONFIDENTIAL');
  assert.match(sql, /employee_id uuid references public\.employees\(id\)/);
  assert.doesNotMatch(sql, /grant select \([^)]*employee_id/); // employee_id never in the grant column list
  // No trailing-comma / unbalanced-paren bug (the exact defect this sprint found and fixed).
  assert.doesNotMatch(sql, /,\s*\n\s*\)/);
  assert.equal((sql.match(/\(/g) || []).length, (sql.match(/\)/g) || []).length);
});

test('a question that would collide with a reserved identity/segmentation column is rejected, not silently duplicated', () => {
  assert.throws(() => generateCreateTableSql(demoSurvey, 'CONFIDENTIAL'), /reserved/);
});
