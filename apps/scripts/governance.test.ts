/**
 * Tests for Admin V2 Sprint 5: Question Library, Templates, Team/RBAC
 * safety, and the confidentiality-threshold setting - the parts that are
 * pure functions and can run without a live Supabase connection.
 * Run with `npm test`.
 *
 * The privacy/governance guarantees that are database facts, not JavaScript
 * logic - the threshold floor enforced inside survey_segment_summary()
 * regardless of what a caller passes; self-escalation, last-owner
 * protection and role-change permission inside update_team_member()/
 * set_team_member_active(); workspace isolation on question_library and
 * survey_templates via RLS; non-member/analyst access denial - were proven
 * directly against the real project this session (500-employee-scale
 * fixtures, three role/permission combinations, a live self-escalation and
 * last-owner attempt), the same way every previous sprint's proofs were,
 * and are not duplicated here as JS reimplementations of the SQL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfidentialityThreshold } from '../Aspire-Survey/src/admin/thresholdValidation.ts';
import { matchesLibrarySearch, matchesTemplateSearch } from '../Aspire-Survey/src/admin/libraryFilters.ts';
import { duplicateTitle, duplicateSlug } from '../Aspire-Survey/src/admin/duplication.ts';
import { atLeast, type Role } from '../Aspire-Survey/src/admin/labels.ts';
import type { Question } from '../Aspire-Survey/src/engine/types';

// ── Confidentiality threshold setting (Part 20) ──────────────────────────

test('a threshold at or above the floor is accepted', () => {
  assert.doesNotThrow(() => validateConfidentialityThreshold(5, 5));
  assert.doesNotThrow(() => validateConfidentialityThreshold(10, 5));
});

test('a threshold below the floor is rejected, with a message naming the floor', () => {
  assert.throws(() => validateConfidentialityThreshold(1, 5), /cannot go below 5/);
  assert.throws(() => validateConfidentialityThreshold(4, 5), /5/);
});

test('a non-finite threshold (NaN from an empty/invalid field) is rejected, not silently coerced', () => {
  assert.throws(() => validateConfidentialityThreshold(NaN, 5));
});

// ── Question Library search/filter (Part 3) ───────────────────────────────

function radio(label: string, id = 'q1'): Question {
  return { id, type: 'radio', label, options: ['A', 'B'] };
}

test('library search matches the question text', () => {
  const row = { definition: radio('How confident do you feel?'), category: 'Engagement', tags: ['pulse'], language: 'en' };
  assert.equal(matchesLibrarySearch(row, { search: 'confident' }), true);
  assert.equal(matchesLibrarySearch(row, { search: 'nothing here' }), false);
});

test('library search also matches tags and category, not just the question text', () => {
  const row = { definition: radio('Something else entirely'), category: 'Manager Effectiveness', tags: ['quarterly', 'pulse'], language: 'en' };
  assert.equal(matchesLibrarySearch(row, { search: 'pulse' }), true);
  assert.equal(matchesLibrarySearch(row, { search: 'manager' }), true);
});

test('library type filter matches only the requested question type', () => {
  const row = { definition: radio('x'), category: null, tags: [], language: 'en' };
  assert.equal(matchesLibrarySearch(row, { type: 'radio' }), true);
  assert.equal(matchesLibrarySearch(row, { type: 'checkbox' }), false);
});

test('an empty filter set matches everything', () => {
  const row = { definition: radio('anything'), category: null, tags: [], language: 'en' };
  assert.equal(matchesLibrarySearch(row, {}), true);
});

// ── Template search/filter (Part 3 equivalent for templates) ─────────────

test('template search matches the name; category filter is exact', () => {
  const row = { name: 'Employee Engagement Pulse', category: 'Engagement' };
  assert.equal(matchesTemplateSearch(row, { search: 'pulse' }), true);
  assert.equal(matchesTemplateSearch(row, { search: 'training' }), false);
  assert.equal(matchesTemplateSearch(row, { category: 'Engagement' }), true);
  assert.equal(matchesTemplateSearch(row, { category: 'Training' }), false);
});

// ── Duplicate naming reused by "Duplicate Template" (Part 9) ──────────────

test('duplicating a template appends "(copy)" the same way duplicating a survey does — one naming rule, not two', () => {
  assert.equal(duplicateTitle('Manager Feedback'), 'Manager Feedback (copy)');
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  assert.equal(duplicateSlug('Manager Feedback', 'manager-feedback', slugify), 'manager-feedback-copy');
});

// ── RBAC model reflects the real roles (Part 10: no fictional ADMIN) ─────

test('the role model is exactly viewer < analyst < editor < owner — Team.tsx imports this type directly, so it cannot silently drift to a role that does not exist', () => {
  const ranked: Role[] = ['viewer', 'analyst', 'editor', 'owner'];
  for (let i = 1; i < ranked.length; i++) {
    assert.equal(atLeast(ranked[i], ranked[i - 1]), true, `${ranked[i]} should meet the ${ranked[i - 1]} minimum`);
    assert.equal(atLeast(ranked[i - 1], ranked[i]), false, `${ranked[i - 1]} should not meet the ${ranked[i]} minimum`);
  }
});

test('analyst cannot meet the owner minimum — the exact boundary add_team_member()/update_team_member() enforce server-side', () => {
  assert.equal(atLeast('analyst', 'owner'), false);
  assert.equal(atLeast('editor', 'owner'), false);
  assert.equal(atLeast('owner', 'owner'), true);
});
