# Disaster Recovery — Aspire Surveys

**Date:** 2026-09-18
**Purpose:** state plainly what recovery capability actually exists and has actually been tested, versus what is assumed but unverified. Nothing here should be read as "we can restore" unless it's marked VERIFIED — an untested assumption about backup/restore is worse than no plan at all, because it fails exactly when it's needed.

---

## Summary table

| Capability | Status | Basis |
|---|---|---|
| Migrations are version-controlled and replayable | **VERIFIED** | `apps/supabase/migrations/` (24 files, 2026-09-17 onward) applied in order against the schema state in `apps/supabase/schema_snapshot.sql` reproduces current schema; every file's SQL was pulled byte-exact from Supabase's own `supabase_migrations.schema_migrations` table |
| Legacy S2M data (`public.survey_responses`) has stayed intact throughout this project's work | **VERIFIED** | Row count reconfirmed at exactly 2 after every hardening increment this phase, by direct query |
| Supabase automated backups are enabled for this project | **UNVERIFIED** | See [Database backups](#database-backups) below — this project is on Supabase's **free** plan, and no tool available in this session can confirm what backup policy is actually active |
| A database restore has ever been performed or tested | **NOT DONE** | No restore, PITR, or backup-download has been attempted at any point in this project's history |
| Frontend (Vercel) rollback works | **UNVERIFIED** | Standard Vercel behavior (redeploy a prior deployment) is assumed to apply, but has not been exercised for this project in this session |
| A documented, rehearsed recovery runbook exists | **NO** | This document is the first pass at one; it has not been rehearsed end-to-end |

---

## Database backups

**This Supabase organization ("Aspire") is on the `plan: free` tier**, confirmed via direct API query on 2026-09-18. This matters because Supabase's backup guarantees differ materially by plan, and Free-tier projects historically have much weaker (or no) automated backup coverage than paid tiers, can be subject to inactivity pausing, and do not include Point-in-Time Recovery.

**What is NOT known from this session:** the exact backup policy currently active for project `zpefurbbejsarkcgmscg` — whether daily backups are running at all, what their retention window is, and whether they've ever successfully completed. No MCP tool available in this session exposes backup status; this can only be confirmed from the Supabase dashboard's Database → Backups page directly, by someone with dashboard access.

**Action needed before this can honestly be called "covered":**
1. Whoever has Supabase dashboard access should check Database → Backups and record what's actually there (daily backups present? how far back? any PITR?).
2. If backup coverage is inadequate for the plan tier, decide whether to upgrade the Supabase plan before this product holds real customer response data at scale, or set up an external backup (e.g., a scheduled `pg_dump` to external storage) as a stopgap.
3. Once real backups exist, **perform an actual test restore** (to a separate/branch project, never production) and record what worked, what didn't, and how long it took. Until that happens, "we have backups" and "we can recover" are two different, unverified claims.

## Schema and code recovery (separate from data recovery)

Unlike the database's row data, the **shape** of the database and the application code are both fully recoverable independent of any Supabase backup feature:

- **Schema**: `apps/supabase/schema_snapshot.sql` (byte-exact as of 2026-09-16) plus every migration in `apps/supabase/migrations/` from `20260917033741` onward (byte-exact, pulled from Supabase's own migration history) together describe the current schema. Rebuilding a fresh Postgres database to today's schema shape (empty of data) is mechanically possible by applying the snapshot's DDL followed by the migrations in order — this has not been executed as a rehearsal, but the pieces exist and are version-controlled.
- **Application code**: this is a normal git repository on GitHub (`reubenrg/aspire-survey`), branch `admin-platform-v2`. Standard git/GitHub durability applies — this is not a special risk area.
- **Edge Functions**: `apps/supabase/functions/send-campaign/index.ts` is committed to the repo and was redeployed from that exact file (version 4, 2026-09-18) — the deployed function and the repo file are confirmed in sync as of this writing.

## What would actually happen today, by failure mode

Stated plainly rather than optimistically:

- **Someone accidentally drops a table or bad-updates a lot of rows**: recovery depends entirely on whatever Supabase backup/PITR is actually active (unverified — see above). Without a confirmed, tested backup, there is currently **no verified way to recover lost or corrupted response data**.
- **The Supabase project itself is lost/deleted/becomes inaccessible**: schema and code are recoverable (see above); response *data* is not, unless a backup exists (unverified).
- **A bad code deploy ships to Vercel**: redeploying a previous Vercel deployment is the standard mechanism and is assumed to work, but has not been exercised in this project.
- **A bad migration is applied**: none of the 25 migrations applied this phase included a destructive `DROP`/`TRUNCATE` — all were additive or corrective (confirmed by reading each one). This is a project convention (`apps/supabase/MIGRATIONS.md` states it explicitly), not a technical safeguard — a future migration that violates it would not be automatically blocked.

## Recommendation

The single highest-value next step for real disaster-recovery posture is not more code — it's **someone with Supabase dashboard access confirming what backup coverage actually exists today**, and then a rehearsed test restore. Everything else in this document is either already true (schema/code recovery) or blocked on that one unverified fact.
