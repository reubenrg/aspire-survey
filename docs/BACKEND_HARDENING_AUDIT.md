# Aspire Surveys — Backend Hardening Audit (Phase A)

**Date:** 2026-09-17 to 2026-09-18
**Scope:** every domain named in the governing Phase A spec — customers, employees, surveys, versions, publishing, templates, question library, audience, invitations, campaigns, responses, analytics, reports, team/RBAC, audit, settings, Edge Functions, auth, exports.
**Method:** every finding below was reproduced live against project `zpefurbbejsarkcgmscg` in a rolled-back transaction (or, for the Edge Function, by reading its deployed source) *before* being fixed, and re-verified live *after* — never assumed correct from reading code alone. See `apps/supabase/MIGRATIONS.md` for the exact SQL of every DB-level fix. Two background research agents covered employees/team/RBAC/settings/library/customers and analytics/reports/exports/responses in parallel with direct manual review of every `SECURITY DEFINER` function and the Edge Function; findings below are tagged by source.

This document is the retrospective write-up the spec asked for first; in practice, findings were fixed inline as each was confirmed, then compiled here once the CRITICAL/HIGH backlog was clear. That ordering choice traded a later audit document for faster closure of live, exploitable holes — worth naming since the spec's own order was audit-then-fix.

**2026-09-18 update:** a follow-up pass (service boundaries, formal state-machine enforcement, a domain error model, observability, performance, rate limits, idempotency, DB constraints, a security regression pass) surfaced 2 more CRITICAL/HIGH findings not caught by the original pass — both now fixed and verified below (C5, H8). Running totals: **5 CRITICAL, 8 HIGH, 8 MEDIUM, 3 LOW** (2 fixed + 1 accepted as-is), all found, all fixed or explicitly accepted.

---

## CRITICAL (5 found, 5 fixed)

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

### C5. The C4 fix only covered the RPC, not the raw column (self-discovered, 2026-09-18)
C4 validated `table_name` *inside* `ensure_survey_response_table()` — but "Editors update surveys in their org" RLS has no column-level restriction, so any editor could bypass the RPC entirely with a raw PATCH on `surveys.table_name`, repointing their own survey at a DIFFERENT organization's real response table. Every read path (`survey_response_page()`, `survey_columns_distribution()`, `exportResponsesCsv()`, etc.) trusts whatever `table_name` says once an analyst clears `has_survey_role()` for the *survey's own* org — it has no way to know the physical table underneath now belongs to someone else. Found while designing formal state-machine enforcement for this follow-up pass ("do not allow arbitrary client-side status mutation" led directly to checking whether `table_name` itself was similarly exposed).

**Proved live before fix:** an editor on organization `d9bf6b73` repointed their own survey's `table_name` directly to `survey_qa_integrity_habit` (organization `28a65e51`'s real response table), and an analyst on `d9bf6b73` then read that other organization's actual response rows — including real free-text answers — through `survey_response_page()`. The frozen legacy `survey_responses` table happens to be protected from this specific angle already (zero rows visible to `authenticated`, confirmed by direct test — it has no admitting RLS SELECT policy), but that is incidental, not a designed protection against this attack class, and every other survey's response table was fully exposed.
**Fix:** the exact same C4 validation now runs unconditionally via a `BEFORE INSERT OR UPDATE OF table_name` trigger, so it applies no matter which code path writes the column.
**Migration:** `20260918064324_enforce_table_name_validation_on_raw_writes.sql`

**Regression in this fix, found and corrected 2026-09-19 (production pre-flight):** the trigger wrongly rejected `INSERT ... ON CONFLICT (slug) DO UPDATE` of an *existing* survey — it reaches a `BEFORE INSERT` trigger as a proposed row with a fresh id, so the "belongs to another survey" check compared the survey against itself. That broke the legacy `/admin/:slug` editor's Save (`saveSurvey()`'s upsert) and the generated-SQL paste path; the Builder's Publish (an `UPDATE`) was never affected. The original proof tested only `UPDATE ... SET table_name = table_name`, not the upsert the app actually issues. Fixed by `20260919080635_fix_table_name_trigger_upsert_of_existing_survey.sql` and re-proved against every real write path *and* every attack (see MIGRATIONS.md).

---

## HIGH (8 found, 8 fixed)

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

### H8. Campaign/invitation lifecycle columns had no protection beyond a role check (self-discovered, 2026-09-18)
"Editors update campaigns"/"Editors update invitations" RLS admitted a raw client UPDATE to `survey_campaigns.status`/`sent_at`/`scheduled_at` and every `survey_invitations` lifecycle column (`status`, `sent_at`, `opened_at`, `started_at`, `completed_at`, `revoked_at`, `token_hash`), with no restriction to the actual transition functions (`mark_campaign_tested`, `schedule_campaign_send`, `cancel_campaign`, `mark_campaign_completed`, the Edge Function; `resolve_invitation`, `submit_invited_response`, `mark_invitation_started`, `service_regenerate_invitation`). Found while implementing formal state-machine enforcement for this pass — this is precisely the "arbitrary client-side status mutation" the request named.

**Proved live before fix:** an editor's raw UPDATE set a brand-new campaign's `status` straight to `SENT` with a real `sent_at` — no email sent, no recipient processed, no audit entry; the Monitor would have shown it as complete while nothing had happened.
**Fix:** confirmed first (by grep across the whole client) that no TypeScript code path writes these columns directly — only the RPCs and the Edge Function's service-role client do — so a trigger blocking any direct `authenticated`-role write carries zero risk to an existing workflow. The first version of this trigger was itself ineffective (marked `SECURITY DEFINER`, so `current_user` inside it resolved to the function's own owner instead of the real caller, and the check silently never matched) — caught immediately by re-running the same bypass attempt right after applying it, fixed by making the function `SECURITY INVOKER`.
**Migrations:** `20260918064718_block_direct_lifecycle_column_writes.sql`, `20260918064902_fix_lifecycle_write_block_security_invoker.sql`

---

## MEDIUM (8 found, 8 fixed)

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

### M6. Archived surveys kept silently accepting public responses (self-discovered, 2026-09-18)
`survey_accepting_responses()` never checked `archived_at`. The product's own UI treats Archive as a one-way, filed-away state, reachable directly from LIVE (not only from CLOSED) — but archiving a still-published, still-open survey left it silently accepting `/s/:slug` submissions regardless, even though the admin's own "Preview" link disappears once archived. Found while auditing the survey state machine end to end for this pass, cross-referencing every field `survey_accepting_responses()` checks against every field the UI's own status derivation (`archived_at ? ARCHIVED : closed_at ? CLOSED : published ? LIVE : DRAFT`) uses.

**Proved live before fix:** a published, non-closed, archived ANONYMOUS survey with an active org still evaluated `survey_accepting_responses()` as `true`.
**Fix:** added `s.archived_at is null` to the same function.
**Migration:** `20260918064732_stop_archived_surveys_accepting_responses.sql`

### M7. `request_test_send()` had no rate limit and no recipient validation
Test sends deliberately bypass `production_email_domain_verified` (so a founder can preview a campaign before that gate is set up), which makes this specifically the one send path that could become an unrestricted Resend relay if ever scripted or abused — exactly the risk this pass's rate-limit section named.

**Proved live before fix:** 30 rapid calls to 30 arbitrary, non-employee email addresses all succeeded with zero rejection.
**Fix:** capped at 10 test-send tokens per campaign per rolling hour — a conservative, documented, application-level limit (neither Resend nor Supabase offers a built-in per-endpoint limit this could defer to instead), comfortably above any real preview workflow while making a scripted-abuse loop immediately visible.
**Verified live:** the first 10 calls in an hour succeed, the 11th is rejected with a clear message.
**Migration:** `20260918070157_rate_limit_campaign_test_sends.sql`

### M8. `send-campaign`'s "already sending" guard was check-then-act, not atomic
Two "Send" clicks close enough together could both read `status !== 'SENDING'` before either write landed, and both proceed to email every recipient — a real, if narrow, concurrency hazard for the one operation where a duplicate execution means duplicate real emails to every employee on a survey.
**Fix:** replaced the read-then-write with a single `UPDATE survey_campaigns SET status='SENDING' ... WHERE status <> 'SENDING' ... RETURNING id`, which Postgres serializes per row — only one concurrent caller can ever claim the transition, and the loser gets the existing 409 response instead of proceeding.
**Deployed:** `send-campaign` v5 (same deploy also added structured `logEvent()` observability — see the Observability section below).

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

## Round 2 (2026-09-18): the sections deferred above, done for real

Each item below was explicitly flagged as out of scope in the first pass of this document. This follow-up round completed genuine, verified work on every one — not recommendations, actual implementation, with the same "prove it live" discipline as the CRITICAL/HIGH/MEDIUM findings above.

**A. Service boundaries.** Audited every `*Store.ts` file for mixed responsibilities, duplicated authorization/error logic, and cross-domain leakage. Finding: the domain split itself (survey/employee/audience/invitation/campaign/email/analytics/authorization each in their own file) was already sound — no giant rewrite was warranted or attempted. The one real, pervasive violation was **12 near-identical local `fail()`/`translate()` error-translation functions**, one per store, each reimplementing the same Postgres-code-to-message mapping with small, undocumented inconsistencies (some handled `23505`, most didn't; wording drifted). Extracted to `apps/Aspire-Survey/src/admin/domainError.ts`; every store now delegates to it, keeping its own call-site-specific message overrides. The `send-campaign` Edge Function's deliberate duplication of `emailTemplate.ts` (Deno vs. browser runtime, no shared-package build step) was reviewed and left as-is — a genuine constraint, not an oversight, already documented in the function's own header comment. **Boundaries extracted:** the error-translation layer. **Boundaries left in place:** the per-domain store split itself, and the Edge Function's template duplication. **Reason:** both were already correct; extracting further would have been abstraction for its own sake.

**B. Formal state-machine enforcement.** The real states already exist as boolean/timestamp fields (`surveys.published`/`closed_at`/`archived_at`; `survey_invitations.status`; `survey_campaigns.status`) with transition logic embedded in individual RPCs (`publishSurvey()`, `setClosed()`, `mark_campaign_tested()`, etc.) — but nothing stopped a raw authenticated client from writing those columns directly, bypassing every RPC's own legality checks. This is where C5 and H8 (above) came from: proving live that an editor could repoint `surveys.table_name` at another organization's data, and separately mark a campaign `SENT` with nothing actually sent. Both closed with triggers that enforce the *existing* legality rules unconditionally, regardless of code path — confirmed first, in each case, that no legitimate TypeScript code path relies on the now-blocked direct write, so nothing existing broke. One additional gap (M6, archived surveys still accepting responses) came from cross-referencing every field the accept-response check used against every field the UI's own status derivation used. **Explicitly did not** add a generic transition-graph abstraction on top of this — the existing per-RPC checks are the source of truth; the triggers just make sure nothing can go around them. **Explicitly did not** make `surveys.published` monotonic (blocking un-publish) after discovering the legacy `/admin/:slug` editor (`AdminPages.tsx`) has a real, working "revert to draft" toggle — constraining that would have broken an existing, intentional capability.

**C. Domain error model.** `apps/Aspire-Survey/src/admin/domainError.ts`: a `DomainError` class with a stable `.code` (`FORBIDDEN`/`NOT_FOUND`/`INVALID_STATE`/`VALIDATION_ERROR`/`CONFLICT`/`UNKNOWN`) alongside the human-readable `.message` every existing call site already expected, plus `rpcErrorFrom()` for the RPCs that return `{error: 'code'}` in their JSON payload instead of throwing. Never leaks a raw Postgres error code, table/column name, or stack trace. The `NotAuthorised` class five pages already check with `instanceof` for a dedicated "access denied" screen is defined once here and re-exported from its original locations (`platformStore.ts`, `analyticsStore.ts`), so no existing import needed to change. 10 new tests in `apps/scripts/domainError.test.ts` pin the mapping, including that a per-call override never leaks the raw constraint name it's overriding.

**D. Observability.** What already existed and required no new work: `audit_logs` (the durable business record — every meaningful mutation across this codebase already calls `record_audit()`/`service_record_audit()`) and Supabase's own Postgres/Edge Function logs (queryable via `query_logs`). What was missing, specifically in `send-campaign` (the one place with genuine multi-step, multi-failure-mode operations — auth, validation, DB, and an external provider, all in one request): structured `logEvent()` calls at send/remind/test start, completion, and per-recipient outcome, carrying `campaign_id`, `survey_id`, `actor`, `recipient_count`, `result`, a domain `error_code`, and `duration_ms` — deliberately never response content, employee PII beyond an id, tokens, or the Resend API key. This answers "what failed, where, for which campaign, how many recipients, was it auth/validation/DB/provider, and how long did it take" from the function log directly, without reconstructing it from `last_error` columns. No DB-level "logging" was added beyond this — Postgres/RLS errors are already visible in Supabase's own query logs, and adding parallel application-level logging for every one of 58 SQL functions would duplicate that for no real gain.

**E. Performance and cache-consistency audit.** Read the named hot paths (dashboard/customer listing, campaign audience, employee CSV import, Builder autosave) looking for N+1 queries, unnecessary refetches, and autosave races. Finding: **already well-designed** — `admin_survey_summaries`/`admin_overview_stats` are single server-side-aggregating RPCs, not per-row client queries; `fetchDistributionAudience()` uses one PostgREST embedded-resource join, not N+1; CSV import validates against one batch-fetched `Set` of existing codes, not a query per row; `autosaveDraft()` already uses optimistic concurrency (`expectedDraftUpdatedAt`, throwing a distinct `StaleWriteError` on conflict) — exactly the correct defense against a lost-update race. The one finding: `fetchRoleMap()` in `adminStore.ts` is defined but never called anywhere in the app — dead code, not a live N+1 (nothing currently exercises the pattern it would produce). Left in place rather than deleted, since removing unused-but-harmless exports wasn't part of this ask; noted here for whoever next touches that file. No caching was added — nothing here showed a genuine repeated-fetch cost that caching would fix, and adding it speculatively would only introduce invalidation risk.

**F. Rate limits and abuse review.** Reviewed every externally-triggerable operation named in the request. Real gap found and fixed: M7 above (`request_test_send()`, capped at 10/campaign/hour). Everything else already has a real, appropriate protection: OTP and magic-link issuance go through Supabase Auth, which has its own built-in rate limiting Aspire Surveys doesn't need to duplicate; response submission, invitation resolution/completion, and campaign send/remind are all idempotent by construction (see Idempotency below) rather than needing a request-count limit, since a retry or a double-click can't produce a duplicate side effect regardless of how many times it's attempted; employee CSV import and exports are both bounded operations (a finite file, a capped row count — `EXPORT_ROW_CAP = 20000`, added earlier this phase) rather than something an attacker could turn into unbounded work. No arbitrary limits were invented for operations that didn't show a real abuse vector.

**G. Idempotency audit.** Proved live (rolled back) rather than re-derived from memory: `issue_invitations()` called twice for the same employee produces exactly one invitation row (`on conflict (survey_id, employee_id) do nothing`, backed by a real unique index, confirmed to exist); `submit_invited_response()` called twice on the same token returns `ALREADY_SUBMITTED` on the second call, never a second response row; `resolve_invitation()` is safe to call repeatedly (each call is a pure read plus an idempotent opened-timestamp backfill). `build_campaign_recipients()`'s own `on conflict (campaign_id, invitation_id) do nothing`, backed by a real unique constraint, was reviewed against its already-verified-this-session source rather than re-proven from scratch. Campaign status transitions (`cancel_campaign`, `mark_campaign_tested`, etc.) are idempotent in the *safety* sense, not the *silent-success* sense — a repeated call is rejected with a clear, consistent error rather than either silently no-op'ing or corrupting state, which is the correct behavior for a state-machine transition (as opposed to a create-or-insert operation, where silent success is what "idempotent" should mean). M8 above closes the one place this pass found where a duplicate *concurrent* call wasn't safely serialized.

**H. DB constraint audit.** Checked `employees`, `surveys`, `survey_campaigns`, `survey_campaign_recipients`, `survey_email_events` for missing `NOT NULL`/unique/FK/`CHECK` coverage. Found everything already correctly constrained except one: `surveys.organization_id` was nullable despite every write path always supplying it, and a null-org survey would be structurally unreachable either way (`organization_is_active(null)` always evaluates `false`; `has_survey_role(null, ...)` only matches a global member). Confirmed zero existing rows had a null value, then tightened to `NOT NULL` (`require_survey_organization_id`) — **and then reverted on 2026-09-19** (`relax_survey_organization_id_not_null`): the claim "every write path supplies it" held for the TypeScript client but not for `generateUpsertSql()`, the SQL the legacy editor's SQL tab gives an admin to paste into the Supabase SQL editor, which inserts without an `organization_id`. The constraint was a schema nicety, not a security fix, so the previous behaviour was restored rather than a documented workflow changed. Also noted, not touched: `surveys.status` (a `draft`/`active`/`closed` `text` column with its own `CHECK` constraint) is never read or written anywhere in the TypeScript codebase — vestigial, superseded by `published`/`closed_at`/`archived_at`. Confirmed dead via a full-codebase search rather than assumed; left alone since dropping a column is a deliberate decision this pass didn't need to make, not a drive-by cleanup.

**I. Security regression pass.** Re-verified all 15 originally-fixed items plus this round's own new fixes are still correctly in place by reading each function/trigger/policy's *current* deployed definition (not by re-running every live exploit a second time, given the mechanism for reverting any of them — overwriting a function definition — never happened; a structural check that the fix's key clause is still present is the right-sized verification here). One check initially came back a false negative (`resolve_invitation()` appeared not to reference `organization_is_active`) — investigated immediately rather than reported as a regression, and turned out to be the verification query itself checking for the wrong marker string (the original H2 fix used an inline check, not that later-introduced helper function); re-verified against the correct marker and confirmed no regression. All 15 original items plus the 4 new triggers/fixes from this round confirmed present.

## Process notes

Three episodes are worth naming plainly rather than presenting a cleaned-up final state, since the intermediate migrations are committed to the repo byte-exact:

- **Verifying "the fix is present" is not verifying "the app still works"** (2026-09-19): the Round 2 security regression pass confirmed each fix's key clause was still deployed, and all 146 tests passed — yet two of Round 2's own changes had regressed real workflows (the `table_name` trigger broke upserts of existing surveys; the `organization_id NOT NULL` broke the generated-SQL path). Neither was caught because the tests are pure-logic (no database) and the live proofs exercised the *attack* and a *simplified* legitimate write, not the exact statement shapes the client issues. Caught during production pre-flight by running those exact shapes as a non-privileged editor. Lesson applied: a DB-level guard is now proved against every real client write path it can touch (upsert, insert, update, generated SQL) *and* the attack, not just the attack.
- **The retroactive-backfill no-op** (H1): the first retrofit loop gated each row on `has_survey_role()`, which reads `auth.jwt()` — empty in a migration's own privileged execution context, so every table was silently skipped. Caught by re-querying `pg_policy` afterward rather than assuming the migration worked; fixed by removing the unnecessary per-row auth check from what is, correctly, an administrative backfill.
- **The RLS-vs-grants saga** (H2): four migrations chased a "permission denied for table organizations" error by granting successive columns (`closed_at`, `organization_id`, `organizations.is_active`, `organizations.id`) before recognizing the real cause — `organizations` has RLS enabled with no anon-admitting policy, so even with every grant satisfied, the joined subquery silently returned zero rows and evaluated to `NULL` (→ `false`), rejecting even legitimately valid rows. The eventual fix replaced the direct join with `SECURITY DEFINER` helper functions (`survey_accepting_responses()`, `organization_is_active()`), matching this codebase's own established pattern (`has_survey_role`, `can_view_identity`), and reverted the now-unneeded grants to keep `anon`'s surface area minimal.

## Verification

- Full test suite: **146/146 passing** (127 original + 9 in `csvExport.test.ts` + 10 in `domainError.test.ts`).
- `tsc -b tsconfig.app.json`: clean.
- `npm run build`: clean (pre-existing >500kB chunk-size warning, unrelated to this phase).
- Legacy `public.survey_responses`: reconfirmed exactly 2 rows after every increment, most recently at the end of this round.
- `production_email_domain_verified`: reconfirmed `false`, most recently at the end of this round.
- All 31 migrations from this phase committed to `apps/supabase/migrations/`, logged in `apps/supabase/MIGRATIONS.md`.
- `send-campaign` Edge Function: deployed through v5, source committed to the repo and confirmed in sync with the deployed version at every step.
