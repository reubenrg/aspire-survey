-- ═══════════════════════════════════════════════════════════════════════════
-- Sprint 3: additive versioning and schema protection
--
-- Run in project zpefurbbejsarkcgmscg. Select ALL (Ctrl+A) first.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Version snapshots ───────────────────────────────────────────────────
-- Immutable by design: there is no update or delete policy and no grant for
-- either. A version is a record of what was asked, and rewriting history would
-- make the responses stamped with it meaningless.

create table if not exists public.survey_versions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  version_number int not null,
  definition jsonb not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint survey_version_unique unique (survey_id, version_number)
);

create index if not exists survey_versions_survey_idx
  on public.survey_versions (survey_id, version_number desc);

alter table public.survey_versions enable row level security;

-- ── 2. Version pointer ─────────────────────────────────────────────────────
-- `current_version` is the version number of the definition currently sitting
-- in surveys.definition, so every value of it has a matching snapshot row.

alter table public.surveys
  add column if not exists current_version int not null default 1;

-- ── 3. Backfill v1 for surveys that predate versioning ─────────────────────
-- Without this, current_version = 1 would point at a snapshot that does not
-- exist, and the first edit would appear to lose the original.

insert into public.survey_versions (survey_id, version_number, definition, created_by)
select s.id, 1, s.definition, 'backfill'
from public.surveys s
where not exists (
  select 1 from public.survey_versions v
  where v.survey_id = s.id and v.version_number = 1
);

update public.surveys s
set current_version = greatest(
  s.current_version,
  coalesce((select max(v.version_number) from public.survey_versions v where v.survey_id = s.id), 1)
);

-- ── 4. Stamp responses with the version that produced them ─────────────────
-- Added to every table registered in `surveys`, so existing response tables
-- gain the column too rather than only new ones.

do $$
declare r record;
begin
  for r in select distinct table_name from public.surveys where table_name is not null loop
    if r.table_name ~ '^[a-z_][a-z0-9_]*$'
       and to_regclass('public.' || r.table_name) is not null then
      execute format(
        'alter table public.%I add column if not exists definition_version int',
        r.table_name
      );
    end if;
  end loop;
end $$;

-- ── 5. Counting responses without reading them ─────────────────────────────
-- The additive-only guard needs to know whether a survey has responses, but
-- response tables deliberately have no select policy. A count is not a
-- response, so this returns only the number, never a row.
--
-- Takes a slug rather than a table name: the table is resolved from the
-- registry, so a caller cannot point this at an arbitrary relation. The
-- identifier is re-validated anyway before it reaches format().

create or replace function public.survey_response_count(p_slug text)
returns bigint
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  t text;
  org uuid;
  n bigint;
begin
  select table_name, organization_id into t, org
  from public.surveys where slug = p_slug;

  if t is null then return null; end if;
  if not public.has_survey_role(org, 'viewer') then return null; end if;
  if t !~ '^[a-z_][a-z0-9_]*$' then return null; end if;
  if to_regclass('public.' || t) is null then return null; end if;

  execute format('select count(*) from public.%I', t) into n;
  return n;
end $$;

revoke all on function public.survey_response_count(text) from public;
grant execute on function public.survey_response_count(text) to authenticated;

-- ── 6. Policies ────────────────────────────────────────────────────────────

drop policy if exists "Members read survey versions" on public.survey_versions;
create policy "Members read survey versions"
  on public.survey_versions for select to authenticated
  using (public.has_survey_role(
    (select s.organization_id from public.surveys s where s.id = survey_versions.survey_id),
    'viewer'));

drop policy if exists "Editors write survey versions" on public.survey_versions;
create policy "Editors write survey versions"
  on public.survey_versions for insert to authenticated
  with check (public.has_survey_role(
    (select s.organization_id from public.surveys s where s.id = survey_versions.survey_id),
    'editor'));

-- Select and insert only. No update or delete grant, so snapshots are append
-- only even for an owner.
grant select, insert on public.survey_versions to authenticated;

notify pgrst, 'reload schema';

-- ── 7. Proof ───────────────────────────────────────────────────────────────

select 'survey_versions table' as check, count(*)::text as result
  from information_schema.tables where table_schema='public' and table_name='survey_versions'
union all select 'surveys.current_version', count(*)::text
  from information_schema.columns
  where table_schema='public' and table_name='surveys' and column_name='current_version'
union all select 'v1 snapshots backfilled', count(*)::text from public.survey_versions
union all select 'response tables stamped', count(*)::text
  from information_schema.columns
  where table_schema='public' and column_name='definition_version'
union all select 'count function present', count(*)::text
  from information_schema.routines
  where routine_schema='public' and routine_name='survey_response_count';
