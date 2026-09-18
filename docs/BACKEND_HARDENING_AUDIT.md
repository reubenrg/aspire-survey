# Aspire Surveys — Backend Hardening Audit (Phase A)

**Date:** 2026-09-17 to 2026-09-18
**Scope:** every domain named in the governing Phase A spec — customers, employees, surveys, versions, publishing, templates, question library, audience, invitations, campaigns, responses, analytics, reports, team/RBAC, audit, settings, Edge Functions, auth, exports.
**Method:** every finding below was reproduced live against project `zpefurbbejsarkcgmscg` in a rolled-back transaction (or, for the Edge Function, by reading its deployed source) *before* being fixed, and re-verified live *after* — never assumed correct from reading code alone. See `apps/supabase/MIGRATIONS.md` for the exact SQL of every DB-level fix. Two background research agents covered employees/team/RBAC/settings/library/customers and analytics/reports/exports/responses in parallel with direct manual review of every `SECURITY DEFINER` function and the Edge Function; findings below are tagged by source.

This document is the retrospective write-up the spec asked for first; in practice, findings were fixed inline as each was confirmed, then compiled here once the CRITICAL/HIGH backlog was clear. That ordering choice traded a later audit document for faster closure of live, exploitable holes — worth naming since the spec's own order was audit-then-fix.

---

## CRITICAL (4 found, 4 fixed)

### C1. Identity leak via distribution/breakdown functions
`survey_columns_distribution()`, `survey_multiselect_distribution()`, and `survey_text_count()` validated a caller-supplied column name against a safe-identifier regex and confirmed it existed on the table — but never excluded the four privacy-restricted columns (`employee_id`, `resp_department`, `resp_location`, `resp_designation`). Any caller clearing only the `analyst` role bar (below `can_view_identity()`) could request `employee_id` directly and get back a real employee UUID with a response count, completely bypassing the identity gate `survey_response_page()` correctly enforces.

**Proved live before fix:** `survey_columns_distribution('qa-integrity-habit', ARRAY['employee_id'])` returned the real employee UUID with `n=1`, no suppression, no identity check.
**Fix:** explicit `restricted constant text[]` denylist added to all three functions.
**Migration:** `20260917092009_block_identity_columns_in_distribution_functions.sql`

### C2. Open respondent path bypassed the entire invitation/privacy model
`/s/:slug` (the open, no-token respondent route) had zero `privacy_mode` check anywhere. `loadSurvey()`/`submitResponse()` in `engine/surveyStore.ts` do a plain anon insert with no token, and the response table's own INSERT policy checked only `published`/`closed_at`/org-active — never the mode. For CONFIDENTIAL and ANONYMOUS_TRACKED surveys, whose entire design is "each employee gets one personal invitation link," this meant anyone with the base slug URL could submit unlimited, un-invited, unlinked responses.

**Proved live before fix:** a plain anon insert into a CONFIDENTIAL response table succeeded with no invitation at all. The single most severe finding of this phase.
**Fix:** `survey_accepting_responses()` now additionally requires `privacy_mode = 'ANONYMOUS'`.
**Migration:** `20260917093512_restrict_open_path_to_anonymous_surveys.sql`

### C3. Exact headcount disclosed through the suppression threshold
`survey_segment_summary()` correctly withholds any group below the ≥5 suppression threshold from its `groups` array — but then returned `suppressed_responses` (the sum of every hidden group's headcount) unconditionally. Whenever exactly one group was suppressed for a chosen dimension — routine for any org with an uneven distribution, not an edge case — that sum *is* that one group's exact size, precisely the number the threshold exists to hide.

**Proved live before fix:** `survey_segment_summary('qa-integrity-habit','department')` returned `suppressed_groups:1, suppressed_responses:1` — an exact headcount, rendered directly into `SurveyAnalytics.tsx`.
**Fix:** `suppressed_responses` is now `null` unless `suppressed_groups >= 2`.
**Migration:** `20260917093649_fix_segment_summary_suppressed_count_leak.sql`

### C4. Response-table hijack via editor-writable `table_name` (self-discovered, Phase D)
`surveys.table_name` is editor-writable. Before hardening, `ensure_survey_response_table()` would ALTER, replace RLS policies on, and grant anon INSERT to *whatever table that column named* — including `employees`, `survey_invitations`, another survey's table, or the frozen legacy `survey_responses`. Found by adversarially re-auditing the function immediately after shipping it, per the Response Integrity acceptance spec's own request to attack fresh work rather than assume it's safe.

**Proved live before fix:** all four hijack targets attacked successfully; re-attacked post-fix to confirm the block.
**Fix:** target table must match `survey_<name>`, must not already belong to another survey, and (if it already exists) must structurally look like a response table (id + submitted_at + definition_version signature).
**Migration:** `20260917065146_harden_ensure_survey_response_table.sql`

---

## HIGH (7 found, 7 fixed)

### H1. No closed-survey enforcement on the open path
The anon SELECT policy on `surveys` checked only `published`; every response table's INSERT policy was a static `with check (true)`. A survey closed by an admin kept silently accepting open-path submissions. The invitation path already got this right (`submit_invited_response()` explicitly checks `closed_at`).
**Fix:** response-table INSERT policy now checks `published and closed_at is null`, retrofitted onto every existing response table.
**Migrations:** `20260917092220_enforce_closed_survey_on_open_insert_policy.sql`, `20260917092259_retrofit_closed_check_on_existing_response_tables.sql` (the first retrofit loop was a silent no-op — see [Process notes](#process-notes)).

### H2. Customer deactivation was purely cosmetic
Nothing anywhere checked `organizations.is_active`. A deactivated customer's published surveys stayed publicly readable and submittable, and both `resolve_invitation()` and `submit_invited_response()` kept working. `Customers.tsx`'s own copy says deactivation "suspends" a customer — it didn't.
**Fix:** `resolve_invitation()`, `submit_invited_response()`, `issue_invitations()`, the `surveys` SELECT policy, and every response table's INSERT policy now require the parent org be active, via the `survey_accepting_responses()`/`organization_is_active()` SECURITY DEFINER helpers (after an RLS-vs-grants detour — see [Process notes](#process-notes)).
**Migrations:** `20260917092906` through `20260917093512` (the full chain, including the architectural correction).

### H3. Question Library "New question" silently mis-scoped for workspace editors
Hardcoded `organizationId: null` (global scope) regardless of caller. A workspace-scoped-only editor's new question would fail RLS silently or land in the wrong scope.
**Fix:** `QuestionLibrary.tsx` now offers a shared/workspace choice gated on the caller's actual role, defaulting to workspace when they can't share globally.
**Commit:** `be1a136` (TypeScript, no migration needed).

### H4. CSV/formula injection on every response export
`csvCell()` had no defense against a cell beginning with `=`, `+`, `-`, `@`, tab, or CR — Excel/Sheets formula execution from a respondent's own free-text answer. `reportStore.ts` additionally had a byte-for-byte duplicate implementation, vulnerable independently.
**Fix:** leading-apostrophe escape added; the two implementations consolidated to one (`csvExport.ts`).
**Commit:** `be1a136`; regression-tested in `apps/scripts/csvExport.test.ts` (9 tests).

### H5. Legacy raw-table CSV export undercut ANONYMOUS_TRACKED's own timestamp guarantee
`exportResponsesCsv()` (the analyst-role raw-table export path) never applied the hour-coarsening `survey_response_page()`/`_one()` already enforce on `submitted_at` for ANONYMOUS_TRACKED surveys — a full-precision timestamp is itself a re-identification vector when correlated with other known events. No defense-in-depth identity-column strip, no row cap either.
**Fix:** hour-coarsening, an `IDENTITY_COLUMNS` strip, and a 20k-row cap (matching the paginated analytics path) added.
**Commit:** `be1a136`.

### H6. Deactivated team members retained full access (self-discovered)
`get_user_role()` — which backs `has_survey_role()`, gating nearly every authorization check in the schema — never filtered on `survey_members.is_active`. Neither did `can_view_identity()` or `is_survey_member()`. The Team page's "Deactivate" button changed only a cosmetic badge: a deactivated member kept full role-based access, identity-view rights, and read access to `organizations`/`question_library`/`survey_templates`/`platform_settings` platform-wide. Found while auditing an unrelated area.
**Proved live before fix:** a member row with `is_active=false` still passed all three checks as `true`.
**Fix:** all three now filter on `is_active`; an active control member confirmed unaffected.
**Migration:** `20260917095448_enforce_is_active_in_member_authorization.sql`

### H7. Organization hard-delete silently cascaded away surveys and memberships (self-discovered)
`surveys.organization_id` and `survey_members.organization_id` referenced `organizations.id` with `ON DELETE CASCADE`, while every other FK to `organizations` (`employees`, `question_library`, `survey_templates`, `survey_campaigns`) already used RESTRICT. Any workspace-scoped owner could hard-DELETE their own org via a raw REST call — the app's UI never exposes this, only "Deactivate" — silently destroying every survey record and team membership with **no audit entry** (a raw RLS-gated table DELETE, not a function) and orphaning the survey's physical response-data table (no FK link back to `surveys`). Found while investigating a LOW note from an earlier pass; turned out worse than initially assessed.
**Proved live before fix:** an owner's raw DELETE on their own org cascaded away a survey row and their own membership row in one transaction.
**Fix:** both FKs changed to RESTRICT, matching the existing pattern.
**Migration:** `20260918061849_restrict_organization_delete_cascade.sql`

---

## MEDIUM (5 found, 5 fixed)

### M1. Master-owner designation hijackable by any global owner
`platform_settings` write access is "any global owner" — correct for every key except `master_owner_email`, which decides who's immune to demotion/deactivation. Any global owner could reassign it to themselves.
**Fix:** `BEFORE INSERT OR UPDATE` trigger blocks anyone but the current master owner from writing that one key.
**Migration:** `20260917092658_protect_master_owner_email_setting.sql`

### M2. Response-page search ran against the unredacted row
`survey_response_page()`'s `p_search` filter ran `to_jsonb(t)::text ilike ...` on the raw row, before `employee_id`/`resp_department`/`resp_location`/`resp_designation` were stripped for output. A viewer without identity rights could search for a department/location value and learn which rows matched — a side channel, even though the column itself never appeared in the response.
**Proved live before fix:** a non-identity analyst on a CONFIDENTIAL survey, searching a real (hidden) `resp_department` value, got a matching row back with `identity_included:false`.
**Fix:** restructured so search runs against the same already-redacted projection the caller is shown.
**Migration:** `20260917095019_fix_response_page_search_redaction_leak.sql`

### M3. Reserved-column denylist didn't match what the DDL actually creates
`ensure_survey_response_table()`'s reserved-name check exempted `resp_department`/`resp_location`/`resp_designation` for ANONYMOUS surveys, but the table DDL creates those columns unconditionally regardless of mode. A question could validly claim one of those names on an ANONYMOUS survey — producing a raw "column specified more than once" failure on first creation, or a *silently skipped* ALTER on an existing table that routed a real answer into a column every export path treats as reserved and strips.
**Proved live before fix:** an ANONYMOUS survey definition with a question mapped to `resp_department` reached CREATE TABLE and failed with the raw Postgres error instead of the intended validation message.
**Fix:** those three columns now reserved in every privacy mode.
**Migration:** `20260917095255_reserve_response_columns_in_all_privacy_modes.sql`

### M4. send-campaign had no survey/org lifecycle awareness
The Edge Function would send or remind against a closed survey or a deactivated customer — the submission itself was always safely blocked downstream, but a dead link would still land in real employees' inboxes.
**Fix:** fetches `published`/`closed_at`/`is_active` and refuses with a 409 before a real send or remind; test sends unaffected (never reach a real employee either way).
**Deployed:** `send-campaign` v4.

### M5. Employee lifecycle had zero audit coverage
`createEmployee`/`updateEmployee`/`importEmployees` never wrote an audit entry — silent create, update, and bulk import.
**Fix:** `EMPLOYEE_CREATED`/`EMPLOYEE_UPDATED`/`EMPLOYEES_IMPORTED` entries added, written best-effort (an audit-write failure must never re-classify an already-created employee as an import failure — a real correctness hazard specific to `importEmployees`' per-row try/catch loop).
**Commit:** `be1a136`.

---

## LOW (3 found, 2 fixed, 1 accepted as-is)

### L1. Duplicate-member add surfaced a raw Postgres error — fixed
`add_team_member` translated `42501` but not `23505`; adding an already-existing member showed the raw unique-constraint violation text.
**Fix:** `teamStore.ts` now returns "This person is already a team member in this scope."
**Commit:** `12cd576`.

### L2. Question Library action buttons shown regardless of role — fixed
Duplicate/Deactivate/Reactivate were always rendered; the server correctly rejected an unauthorized attempt, but the UI offered the control to everyone regardless of scope.
**Fix:** both actions now gated on `session.can(row.organization_id, 'editor')`.
**Commit:** `12cd576`.

### L3. No allowlist on `platform_settings` keys beyond `master_owner_email` — accepted, not fixed
Any global owner can write an arbitrary key to `platform_settings`, not just the known set the product currently reads. Left as-is: write access is already scoped to global owners (a trusted role), and deciding *which keys should exist* is a product-design question, not a pure security gap. Worth a key allowlist if `platform_settings` grows enough that "an owner can write garbage" becomes an operational problem — not before.

---

## Findings investigated and ruled out

- **`search_path` on every `SECURITY DEFINER` function**: all 51 (up from 46 mid-session, 39 at the last schema baseline) have an explicit `SET search_path TO 'public'`. Re-verified by direct introspection after this phase's own additions — zero exceptions.
- **`survey_segment_summary`'s client-supplied `p_threshold`**: correctly clamped server-side via `greatest(coalesce(p_threshold,5), 5)` — a client cannot lower the suppression floor.
- **`survey_multiselect_distribution` and the identity denylist**: this function was already structurally safe before C1's fix (none of the four restricted columns is `text[]`, so `unnest()` would error) — the denylist added to it is defense-in-depth against a future column-type change, not the closure of an active hole specific to this function.
- **`active_owner_count()`**: already correctly filtered `is_active` before H6 was found — the gap was specifically in `get_user_role`/`can_view_identity`/`is_survey_member`, not universal.
- **`importEmployees`'s per-row insert loop**: deliberately not batched into a single bulk insert. This is existing, considered design (one bad row can't silently fail the whole batch; the caller gets back exactly which rows landed) — not a bug, and out of scope to change under a hardening pass.

---

## Explicitly out of scope for this pass

The governing spec's full ask spans 25 sections; the items below were not started, in the interest of closing every live, exploitable CRITICAL/HIGH/MEDIUM finding first rather than spreading effort across net-new architecture. Each is a substantial, standalone initiative:

- **Service-boundary refactor** (customerService/employeeService/surveyService/etc.) — the codebase's current per-domain `*Store.ts` files are cohesive but not formally layered.
- **Formal state-machine transition functions** for survey/invitation/campaign status, with tests proving illegal transitions fail. Enforcement today is ad-hoc (closed-survey, org-deactivation, and privacy-mode gates were added this phase; campaign status transitions were already gated correctly when built) rather than abstracted into named transition functions.
- **Consistent domain error-code model** across RPCs (today: a mix of `jsonb_build_object('error', 'not_authorised')`-style returns and thrown Postgres exceptions, translated ad-hoc per call site in the TS layer).
- **Structured observability/logging.**
- **Performance and cache-consistency audits.**
- **Rate-limit review** (OTP, test email, bulk send, reminders, invitation generation, response submission).
- **Full DB constraint audit** beyond what surfaced incidentally while fixing the findings above.

## Process notes

Two multi-step debugging sequences are worth naming plainly rather than presenting a cleaned-up final state, since the intermediate migrations are committed to the repo byte-exact:

- **The retroactive-backfill no-op** (H1): the first retrofit loop gated each row on `has_survey_role()`, which reads `auth.jwt()` — empty in a migration's own privileged execution context, so every table was silently skipped. Caught by re-querying `pg_policy` afterward rather than assuming the migration worked; fixed by removing the unnecessary per-row auth check from what is, correctly, an administrative backfill.
- **The RLS-vs-grants saga** (H2): four migrations chased a "permission denied for table organizations" error by granting successive columns (`closed_at`, `organization_id`, `organizations.is_active`, `organizations.id`) before recognizing the real cause — `organizations` has RLS enabled with no anon-admitting policy, so even with every grant satisfied, the joined subquery silently returned zero rows and evaluated to `NULL` (→ `false`), rejecting even legitimately valid rows. The eventual fix replaced the direct join with `SECURITY DEFINER` helper functions (`survey_accepting_responses()`, `organization_is_active()`), matching this codebase's own established pattern (`has_survey_role`, `can_view_identity`), and reverted the now-unneeded grants to keep `anon`'s surface area minimal.

## Verification

- Full test suite: **136/136 passing** (127 pre-existing + 9 new in `csvExport.test.ts`).
- `tsc -b tsconfig.app.json`: clean.
- `npm run build`: clean (pre-existing >500kB chunk-size warning, unrelated to this phase).
- Legacy `public.survey_responses`: reconfirmed exactly 2 rows after every increment.
- `production_email_domain_verified`: reconfirmed `false`.
- All 27 Phase E migrations committed to `apps/supabase/migrations/`, logged in `apps/supabase/MIGRATIONS.md`.
