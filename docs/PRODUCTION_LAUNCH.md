# Production launch — Aspire Surveys

**Date:** 2026-09-19
**Production URL:** https://aspiresurveys.vercel.app
**Hosting:** Vercel, deploying from `main` of `reubenrg/aspire-survey`. Database/auth/Edge Functions: Supabase project `zpefurbbejsarkcgmscg` (shared by preview and production).

## What changed on launch day

- `admin-platform-v2` was merged into `main` (a fast-forward of the whole admin platform).
- **The original S2M survey was retired.** `/` no longer serves "S2M Health × Aspire — Behaviour & Performance Impact Survey 2026"; it redirects to the admin sign-in (`/admin`). Respondents only ever arrive at `/s/:slug` (open link), `/r/:token` (personal invitation) or `/t/:token` (campaign test).
- 18 files reachable only from that survey were deleted (its app component, 12 step screens, data, submit code, an unused UI primitive and an unused seed definition). The source remains in git history.
- `index.html`'s title was still "S2M Health Employees Survey" on every respondent page; it is now "Aspire Surveys".

## Data reset — STATUS: RUN on 2026-09-19

The founder asked to remove all created customers and surveys and start fresh. The first attempt was blocked by the tool's safety classifier as a mass delete and was deliberately not worked around; after the founder confirmed in chat that everything was test data, the guarded script [`apps/supabase/ops/reset_platform_data.sql`](../apps/supabase/ops/reset_platform_data.sql) was run exactly as committed, in one transaction. It is a one-time operation, **not** a migration (a migration would be replayed on every fresh database). The run recorded a `PLATFORM_RESET` entry in the audit log.

Verified afterwards: 0 customers, surveys, versions, employees, invitations and campaigns; no leftover response tables; 15 built-in templates, 2 active global owners, 5 platform settings and the legacy `survey_responses` table (2 rows) intact; `/s/engine-demo` now reports "Survey not available".

Inventory of what was deleted (the platform is now empty):

| Customer | Active | Surveys | Employees |
|---|---|---|---|
| S2M Health | yes | 5 | 2 |
| Aspire tEST | yes | 1 | 0 |
| Akshara | no | 0 | 0 |
| DNC | yes | 1 (`impact-survey`, 232 invitations) | **232** |
| SKM | yes | 0 | 0 |
| Aspire Internal QA | no | 4 | 6 |
| Sundaram Home | yes | 0 | 0 |
| SH | yes | 1 (`behaviour-change-mu56zo1q`, 232 invitations) | **232** |

Totals: 8 customers, 12 surveys, 11 survey versions, 472 employees, 472 invitations, 9 physical response tables holding 5 QA rows. DNC and SH looked like real imported rosters; the founder confirmed all of it was test data. The deletion is irreversible (no confirmed backups) — re-import from source CSVs if any of it is ever needed.

**Kept on purpose:** the two team owners, the 15 built-in templates, platform settings, audit history, and the legacy `public.survey_responses` table (2 S2M respondent rows — a separate decision).

**Open decision:** the legacy `public.survey_responses` table still holds 2 S2M respondent rows. The founder said "all are only for testing" but that table was deliberately not included in the reset; delete it only on an explicit ask.

## Test data (added 2026-09-19, after the reset)

So every admin section has something to show, [`apps/supabase/ops/seed_test_data.sql`](../apps/supabase/ops/seed_test_data.sql) added clearly-labelled fictional data: two customers ("Northwind Demo Co (TEST)", "Globex Demo Ltd (TEST)"), 50 synthetic employees (`@example.com`), four surveys (three live with ~100 responses, one draft) covering every new question type, plus their invitations. It ran as a temporary team member `seed-bot@example.test` (removed at the end of the same transaction) so the real `ensure_survey_response_table()` created the response tables. The audit log records it as `TEST_DATA_SEEDED`.

**Remove it before real customers go in:** run [`apps/supabase/ops/remove_test_data.sql`](../apps/supabase/ops/remove_test_data.sql). It touches only rows tied to the two `-demo-test` customers. The 28-question starter library is real content and is not removed.

The open-link test survey (`/s/test-customer-satisfaction`) is public; its one extra response (65 rather than 64) came from an end-to-end check of the respondent flow.

## Founder actions (not possible from the tooling used to build this)

1. **Domain / Vercel project.** `aspiresurveys.vercel.app` is a production domain of the existing Vercel project `s2m-aspire-survey` (verified: the production deployment of `main` carries it as an alias, and it is publicly reachable). The old `s2m-aspire-survey.vercel.app` address was removed and now returns `DEPLOYMENT_NOT_FOUND`. The project is still *named* `s2m-aspire-survey`; renaming it in Vercel is cosmetic. Old deployment snapshots (including the S2M survey) are SSO-protected, not public, but can be deleted in the Vercel dashboard if you want them gone entirely.
2. **Supabase Auth.** Set *Site URL* to `https://aspiresurveys.vercel.app` and add it to the redirect allow-list. The 6–10 digit code in the sign-in email works regardless; the emailed link uses the Site URL. Confirm *Allow new users to sign up* is **off** (only two accounts exist, both owners).
3. **Edge Function secret `PUBLIC_APP_ORIGIN`** must be `https://aspiresurveys.vercel.app`, or campaign links will point at the wrong host. Campaign sending stays disabled until `production_email_domain_verified` is set, which is intended.
4. **Backups.** The Supabase project is on the free plan: no confirmed backups or restore, and free projects pause after a week of inactivity. Upgrade before real customer data goes in. See `DISASTER_RECOVERY.md`.
5. **Vercel plan.** The team is on Vercel's Hobby tier, which is meant for non-commercial use; check against Vercel's current terms for a customer-facing product.

## Rollback

- **Frontend:** Vercel Instant Rollback to the previous production deployment (the last S2M-era build is `dpl_FyNM3QUmJzfixVYgFR194A18XgnS`, `main` at `9062424`). Not exercised.
- **Database:** every schema change is a committed migration in `apps/supabase/migrations/`, but **data deleted by the reset script cannot be restored**.
