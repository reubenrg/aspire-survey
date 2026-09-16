/**
 * Tests for Admin V2 Sprint 2B: the parts of the survey-management,
 * employee-import and audience workflow that are pure functions and can run
 * without a live Supabase connection. Run with `npm test`.
 *
 * The privacy/token/RLS proof for Sprint 2 lives in the database itself and
 * was verified there directly (see the session's SQL proof); it is not
 * re-implemented here. What belongs here is everything this sprint added
 * that a mistake in would be silent: CSV validation, label/state mapping,
 * and the generic-link warning that stops an accidental privacy leak.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMapping, guessMapping, isBlankRow, parseCsv, summarizeValidation,
  unsupportedColumns, validateRows,
} from '../Aspire-Survey/src/admin/csv.ts';
import {
  PRIVACY_MODE_LABEL, PRIVACY_MODE_DESCRIPTION, SURVEY_STATUS_LABEL, INVITATION_STATUS_LABEL,
  atLeast, completionRate, genericLinkWarning, isRemindable, usesInvitationLinks,
} from '../Aspire-Survey/src/admin/labels.ts';

// ── CSV parsing ──────────────────────────────────────────────────────────

test('CSV parsing handles quoted fields, embedded commas and CRLF', () => {
  const text = 'code,name,department\r\nE1,"Doe, Jane",Sales\r\nE2,"Say ""hi""",Ops\r\n';
  const table = parseCsv(text);
  assert.deepEqual(table.headers, ['code', 'name', 'department']);
  assert.deepEqual(table.rows, [
    ['E1', 'Doe, Jane', 'Sales'],
    ['E2', 'Say "hi"', 'Ops'],
  ]);
});

test('CSV parsing strips a leading BOM and ignores a trailing blank line', () => {
  const text = '﻿code,name\nE1,Alice\n\n';
  const table = parseCsv(text);
  assert.deepEqual(table.headers, ['code', 'name']);
  assert.deepEqual(table.rows, [['E1', 'Alice']]);
});

test('guessMapping matches common header spellings without configuration', () => {
  const mapping = guessMapping(['Employee Code', 'Full Name', 'Work Email', 'Dept', 'Location']);
  assert.equal(mapping.employee_code, 'Employee Code');
  assert.equal(mapping.employee_name, 'Full Name');
  assert.equal(mapping.email, 'Work Email');
  assert.equal(mapping.department, 'Dept');
  assert.equal(mapping.location, 'Location');
});

test('unmapped target fields are simply absent, not guessed wrongly', () => {
  const mapping = guessMapping(['id', 'name']);
  assert.equal(mapping.department, undefined);
  assert.equal(mapping.designation, undefined);
});

// ── CSV validation ───────────────────────────────────────────────────────

function row(over: Partial<{ code: string; name: string; email: string; dept: string }> = {}) {
  const table = parseCsv(
    'code,name,email,dept\n' +
    `${over.code ?? 'E1'},${over.name ?? 'Alice'},${over.email ?? 'alice@example.com'},${over.dept ?? 'Ops'}\n`,
  );
  const mapping = { employee_code: 'code', employee_name: 'name', email: 'email', department: 'dept' } as const;
  return applyMapping(table, mapping)[0];
}

test('a clean row is ready to import', () => {
  const [v] = validateRows([row()], new Set());
  assert.equal(v.outcome, 'ready');
  assert.deepEqual(v.problems, []);
});

test('a duplicate employee code within the same file is skipped, not silently merged', () => {
  const rows = [row({ code: 'E1' }), row({ code: 'e1', name: 'Bob' })]; // case-insensitive match
  const validated = validateRows(rows, new Set());
  assert.equal(validated[0].outcome, 'ready');
  assert.equal(validated[1].outcome, 'skip');
  assert.match(validated[1].problems.join(' '), /Duplicate employee code/);
});

test('a code that already exists in the directory is skipped, never overwritten', () => {
  const [v] = validateRows([row({ code: 'E1' })], new Set(['e1']));
  assert.equal(v.outcome, 'skip');
  assert.match(v.problems.join(' '), /already exists in the directory/);
});

test('a malformed email needs attention but does not block the row', () => {
  const [v] = validateRows([row({ email: 'not-an-email' })], new Set());
  assert.equal(v.outcome, 'needs_attention');
  assert.match(v.problems.join(' '), /malformed/);
});

test('a missing mandatory field is skipped', () => {
  const [v] = validateRows([row({ name: '' })], new Set());
  assert.equal(v.outcome, 'skip');
  assert.match(v.problems.join(' '), /Missing employee name/);
});

test('a fully blank row is detected and skipped as blank, not as five separate problems', () => {
  const table = parseCsv('code,name,email,dept\n,,,\n');
  const mapping = { employee_code: 'code', employee_name: 'name', email: 'email', department: 'dept' } as const;
  const mapped = applyMapping(table, mapping)[0];
  assert.equal(isBlankRow(mapped), true);
  const [v] = validateRows([mapped], new Set());
  assert.equal(v.outcome, 'skip');
  assert.deepEqual(v.problems, ['Blank row']);
});

test('unsupported columns are reported so nothing is silently dropped without saying so', () => {
  const table = parseCsv('code,name,notes\nE1,Alice,hello\n');
  const mapping = { employee_code: 'code', employee_name: 'name' } as const;
  assert.deepEqual(unsupportedColumns(table.headers, mapping), ['notes']);
});

test('summarizeValidation counts ready / needs_attention / skip independently', () => {
  const rows = [
    row({ code: 'E1' }),
    row({ code: 'E2', email: 'bad' }),
    row({ code: 'E1', name: 'Clash' }), // duplicate of E1 -> skip
  ];
  const summary = summarizeValidation(validateRows(rows, new Set()));
  assert.deepEqual(summary, { ready: 1, needsAttention: 1, skip: 1 });
});

// ── Labels and state mapping ─────────────────────────────────────────────

test('every privacy mode, survey status and invitation status has a human label', () => {
  for (const m of ['ANONYMOUS', 'ANONYMOUS_TRACKED', 'CONFIDENTIAL'] as const) {
    assert.ok(PRIVACY_MODE_LABEL[m].length > 0);
  }
  for (const s of ['DRAFT', 'LIVE', 'CLOSED', 'ARCHIVED'] as const) {
    assert.ok(SURVEY_STATUS_LABEL[s].length > 0);
  }
  for (const i of ['NOT_SENT', 'SENT', 'OPENED', 'STARTED', 'COMPLETED', 'EXPIRED', 'REVOKED'] as const) {
    assert.ok(INVITATION_STATUS_LABEL[i].length > 0);
  }
});

test('Confidential never claims to be anonymous - the label omits the word, the description explicitly denies it', () => {
  assert.doesNotMatch(PRIVACY_MODE_LABEL.CONFIDENTIAL, /anonymous/i);
  // The description is allowed to say "not anonymous" - that's a clarifying
  // denial, not a claim - but must never assert anonymity outright.
  assert.doesNotMatch(PRIVACY_MODE_DESCRIPTION.CONFIDENTIAL, /\bis anonymous\b/i);
  assert.match(PRIVACY_MODE_DESCRIPTION.CONFIDENTIAL, /not anonymous/i);
});

test('invitation status labels avoid ambiguous words like Active, Done or Used', () => {
  const joined = Object.values(INVITATION_STATUS_LABEL).join(' ');
  assert.doesNotMatch(joined, /\b(Active|Done|Used)\b/);
});

// ── Generic-link warning (Part 19) ──────────────────────────────────────

test('sharing the generic survey link is only flagged for employee-link modes', () => {
  assert.equal(genericLinkWarning('ANONYMOUS'), null);
  assert.ok(genericLinkWarning('ANONYMOUS_TRACKED'));
  assert.ok(genericLinkWarning('CONFIDENTIAL'));
  assert.equal(usesInvitationLinks('ANONYMOUS'), false);
  assert.equal(usesInvitationLinks('ANONYMOUS_TRACKED'), true);
  assert.equal(usesInvitationLinks('CONFIDENTIAL'), true);
});

// ── Reminder targeting (Part 18) ─────────────────────────────────────────

test('reminders target Sent, Opened and Started only', () => {
  assert.equal(isRemindable('SENT'), true);
  assert.equal(isRemindable('OPENED'), true);
  assert.equal(isRemindable('STARTED'), true);
  assert.equal(isRemindable('NOT_SENT'), false);
  assert.equal(isRemindable('COMPLETED'), false);
  assert.equal(isRemindable('REVOKED'), false);
  assert.equal(isRemindable('EXPIRED'), false);
});

// ── Completion rate ──────────────────────────────────────────────────────

test('completion rate is a real ratio, never fabricated for an empty audience', () => {
  assert.equal(completionRate(0, 0), 0);
  assert.equal(completionRate(3, 4), 75);
  assert.equal(completionRate(1, 3), 33);
});

// ── Role gating (Part 24 — analyst restrictions, UI-side) ────────────────
// The actual enforcement is row level security in the database (see the
// session's SQL proof of has_survey_role on issue_invitations,
// revoke_invitations, mark_invitations_sent and regenerate_invitation, all
// gated at 'editor'). This checks the client-side rank table used to decide
// what the UI offers stays in step with that gate, so an analyst is never
// shown an audience-management control the database would refuse anyway.
test('analyst rank is below editor, so audience management stays hidden from analysts', () => {
  assert.equal(atLeast('analyst', 'editor'), false);
  assert.equal(atLeast('viewer', 'editor'), false);
  assert.equal(atLeast('editor', 'editor'), true);
  assert.equal(atLeast('owner', 'editor'), true);
});

test('analyst can still view (viewer-level) screens like Audience read-only', () => {
  assert.equal(atLeast('analyst', 'viewer'), true);
});
