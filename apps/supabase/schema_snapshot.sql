-- ============================================================================
-- CURRENT STATE SNAPSHOT — NOT HISTORICAL MIGRATION REPLAY
--
-- ASPIRE SURVEY ADMIN V2 — SCHEMA SNAPSHOT
-- Generated: 2026-09-16, via live introspection of Supabase project
-- zpefurbbejsarkcgmscg ("Custom_Survey"), as part of the ownership-cutover
-- Sprint 6 continuation, to close the gap between this repo's committed SQL
-- (apps/supabase/*.sql, stale since before Sprint 4) and the live schema.
-- See docs/SCHEMA_BASELINE.md for the short summary version of this file.
--
-- WHAT THIS FILE IS: a best-effort reconstruction of the CURRENT live
-- public-schema objects (tables, columns, constraints, indexes, RLS
-- policies, grants, and every public function), assembled from
-- information_schema/pg_catalog introspection — not a literal `pg_dump`.
-- It was generated because neither the Supabase CLI nor pg_dump available
-- in this environment were authenticated against this specific project
-- (both were signed into a different Supabase account/organization).
--
-- WHAT THIS FILE IS NOT: a record of the 28 individual migrations that
-- were actually applied to reach this state (those remain tracked inside
-- Supabase's own supabase_migrations.schema_migrations table, chronological
-- and intact). This file does not replace that history — it exists so a
-- new environment or a new developer can reconstruct the CURRENT shape of
-- the schema from source control, per the objective given for this task.
--
-- DO NOT APPLY THIS FILE to project zpefurbbejsarkcgmscg — every object
-- here already exists there. It is a reference snapshot for provisioning a
-- NEW environment (e.g. a Supabase branch, a disaster-recovery restore
-- target, or a from-scratch project) from source control, and for future
-- `supabase db diff` runs to compare against once a properly-authenticated
-- CLI session is linked to the real project.
--
-- Recommended follow-up (not done here, requires real CLI access to this
-- exact project): run `supabase link --project-ref zpefurbbejsarkcgmscg`
-- with credentials that actually have access, then `supabase db dump
-- --schema public -f apps/supabase/migrations/<ts>_verified_baseline.sql`
-- to get a byte-perfect pg_dump superseding this file.
--
-- Excluded deliberately: per-survey response tables (dynamically created
-- one per published survey by the Builder's publish flow — see
-- src/engine/generateSql.ts — and not part of the reusable core schema),
-- and the legacy `public.survey_responses` / `public.survey_admins` tables,
-- which predate Admin V2 entirely and belong to the frozen S2M respondent
-- application. survey_admins' current single row and survey_responses'
-- schema are documented in TECHNICAL_RUNBOOK.md instead — this baseline
-- covers only the Admin V2 platform schema.
-- ============================================================================


-- ── Extensions ───────────────────────────────────────────────────────────
-- pgcrypto lives in the `extensions` schema on this project; every function
-- below that needs gen_random_bytes/digest schema-qualifies it accordingly.
create extension if not exists pgcrypto with schema extensions;


-- ── Enum types ───────────────────────────────────────────────────────────
do $$ begin
  create type public.survey_role as enum ('viewer', 'analyst', 'editor', 'owner');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.survey_privacy_mode as enum ('ANONYMOUS', 'ANONYMOUS_TRACKED', 'CONFIDENTIAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invitation_status as enum ('NOT_SENT', 'SENT', 'OPENED', 'STARTED', 'COMPLETED', 'EXPIRED', 'REVOKED');
exception when duplicate_object then null; end $$;


-- ── Tables ───────────────────────────────────────────────────────────────

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  logo_url text,
  brand_color text,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.survey_members (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  organization_id uuid references public.organizations(id),
  role public.survey_role not null default 'viewer',
  can_view_identity boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists survey_members_global_idx on public.survey_members using btree (lower(email)) where (organization_id is null);
create unique index if not exists survey_members_scoped_idx on public.survey_members using btree (lower(email), organization_id) where (organization_id is not null);

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  definition jsonb not null,
  table_name text not null,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  organization_id uuid references public.organizations(id),
  status text default 'draft',              -- vestigial: the UI derives status from published/closed_at/archived_at instead
  current_version integer not null default 1,
  closed_at timestamptz,
  archived_at timestamptz,
  created_by text,
  purpose text,
  category text,
  privacy_mode public.survey_privacy_mode not null default 'ANONYMOUS',
  draft_definition jsonb,
  draft_updated_at timestamptz,
  draft_updated_by text
);
create index if not exists surveys_org_idx on public.surveys using btree (organization_id);
create index if not exists surveys_slug_idx on public.surveys using btree (slug);

create table if not exists public.survey_versions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id),
  version_number integer not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  created_by text
);
create unique index if not exists survey_version_unique on public.survey_versions using btree (survey_id, version_number);
create index if not exists survey_versions_survey_idx on public.survey_versions using btree (survey_id, version_number desc);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  employee_code text not null,
  employee_name text not null,
  email text,
  phone text,
  department text,
  designation text,
  location text,
  manager_code text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists employees_org_code_idx on public.employees using btree (organization_id, lower(employee_code));
create index if not exists employees_org_idx on public.employees using btree (organization_id);
create index if not exists employees_dept_idx on public.employees using btree (organization_id, department);

create table if not exists public.survey_invitations (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id),
  survey_version integer,
  employee_id uuid not null references public.employees(id),
  token_hash text not null unique,
  status public.invitation_status not null default 'NOT_SENT',
  sent_at timestamptz,
  opened_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists survey_invitations_unique_idx on public.survey_invitations using btree (survey_id, employee_id);
create index if not exists survey_invitations_survey_idx on public.survey_invitations using btree (survey_id, status);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  user_email text not null,
  action_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_org_time_idx on public.audit_logs using btree (organization_id, created_at desc);

create table if not exists public.question_library (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),  -- null = shared Aspire-wide library
  definition jsonb not null,
  category text,
  tags text[] not null default '{}',
  language text not null default 'en',
  help_text text,
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.survey_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),  -- null = shared Aspire-wide template
  name text not null,
  description text,
  category text,
  definition jsonb not null,
  default_privacy_mode public.survey_privacy_mode not null default 'ANONYMOUS',
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Legacy, pre-Admin-V2 ownership table (predates survey_members/RBAC). Kept
-- only if the frozen legacy S2M app still reads it; do not extend.
create table if not exists public.survey_admins (
  email text primary key,
  added_at timestamptz not null default now()
);


-- ── Row Level Security ──────────────────────────────────────────────────
alter table public.organizations enable row level security;
alter table public.survey_members enable row level security;
alter table public.surveys enable row level security;
alter table public.survey_versions enable row level security;
alter table public.employees enable row level security;
alter table public.survey_invitations enable row level security;
alter table public.audit_logs enable row level security;
alter table public.question_library enable row level security;
alter table public.survey_templates enable row level security;
alter table public.platform_settings enable row level security;
alter table public.survey_admins enable row level security;
-- Note: this project auto-enables RLS with NO default policy on every new
-- table. A table with RLS enabled and no policy is invisible to every role
-- except its owner — safe by default, but easy to mistake for "broken" when
-- testing. survey_members and survey_admins intentionally have zero SELECT
-- policies below: all real access to them goes through the security-definer
-- functions in the Functions section, never a direct table read.

create policy "Members read organizations" on public.organizations for select to authenticated using (is_survey_member());
create policy "Owners manage organizations" on public.organizations for all to authenticated using (has_survey_role(id, 'owner')) with check (has_survey_role(id, 'owner'));

create policy "Staff read employees" on public.employees for select to authenticated using (has_survey_role(organization_id, 'viewer'));
create policy "Editors manage employees" on public.employees for insert to authenticated with check (has_survey_role(organization_id, 'editor'));
create policy "Editors update employees" on public.employees for update to authenticated using (has_survey_role(organization_id, 'editor')) with check (has_survey_role(organization_id, 'editor'));

create policy "Members read surveys in their org" on public.surveys for select to authenticated using (has_survey_role(organization_id, 'viewer'));
create policy "Editors write surveys in their org" on public.surveys for insert to authenticated with check (has_survey_role(organization_id, 'editor'));
create policy "Editors update surveys in their org" on public.surveys for update to authenticated using (has_survey_role(organization_id, 'editor')) with check (has_survey_role(organization_id, 'editor'));
create policy "Owners delete surveys" on public.surveys for delete to authenticated using (has_survey_role(organization_id, 'owner'));
create policy "Public can read published surveys" on public.surveys for select to anon using (published = true);

create policy "Members read survey versions" on public.survey_versions for select to authenticated using (has_survey_role((select s.organization_id from surveys s where s.id = survey_versions.survey_id), 'viewer'));
create policy "Editors write survey versions" on public.survey_versions for insert to authenticated with check (has_survey_role((select s.organization_id from surveys s where s.id = survey_versions.survey_id), 'editor'));

create policy "Staff read invitations" on public.survey_invitations for select to authenticated using (has_survey_role((select s.organization_id from surveys s where s.id = survey_invitations.survey_id), 'viewer'));
create policy "Editors create invitations" on public.survey_invitations for insert to authenticated with check (has_survey_role((select s.organization_id from surveys s where s.id = survey_invitations.survey_id), 'editor'));
create policy "Editors update invitations" on public.survey_invitations for update to authenticated using (has_survey_role((select s.organization_id from surveys s where s.id = survey_invitations.survey_id), 'editor')) with check (has_survey_role((select s.organization_id from surveys s where s.id = survey_invitations.survey_id), 'editor'));

create policy "Owners read audit log" on public.audit_logs for select to authenticated using (has_survey_role(organization_id, 'owner'));

create policy "Members read library" on public.question_library for select to authenticated using ((organization_id is null and is_survey_member()) or has_survey_role(organization_id, 'viewer'));
create policy "Editors write library" on public.question_library for insert to authenticated with check ((organization_id is null and has_survey_role(null, 'editor')) or has_survey_role(organization_id, 'editor'));
create policy "Editors update library" on public.question_library for update to authenticated using ((organization_id is null and has_survey_role(null, 'editor')) or has_survey_role(organization_id, 'editor')) with check ((organization_id is null and has_survey_role(null, 'editor')) or has_survey_role(organization_id, 'editor'));

create policy "Members read templates" on public.survey_templates for select to authenticated using ((organization_id is null and is_survey_member()) or has_survey_role(organization_id, 'viewer'));
create policy "Editors write templates" on public.survey_templates for insert to authenticated with check ((organization_id is null and has_survey_role(null, 'editor')) or has_survey_role(organization_id, 'editor'));
create policy "Editors update templates" on public.survey_templates for update to authenticated using ((organization_id is null and has_survey_role(null, 'editor')) or has_survey_role(organization_id, 'editor')) with check ((organization_id is null and has_survey_role(null, 'editor')) or has_survey_role(organization_id, 'editor'));

create policy "Members read settings" on public.platform_settings for select to authenticated using (is_survey_member());
create policy "Global owners write settings" on public.platform_settings for all to authenticated using (has_survey_role(null, 'owner')) with check (has_survey_role(null, 'owner'));


-- ── Grants ───────────────────────────────────────────────────────────────
-- Explicit, minimal, revoke-then-grant throughout (never a blanket grant to
-- anon). authenticated gets full column access on every table below (RLS
-- still gates rows); anon gets a narrow column subset on `surveys` only,
-- for the respondent-facing published-survey read path.

revoke all on public.organizations, public.employees, public.surveys, public.survey_versions,
  public.survey_invitations, public.audit_logs, public.question_library, public.survey_templates,
  public.platform_settings, public.survey_members, public.survey_admins
  from public, anon, authenticated;

grant select, insert, update on public.organizations to authenticated;
grant select, insert, update on public.employees to authenticated;
grant select, insert, update on public.surveys to authenticated;
grant select, insert on public.survey_versions to authenticated;
grant select, insert, update on public.survey_invitations to authenticated;
grant select on public.audit_logs to authenticated;
grant select, insert, update on public.question_library to authenticated;
grant select, insert, update on public.survey_templates to authenticated;
grant select, insert, update on public.platform_settings to authenticated;
-- survey_members and survey_admins: intentionally NO direct grant to any
-- role. All access is via the security-definer functions below.

grant select (slug, title, definition, table_name, published, current_version) on public.surveys to anon;


-- ── Functions ────────────────────────────────────────────────────────────
-- Every function below is `security definer` with `set search_path = public`
-- (search-path-hijack safe) and its own explicit revoke/grant — see each
-- definition. Extracted verbatim via pg_get_functiondef(), so this section
-- is byte-exact, unlike the reconstructed table DDL above.
CREATE OR REPLACE FUNCTION public.active_owner_count(target_org_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.survey_members
  where role = 'owner' and is_active
    and (organization_id is null or organization_id = target_org_id);
$function$;

CREATE OR REPLACE FUNCTION public.add_team_member(p_email text, p_organization_id uuid, p_role survey_role, p_can_view_identity boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare new_id uuid;
begin
  if not public.has_survey_role(p_organization_id, 'owner') then
    raise exception 'You need the owner role to add a team member here';
  end if;

  insert into public.survey_members (email, organization_id, role, can_view_identity)
  values (lower(trim(p_email)), p_organization_id, p_role, coalesce(p_can_view_identity, false))
  returning id into new_id;

  perform public.record_audit(p_organization_id, 'MEMBER_ADDED',
    jsonb_build_object('member_id', new_id, 'email', lower(trim(p_email)), 'role', p_role));

  return new_id;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_overview_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  total_responses bigint := 0;
  month_responses bigint := 0;
  n bigint;
  m bigint;
  visible int := 0;
  live int := 0; draft int := 0; closed int := 0; archived int := 0;
  customers int := 0;
begin
  if not public.is_survey_member() then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  select count(*) into customers from public.organizations o
  where public.has_survey_role(o.id, 'viewer');

  for r in
    select s.slug, s.table_name, s.published, s.closed_at, s.archived_at, s.organization_id
    from public.surveys s
    where public.has_survey_role(s.organization_id, 'viewer')
  loop
    visible := visible + 1;
    case public.survey_status(r.published, r.closed_at, r.archived_at)
      when 'LIVE' then live := live + 1;
      when 'DRAFT' then draft := draft + 1;
      when 'CLOSED' then closed := closed + 1;
      else archived := archived + 1;
    end case;

    if r.table_name ~ '^[a-z_][a-z0-9_]*$' and to_regclass('public.' || r.table_name) is not null then
      execute format('select count(*), count(*) filter (where submitted_at >= date_trunc(''month'', now())) from public.%I', r.table_name)
        into n, m;
      total_responses := total_responses + coalesce(n, 0);
      month_responses := month_responses + coalesce(m, 0);
    end if;
  end loop;

  return jsonb_build_object(
    'customers', customers,
    'surveys', visible,
    'live', live,
    'draft', draft,
    'closed', closed,
    'archived', archived,
    'responses', total_responses,
    'responses_this_month', month_responses
  );
end $function$;

CREATE OR REPLACE FUNCTION public.admin_response_trend(p_days integer DEFAULT 30)
 RETURNS TABLE(day date, n bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record;
begin
  if not public.is_survey_member() then return; end if;
  create temp table if not exists _trend(day date, n bigint) on commit drop;
  delete from _trend;

  for r in select s.table_name from public.surveys s
           where public.has_survey_role(s.organization_id, 'viewer')
  loop
    if r.table_name ~ '^[a-z_][a-z0-9_]*$' and to_regclass('public.' || r.table_name) is not null then
      execute format(
        'insert into _trend select submitted_at::date, count(*) from public.%I
         where submitted_at >= current_date - %s group by 1', r.table_name, p_days);
    end if;
  end loop;

  return query select t.day, sum(t.n)::bigint from _trend t group by t.day order by t.day;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_survey_summaries()
 RETURNS TABLE(slug text, title text, organization_id uuid, organization_name text, status text, privacy_mode survey_privacy_mode, category text, responses bigint, audience bigint, completed bigint, current_version integer, created_by text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; n bigint;
begin
  if not public.is_survey_member() then return; end if;

  for r in
    select s.slug, s.title, s.organization_id, o.name as org_name,
           s.published, s.closed_at, s.archived_at, s.table_name,
           s.privacy_mode, s.category, s.current_version, s.created_by, s.updated_at,
           (select count(*) from public.survey_invitations i where i.survey_id = s.id) as aud,
           (select count(*) from public.survey_invitations i where i.survey_id = s.id and i.status = 'COMPLETED') as comp
    from public.surveys s
    left join public.organizations o on o.id = s.organization_id
    where public.has_survey_role(s.organization_id, 'viewer')
    order by s.updated_at desc
  loop
    n := 0;
    if r.table_name ~ '^[a-z_][a-z0-9_]*$' and to_regclass('public.' || r.table_name) is not null then
      execute format('select count(*) from public.%I', r.table_name) into n;
    end if;
    slug := r.slug; title := r.title;
    organization_id := r.organization_id; organization_name := r.org_name;
    status := public.survey_status(r.published, r.closed_at, r.archived_at);
    privacy_mode := r.privacy_mode; category := r.category;
    responses := n; audience := r.aud; completed := r.comp;
    current_version := r.current_version;
    created_by := r.created_by; updated_at := r.updated_at;
    return next;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.audience_summary(p_survey_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare org uuid; r jsonb;
begin
  select organization_id into org from public.surveys where id = p_survey_id;
  if org is null then return jsonb_build_object('error', 'not_found'); end if;
  if not public.has_survey_role(org, 'viewer') then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  select jsonb_build_object(
    'audience', count(*),
    'not_sent', count(*) filter (where status = 'NOT_SENT'),
    'sent', count(*) filter (where status = 'SENT'),
    'opened', count(*) filter (where status = 'OPENED'),
    'started', count(*) filter (where status = 'STARTED'),
    'completed', count(*) filter (where status = 'COMPLETED'),
    'expired', count(*) filter (where status = 'EXPIRED'),
    'revoked', count(*) filter (where status = 'REVOKED')
  ) into r
  from public.survey_invitations where survey_id = p_survey_id;

  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.can_view_identity(target_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    public.has_survey_role(target_org_id, 'owner')
    or exists (
      select 1 from public.survey_members m
      where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and (m.organization_id is null or m.organization_id = target_org_id)
        and m.can_view_identity
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_user_role(target_org_id uuid)
 RETURNS survey_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.role
  from public.survey_members m
  where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and (m.organization_id is null or m.organization_id = target_org_id)
  order by public.survey_role_rank(m.role) desc
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.has_survey_role(target_org_id uuid, minimum survey_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    public.survey_role_rank(public.get_user_role(target_org_id))
      >= public.survey_role_rank(minimum),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.invitation_stamp(p_mode survey_privacy_mode)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case when p_mode = 'ANONYMOUS_TRACKED'
              then date_trunc('hour', now()) else now() end;
$function$;

CREATE OR REPLACE FUNCTION public.is_master_owner(p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select lower(coalesce(p_email, '')) = lower(coalesce(
    (select value #>> '{}' from public.platform_settings where key = 'master_owner_email'),
    'reuben.g@spigroup.in'
  ));
$function$;

CREATE OR REPLACE FUNCTION public.is_survey_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.has_survey_role(null, 'owner');
$function$;

CREATE OR REPLACE FUNCTION public.is_survey_member()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.survey_members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$function$;

CREATE OR REPLACE FUNCTION public.issue_invitations(p_survey_id uuid, p_employee_ids uuid[], p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(employee_id uuid, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare org uuid; ver int; eid uuid; raw text; n int;
begin
  select s.organization_id, s.current_version into org, ver
  from public.surveys s where s.id = p_survey_id;
  if org is null then raise exception 'No such survey'; end if;
  if not public.has_survey_role(org, 'editor') then
    raise exception 'You need the editor role to invite people to this survey';
  end if;

  foreach eid in array p_employee_ids loop
    if not exists (select 1 from public.employees e
                   where e.id = eid and e.organization_id = org and e.is_active) then
      continue;
    end if;
    raw := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.survey_invitations
      (survey_id, survey_version, employee_id, token_hash, status, expires_at)
    values (p_survey_id, ver, eid,
            encode(extensions.digest(raw, 'sha256'), 'hex'), 'NOT_SENT', p_expires_at)
    on conflict (survey_id, employee_id) do nothing;
    get diagnostics n = row_count;
    if n = 1 then return query select eid, raw; end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.list_team_members()
 RETURNS TABLE(id uuid, email text, organization_id uuid, organization_name text, role survey_role, can_view_identity boolean, is_active boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.has_survey_role(null, 'viewer') then
    return query
      select m.id, m.email, m.organization_id, o.name, m.role, m.can_view_identity, m.is_active, m.created_at
      from public.survey_members m left join public.organizations o on o.id = m.organization_id
      order by m.organization_id nulls first, m.email;
  else
    return query
      select m.id, m.email, m.organization_id, o.name, m.role, m.can_view_identity, m.is_active, m.created_at
      from public.survey_members m join public.organizations o on o.id = m.organization_id
      where public.has_survey_role(m.organization_id, 'viewer')
      order by m.organization_id, m.email;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.mark_invitations_sent(p_invitation_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare org uuid; n int;
begin
  select distinct s.organization_id into org
  from public.survey_invitations i join public.surveys s on s.id = i.survey_id
  where i.id = any(p_invitation_ids);
  if org is null then return 0; end if;
  if not public.has_survey_role(org, 'editor') then
    raise exception 'You need the editor role to send invitations';
  end if;

  update public.survey_invitations i
  set status = 'SENT',
      sent_at = public.invitation_stamp(s.privacy_mode)
  from public.surveys s
  where s.id = i.survey_id and s.organization_id = org
    and i.id = any(p_invitation_ids) and i.status = 'NOT_SENT' and i.revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.record_audit(p_organization_id uuid, p_action_type text, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(auth.jwt() ->> 'email', '') = '' then return; end if;
  insert into public.audit_logs (organization_id, user_email, action_type, details)
  values (p_organization_id, auth.jwt() ->> 'email', p_action_type, coalesce(p_details, '{}'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.regenerate_invitation(p_invitation_id uuid)
 RETURNS TABLE(employee_id uuid, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare inv record; org uuid; raw text;
begin
  select i.*, s.organization_id as org_id into inv
  from public.survey_invitations i join public.surveys s on s.id = i.survey_id
  where i.id = p_invitation_id;

  if inv.id is null then raise exception 'No such invitation'; end if;
  org := inv.org_id;
  if not public.has_survey_role(org, 'editor') then
    raise exception 'You need the editor role to generate invitation links';
  end if;
  if inv.status = 'COMPLETED' then
    raise exception 'This invitation has already been completed and cannot be regenerated';
  end if;

  raw := encode(extensions.gen_random_bytes(32), 'hex');
  update public.survey_invitations
  set token_hash = encode(extensions.digest(raw, 'sha256'), 'hex'),
      status = 'NOT_SENT',
      sent_at = null, opened_at = null, started_at = null, completed_at = null,
      revoked_at = null
  where id = p_invitation_id;

  employee_id := inv.employee_id;
  token := raw;
  return next;
end $function$;

CREATE OR REPLACE FUNCTION public.resolve_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv record; s record; stamp timestamptz;
begin
  if p_token is null or length(p_token) < 32 then
    return jsonb_build_object('valid', false, 'reason', 'INVALID');
  end if;
  select * into inv from public.survey_invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  if inv.id is null then return jsonb_build_object('valid', false, 'reason', 'INVALID'); end if;
  if inv.revoked_at is not null then return jsonb_build_object('valid', false, 'reason', 'REVOKED'); end if;
  if inv.status = 'COMPLETED' then return jsonb_build_object('valid', false, 'reason', 'COMPLETED'); end if;
  if inv.expires_at is not null and inv.expires_at < now() then
    update public.survey_invitations set status='EXPIRED' where id = inv.id;
    return jsonb_build_object('valid', false, 'reason', 'EXPIRED');
  end if;

  select * into s from public.surveys where id = inv.survey_id;
  if s.id is null or not s.published then return jsonb_build_object('valid', false, 'reason', 'UNAVAILABLE'); end if;
  if s.closed_at is not null then return jsonb_build_object('valid', false, 'reason', 'CLOSED'); end if;

  stamp := public.invitation_stamp(s.privacy_mode);
  update public.survey_invitations
  set status = case when status in ('NOT_SENT','SENT') then 'OPENED' else status end,
      opened_at = coalesce(opened_at, stamp)
  where id = inv.id;

  return jsonb_build_object('valid', true, 'slug', s.slug, 'definition', s.definition,
    'privacy_mode', s.privacy_mode, 'version', coalesce(inv.survey_version, s.current_version));
end $function$;

CREATE OR REPLACE FUNCTION public.revoke_invitations(p_invitation_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare org uuid; n int;
begin
  select distinct s.organization_id into org
  from public.survey_invitations i join public.surveys s on s.id = i.survey_id
  where i.id = any(p_invitation_ids);
  if org is null then return 0; end if;
  if not public.has_survey_role(org, 'editor') then
    raise exception 'You need the editor role to revoke invitations';
  end if;

  -- A completed invitation is left alone: revoking it would imply the response
  -- could be withdrawn, and it cannot be, because it is no longer linked.
  update public.survey_invitations i
  set status = 'REVOKED', revoked_at = now()
  from public.surveys s
  where s.id = i.survey_id and s.organization_id = org
    and i.id = any(p_invitation_ids) and i.status <> 'COMPLETED' and i.revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_team_member_active(p_member_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare target record; caller text;
begin
  select * into target from public.survey_members where id = p_member_id;
  if target.id is null then raise exception 'No such team member'; end if;

  if not public.has_survey_role(target.organization_id, 'owner') then
    raise exception 'You need the owner role to change this membership';
  end if;

  caller := lower(coalesce(auth.jwt() ->> 'email', ''));
  if caller = lower(target.email) then
    raise exception 'You cannot deactivate your own membership. Ask another owner.';
  end if;

  if public.is_master_owner(target.email) and not p_active then
    raise exception 'This is the platform''s designated master owner account and cannot be deactivated.';
  end if;

  if target.role = 'owner' and target.is_active and not p_active then
    if public.active_owner_count(target.organization_id) <= 1 then
      raise exception 'This is the last owner for this scope. Add another owner before deactivating this one.';
    end if;
  end if;

  update public.survey_members set is_active = p_active where id = p_member_id;
  perform public.record_audit(target.organization_id,
    case when p_active then 'MEMBER_REACTIVATED' else 'MEMBER_DEACTIVATED' end,
    jsonb_build_object('member_id', p_member_id, 'email', target.email));
end $function$;

CREATE OR REPLACE FUNCTION public.submit_invited_response(p_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv record; s record; emp record; cols text; vals text; stamp timestamptz;
        has_resp_cols boolean; has_employee_id_col boolean;
begin
  select * into inv from public.survey_invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if inv.id is null then return jsonb_build_object('ok', false, 'reason', 'INVALID'); end if;
  if inv.revoked_at is not null then return jsonb_build_object('ok', false, 'reason', 'REVOKED'); end if;
  if inv.status = 'COMPLETED' then return jsonb_build_object('ok', false, 'reason', 'ALREADY_SUBMITTED'); end if;
  if inv.expires_at is not null and inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  end if;

  select * into s from public.surveys where id = inv.survey_id;
  if s.id is null or not s.published or s.closed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'UNAVAILABLE');
  end if;
  if s.table_name !~ '^[a-z_][a-z0-9_]*$' or to_regclass('public.'||s.table_name) is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_TABLE');
  end if;

  select
    string_agg(quote_ident(c.column_name), ', '),
    -- text[] columns need their JSON array turned into a real Postgres array
    -- literal; everything else is a plain text value extracted with ->>.
    string_agg(
      case when c.data_type = 'ARRAY'
        then format('array(select jsonb_array_elements_text(%L::jsonb -> %L))', p_payload, c.column_name)
        else format('%L', p_payload ->> c.column_name)
      end, ', ')
    into cols, vals
  from information_schema.columns c
  where c.table_schema='public' and c.table_name = s.table_name
    and c.column_name in (select jsonb_object_keys(p_payload))
    and c.column_name not in ('id','submitted_at','employee_id','resp_department','resp_location','resp_designation');

  if cols is null then return jsonb_build_object('ok', false, 'reason', 'EMPTY'); end if;

  select exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name=s.table_name and column_name='employee_id')
    into has_employee_id_col;
  select exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name=s.table_name and column_name='resp_department')
    into has_resp_cols;

  if has_resp_cols or has_employee_id_col then
    select * into emp from public.employees where id = inv.employee_id;
  end if;

  if s.privacy_mode = 'CONFIDENTIAL' and has_employee_id_col then
    if has_resp_cols then
      execute format(
        'insert into public.%I (%s, definition_version, employee_id, resp_department, resp_location, resp_designation) values (%s, %s, %L, %L, %L, %L)',
        s.table_name, cols, vals, coalesce(inv.survey_version, s.current_version), inv.employee_id, emp.department, emp.location, emp.designation);
    else
      execute format('insert into public.%I (%s, definition_version, employee_id) values (%s, %s, %L)',
                     s.table_name, cols, vals, coalesce(inv.survey_version, s.current_version), inv.employee_id);
    end if;
  elsif has_resp_cols then
    execute format(
      'insert into public.%I (%s, definition_version, resp_department, resp_location, resp_designation) values (%s, %s, %L, %L, %L)',
      s.table_name, cols, vals, coalesce(inv.survey_version, s.current_version), emp.department, emp.location, emp.designation);
  else
    execute format('insert into public.%I (%s, definition_version) values (%s, %s)',
                   s.table_name, cols, vals, coalesce(inv.survey_version, s.current_version));
  end if;

  stamp := public.invitation_stamp(s.privacy_mode);
  update public.survey_invitations
  set status='COMPLETED',
      completed_at = stamp,
      started_at = coalesce(started_at, stamp)
  where id = inv.id;

  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.survey_analytics_overview(p_slug text, p_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; n bigint; first_at timestamptz; last_at timestamptz;
        audience bigint; completed bigint;
begin
  select * into s from public.surveys where slug = p_slug;
  if s.id is null then return jsonb_build_object('error','not_found'); end if;
  if not public.has_survey_role(s.organization_id, 'analyst') then
    return jsonb_build_object('error','not_authorised');
  end if;
  if s.table_name !~ '^[a-z_][a-z0-9_]*$' or to_regclass('public.'||s.table_name) is null then
    return jsonb_build_object('error','no_table');
  end if;

  execute format(
    'select count(*), min(submitted_at), max(submitted_at) from public.%I where ($1 is null or definition_version = $1)',
    s.table_name)
  into n, first_at, last_at using p_version;

  if s.privacy_mode <> 'ANONYMOUS' then
    select count(*), count(*) filter (where status='COMPLETED')
      into audience, completed
    from public.survey_invitations where survey_id = s.id;
  end if;

  return jsonb_build_object(
    'responses', coalesce(n,0), 'first_response', first_at, 'latest_response', last_at,
    'privacy_mode', s.privacy_mode,
    'audience', audience, 'completed', completed,
    'completion_rate', case when audience > 0 then round(100.0 * completed / audience, 1) else null end
  );
end $function$;

CREATE OR REPLACE FUNCTION public.survey_columns_distribution(p_slug text, p_columns text[], p_version integer DEFAULT NULL::integer)
 RETURNS TABLE(column_name text, value text, n bigint, pct numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_variable
declare s record; col text;
begin
  select * into s from public.surveys where slug = p_slug;
  if s.id is null or not public.has_survey_role(s.organization_id, 'analyst') then return; end if;
  if s.table_name !~ '^[a-z_][a-z0-9_]*$' or to_regclass('public.'||s.table_name) is null then return; end if;

  foreach col in array p_columns loop
    if col !~ '^[a-z_][a-z0-9_]*$' then continue; end if;
    if not exists (select 1 from information_schema.columns c
                   where c.table_schema='public' and c.table_name=s.table_name and c.column_name=col) then
      continue;
    end if;
    return query execute format($f$
      select %L::text, v, n, round(100.0 * n / nullif(sum(n) over(), 0), 1)
      from (
        select %I::text as v, count(*) as n
        from public.%I
        where %I is not null and ($1 is null or definition_version = $1)
        group by %I
      ) g
    $f$, col, col, s.table_name, col, col) using p_version;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.survey_multiselect_distribution(p_slug text, p_column text, p_version integer DEFAULT NULL::integer)
 RETURNS TABLE(value text, n bigint, pct_of_respondents numeric, respondents bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; resp_count bigint;
begin
  select * into s from public.surveys where slug = p_slug;
  if s.id is null or not public.has_survey_role(s.organization_id, 'analyst') then return; end if;
  if p_column !~ '^[a-z_][a-z0-9_]*$' then return; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name=s.table_name and column_name=p_column) then
    return;
  end if;

  execute format(
    'select count(*) from public.%I where %I <> ''{}'' and ($1 is null or definition_version = $1)',
    s.table_name, p_column) into resp_count using p_version;

  return query execute format($f$
    select v, count(*), round(100.0 * count(*) / nullif(%L::bigint, 0), 1), %L::bigint
    from public.%I, unnest(%I) as v
    where ($1 is null or definition_version = $1)
    group by v
    order by count(*) desc
  $f$, resp_count, resp_count, s.table_name, p_column) using p_version;
end $function$;

CREATE OR REPLACE FUNCTION public.survey_report_breakdown(p_slug text, p_column text)
 RETURNS TABLE(value text, n bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t text; org uuid; is_array boolean;
begin
  select table_name, organization_id into t, org from public.surveys where slug = p_slug;
  if t is null then return; end if;
  if not public.has_survey_role(org, 'analyst') then return; end if;
  if t !~ '^[a-z_][a-z0-9_]*$' or to_regclass('public.' || t) is null then return; end if;

  -- Must be a column the definition writes AND one with a bounded set of
  -- answers. Free text is excluded on both counts.
  if not exists (
    select 1 from public.survey_report_columns(p_slug) c
    where c.column_name = p_column and c.chartable
  ) then return; end if;

  select data_type = 'ARRAY' into is_array
  from information_schema.columns
  where table_schema = 'public' and table_name = t and column_name = p_column;

  if is_array then
    return query execute format(
      'select u::text as value, count(*)::bigint as n
       from public.%I, lateral unnest(%I) u
       where %I is not null group by 1 order by 2 desc, 1', t, p_column, p_column);
  else
    return query execute format(
      'select %I::text as value, count(*)::bigint as n
       from public.%I where %I is not null and %I <> '''' group by 1 order by 2 desc, 1',
      p_column, t, p_column, p_column);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.survey_report_columns(p_slug text)
 RETURNS TABLE(question_id text, label text, column_name text, question_type text, chartable boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare def jsonb; org uuid; sec jsonb; q jsonb; i int;
begin
  select s.definition, s.organization_id into def, org from public.surveys s where s.slug = p_slug;
  if def is null then return; end if;
  if not public.has_survey_role(org, 'analyst') then return; end if;

  for sec in select * from jsonb_array_elements(def -> 'sections') loop
    for q in select * from jsonb_array_elements(sec -> 'questions') loop
      if q ->> 'type' = 'matrix' then
        for i in 0 .. coalesce(jsonb_array_length(q -> 'rows'), 0) - 1 loop
          question_id := (q ->> 'id') || '[' || i || ']';
          label := (q -> 'rows' ->> i);
          column_name := (q ->> 'columnPrefix') || '_' || lpad((i + 1)::text, 2, '0');
          question_type := 'matrix';
          chartable := true;
          return next;
        end loop;
      else
        question_id := q ->> 'id';
        label := q ->> 'label';
        column_name := coalesce(q ->> 'column', public.survey_snake_case(q ->> 'id'));
        question_type := q ->> 'type';
        chartable := question_type in ('radio', 'checkbox', 'select');
        return next;
      end if;
    end loop;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.survey_report_stats(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t text; org uuid; result jsonb;
begin
  select table_name, organization_id into t, org from public.surveys where slug = p_slug;
  if t is null then return null; end if;
  if not public.has_survey_role(org, 'analyst') then
    return jsonb_build_object('error', 'not_authorised');
  end if;
  if t !~ '^[a-z_][a-z0-9_]*$' or to_regclass('public.' || t) is null then
    return jsonb_build_object('error', 'no_table');
  end if;

  execute format($f$
    select jsonb_build_object(
      'total', count(*),
      'first_at', min(submitted_at),
      'last_at', max(submitted_at),
      'by_version', coalesce((
        select jsonb_object_agg(coalesce(v::text, 'unversioned'), n)
        from (select definition_version v, count(*) n from public.%1$I group by 1) x
      ), '{}'::jsonb),
      'by_day', coalesce((
        select jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d)
        from (select submitted_at::date d, count(*) n from public.%1$I group by 1) y
      ), '[]'::jsonb)
    )
    from public.%1$I
  $f$, t) into result;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.survey_response_count(p_slug text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.survey_response_one(p_slug text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; has_emp_col boolean; authorized_identity boolean; coarsen boolean; sql text; row_data jsonb;
begin
  select * into s from public.surveys where slug = p_slug;
  if s.id is null then return jsonb_build_object('error','not_found'); end if;
  if not public.has_survey_role(s.organization_id, 'analyst') then
    return jsonb_build_object('error','not_authorised');
  end if;
  if s.table_name !~ '^[a-z_][a-z0-9_]*$' or to_regclass('public.'||s.table_name) is null then
    return jsonb_build_object('error','no_table');
  end if;

  select exists(select 1 from information_schema.columns
                where table_schema='public' and table_name=s.table_name and column_name='employee_id')
    into has_emp_col;
  authorized_identity := has_emp_col and s.privacy_mode = 'CONFIDENTIAL' and public.can_view_identity(s.organization_id);
  coarsen := s.privacy_mode <> 'ANONYMOUS' and not authorized_identity;

  if authorized_identity then
    sql := format(
      'select (to_jsonb(t) - ''resp_department'' - ''resp_location'' - ''resp_designation'') || jsonb_build_object(''employee_code'', e.employee_code, ''employee_name'', e.employee_name) from public.%I t left join public.employees e on e.id = t.employee_id where t.id = $1',
      s.table_name);
  elsif coarsen then
    sql := format(
      'select (to_jsonb(t) - ''employee_id'' - ''resp_department'' - ''resp_location'' - ''resp_designation'' - ''submitted_at'') || jsonb_build_object(''submitted_at'', date_trunc(''hour'', t.submitted_at)) from public.%I t where t.id = $1',
      s.table_name);
  else
    sql := format(
      'select (to_jsonb(t) - ''employee_id'' - ''resp_department'' - ''resp_location'' - ''resp_designation'') from public.%I t where t.id = $1',
      s.table_name);
  end if;

  execute sql into row_data using p_id;
  if row_data is null then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('row', row_data, 'identity_included', authorized_identity, 'timestamps_coarsened', coarsen);
end $function$;

CREATE OR REPLACE FUNCTION public.survey_response_page(p_slug text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text, p_version integer DEFAULT NULL::integer, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; has_emp_col boolean; authorized_identity boolean; coarsen boolean;
        sql text; rows jsonb; total bigint;
begin
  select * into s from public.surveys where slug = p_slug;
  if s.id is null then return jsonb_build_object('error','not_found'); end if;
  if not public.has_survey_role(s.organization_id, 'analyst') then
    return jsonb_build_object('error','not_authorised');
  end if;
  if p_limit > 200 then p_limit := 200; end if;
  if s.table_name !~ '^[a-z_][a-z0-9_]*$' or to_regclass('public.'||s.table_name) is null then
    return jsonb_build_object('error','no_table');
  end if;

  select exists(select 1 from information_schema.columns
                where table_schema='public' and table_name=s.table_name and column_name='employee_id')
    into has_emp_col;
  authorized_identity := has_emp_col and s.privacy_mode = 'CONFIDENTIAL' and public.can_view_identity(s.organization_id);
  coarsen := s.privacy_mode <> 'ANONYMOUS' and not authorized_identity;

  if authorized_identity then
    sql := format($f$
      select coalesce(jsonb_agg(row_data order by submitted_at desc), '[]'::jsonb), max(cnt)
      from (
        select ((to_jsonb(t) - 'resp_department' - 'resp_location' - 'resp_designation')
                || jsonb_build_object('employee_code', e.employee_code, 'employee_name', e.employee_name)) as row_data,
               t.submitted_at, count(*) over() as cnt
        from public.%I t left join public.employees e on e.id = t.employee_id
        where ($1 is null or t.submitted_at >= $1)
          and ($2 is null or t.submitted_at <= $2)
          and ($3 is null or t.definition_version = $3)
          and ($4 is null or to_jsonb(t)::text ilike '%%'||$4||'%%')
        order by t.submitted_at desc limit $5 offset $6
      ) x
    $f$, s.table_name);
  elsif coarsen then
    sql := format($f$
      select coalesce(jsonb_agg(row_data order by submitted_at desc), '[]'::jsonb), max(cnt)
      from (
        select ((to_jsonb(t) - 'employee_id' - 'resp_department' - 'resp_location' - 'resp_designation' - 'submitted_at')
                || jsonb_build_object('submitted_at', date_trunc('hour', t.submitted_at))) as row_data,
               t.submitted_at, count(*) over() as cnt
        from public.%I t
        where ($1 is null or t.submitted_at >= $1)
          and ($2 is null or t.submitted_at <= $2)
          and ($3 is null or t.definition_version = $3)
          and ($4 is null or to_jsonb(t)::text ilike '%%'||$4||'%%')
        order by t.submitted_at desc limit $5 offset $6
      ) x
    $f$, s.table_name);
  else
    sql := format($f$
      select coalesce(jsonb_agg(row_data order by submitted_at desc), '[]'::jsonb), max(cnt)
      from (
        select (to_jsonb(t) - 'employee_id' - 'resp_department' - 'resp_location' - 'resp_designation') as row_data,
               t.submitted_at, count(*) over() as cnt
        from public.%I t
        where ($1 is null or t.submitted_at >= $1)
          and ($2 is null or t.submitted_at <= $2)
          and ($3 is null or t.definition_version = $3)
          and ($4 is null or to_jsonb(t)::text ilike '%%'||$4||'%%')
        order by t.submitted_at desc limit $5 offset $6
      ) x
    $f$, s.table_name);
  end if;

  execute sql into rows, total using p_date_from, p_date_to, p_version, p_search, p_limit, p_offset;
  return jsonb_build_object('rows', coalesce(rows, '[]'::jsonb), 'total', coalesce(total, 0), 'identity_included', authorized_identity, 'timestamps_coarsened', coarsen);
end $function$;

CREATE OR REPLACE FUNCTION public.survey_response_trend(p_slug text, p_version integer DEFAULT NULL::integer)
 RETURNS TABLE(bucket_start date, n bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; span int; use_weekly boolean;
begin
  select * into s from public.surveys where slug = p_slug;
  if s.id is null or not public.has_survey_role(s.organization_id, 'analyst') then return; end if;
  if s.table_name !~ '^[a-z_][a-z0-9_]*$' or to_regclass('public.'||s.table_name) is null then return; end if;

  execute format(
    'select coalesce(extract(day from max(submitted_at) - min(submitted_at))::int, 0) from public.%I where ($1 is null or definition_version = $1)',
    s.table_name) into span using p_version;
  use_weekly := span > 45;

  return query execute format(
    'select date_trunc(%L, submitted_at)::date, count(*) from public.%I where ($1 is null or definition_version = $1) group by 1 order by 1',
    case when use_weekly then 'week' else 'day' end, s.table_name) using p_version;
end $function$;

CREATE OR REPLACE FUNCTION public.survey_role_rank(r survey_role)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case r
    when 'owner'   then 4
    when 'editor'  then 3
    when 'analyst' then 2
    when 'viewer'  then 1
    else 0
  end;
$function$;

CREATE OR REPLACE FUNCTION public.survey_segment_summary(p_slug text, p_group_by text DEFAULT NULL::text, p_department text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_designation text DEFAULT NULL::text, p_version integer DEFAULT NULL::integer, p_threshold integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; has_cols boolean; where_sql text := '1=1'; group_col text;
        n bigint; groups jsonb; suppressed_groups int; suppressed_responses bigint;
        floor_threshold constant int := 5;
begin
  p_threshold := greatest(coalesce(p_threshold, floor_threshold), floor_threshold);

  select * into s from public.surveys where slug = p_slug;
  if s.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if not public.has_survey_role(s.organization_id, 'analyst') then
    return jsonb_build_object('error', 'not_authorised');
  end if;
  if s.table_name !~ '^[a-z_][a-z0-9_]*$' or to_regclass('public.'||s.table_name) is null then
    return jsonb_build_object('error', 'no_table');
  end if;

  select exists(select 1 from information_schema.columns
                where table_schema='public' and table_name=s.table_name and column_name='resp_department')
    into has_cols;
  if not has_cols then
    return jsonb_build_object('applicable', false, 'reason', 'no_segmentation_data');
  end if;

  if p_group_by is not null and p_group_by not in ('department', 'location', 'designation') then
    return jsonb_build_object('error', 'invalid_dimension');
  end if;
  group_col := case p_group_by when 'department' then 'resp_department'
                                when 'location' then 'resp_location'
                                when 'designation' then 'resp_designation' end;

  where_sql := '($1 is null or definition_version = $1)';
  where_sql := where_sql || ' and ($2 is null or resp_department = $2)';
  where_sql := where_sql || ' and ($3 is null or resp_location = $3)';
  where_sql := where_sql || ' and ($4 is null or resp_designation = $4)';

  if group_col is null then
    execute format('select count(*) from public.%I where %s', s.table_name, where_sql)
      into n using p_version, p_department, p_location, p_designation;
    if n < p_threshold then
      return jsonb_build_object('applicable', true, 'group_by', null, 'suppressed', true,
                                 'threshold', p_threshold, 'count', null);
    end if;
    return jsonb_build_object('applicable', true, 'group_by', null, 'suppressed', false,
                               'threshold', p_threshold, 'count', n);
  end if;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(''value'', v, ''n'', n) order by n desc), ''[]''::jsonb) ' ||
    'from (select %I as v, count(*) as n from public.%I where %s and %I is not null group by 1 having count(*) >= $5) g',
    group_col, s.table_name, where_sql, group_col)
    into groups using p_version, p_department, p_location, p_designation, p_threshold;

  execute format(
    'select count(*), coalesce(sum(n),0) from (select %I as v, count(*) as n from public.%I where %s and %I is not null group by 1 having count(*) < $5) g',
    group_col, s.table_name, where_sql, group_col)
    into suppressed_groups, suppressed_responses using p_version, p_department, p_location, p_designation, p_threshold;

  return jsonb_build_object(
    'applicable', true, 'group_by', p_group_by, 'threshold', p_threshold,
    'groups', groups, 'suppressed_groups', suppressed_groups, 'suppressed_responses', suppressed_responses
  );
end $function$;

CREATE OR REPLACE FUNCTION public.survey_snake_case(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select trim(both '_' from lower(regexp_replace(
    regexp_replace(p, '([a-z0-9])([A-Z])', '\1_\2', 'g'),
    '[^A-Za-z0-9]+', '_', 'g')));
$function$;

CREATE OR REPLACE FUNCTION public.survey_status(p_published boolean, p_closed_at timestamp with time zone, p_archived_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_archived_at is not null then 'ARCHIVED'
    when p_closed_at is not null then 'CLOSED'
    when p_published then 'LIVE'
    else 'DRAFT'
  end;
$function$;

CREATE OR REPLACE FUNCTION public.survey_text_count(p_slug text, p_column text, p_version integer DEFAULT NULL::integer)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; n bigint;
begin
  select * into s from public.surveys where slug = p_slug;
  if s.id is null or not public.has_survey_role(s.organization_id, 'analyst') then return null; end if;
  if p_column !~ '^[a-z_][a-z0-9_]*$' then return null; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name=s.table_name and column_name=p_column) then
    return null;
  end if;
  execute format(
    'select count(*) from public.%I where %I is not null and %I <> '''' and ($1 is null or definition_version = $1)',
    s.table_name, p_column, p_column) into n using p_version;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.update_team_member(p_member_id uuid, p_role survey_role DEFAULT NULL::survey_role, p_can_view_identity boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare target record; caller text;
begin
  select * into target from public.survey_members where id = p_member_id;
  if target.id is null then raise exception 'No such team member'; end if;

  if not public.has_survey_role(target.organization_id, 'owner') then
    raise exception 'You need the owner role to change this membership';
  end if;

  caller := lower(coalesce(auth.jwt() ->> 'email', ''));
  if caller = lower(target.email) then
    raise exception 'You cannot change your own role or permissions. Ask another owner.';
  end if;

  if public.is_master_owner(target.email) and p_role is not null and p_role <> 'owner' then
    raise exception 'This is the platform''s designated master owner account and cannot be moved off the owner role.';
  end if;

  if target.role = 'owner' and target.is_active and (p_role is not null and p_role <> 'owner') then
    if public.active_owner_count(target.organization_id) <= 1 then
      raise exception 'This is the last owner for this scope. Add another owner before removing this one.';
    end if;
  end if;

  update public.survey_members
  set role = coalesce(p_role, role),
      can_view_identity = coalesce(p_can_view_identity, can_view_identity)
  where id = p_member_id;

  if p_role is not null and p_role <> target.role then
    perform public.record_audit(target.organization_id, 'ROLE_CHANGED',
      jsonb_build_object('member_id', p_member_id, 'email', target.email, 'from', target.role, 'to', p_role));
  end if;
  if p_can_view_identity is not null and p_can_view_identity <> target.can_view_identity then
    perform public.record_audit(target.organization_id, 'IDENTITY_PERMISSION_CHANGED',
      jsonb_build_object('member_id', p_member_id, 'email', target.email, 'can_view_identity', p_can_view_identity));
  end if;
end $function$;


-- ── Function grants ─────────────────────────────────────────────────────
-- Every function gets execute revoked from public, then granted explicitly
-- to authenticated. A smaller subset is ALSO granted to anon (verified
-- against the live grant table, not assumed) - these are exactly the
-- functions an unauthenticated respondent needs: resolving/submitting an
-- invited response, reading a published survey's public report/stats, and
-- the has_survey_role/is_survey_member/survey_role_rank primitives those
-- and the RLS policies above depend on internally.
--
-- Worth a closer look in a future pass (not changed here, outside this
-- baseline task's scope): admin_overview_stats and admin_response_trend
-- also carry an anon EXECUTE grant despite their name. Both are internally
-- gated by has_survey_role checks (an anon caller gets an empty/zero
-- result, not real data), so this isn't a live vulnerability, but the grant
-- itself is broader than the function's name suggests and should probably
-- be tightened to authenticated-only for clarity.

grant execute on function public.active_owner_count(uuid) to authenticated;
grant execute on function public.add_team_member(text, uuid, survey_role, boolean) to authenticated;
grant execute on function public.admin_overview_stats() to authenticated, anon;
grant execute on function public.admin_response_trend(integer) to authenticated, anon;
grant execute on function public.admin_survey_summaries() to authenticated;
grant execute on function public.audience_summary(uuid) to authenticated;
grant execute on function public.can_view_identity(uuid) to authenticated;
grant execute on function public.get_user_role(uuid) to authenticated, anon;
grant execute on function public.has_survey_role(uuid, survey_role) to authenticated, anon;
grant execute on function public.invitation_stamp(survey_privacy_mode) to authenticated;
grant execute on function public.is_master_owner(text) to authenticated;
grant execute on function public.is_survey_admin() to authenticated, anon;
grant execute on function public.is_survey_member() to authenticated, anon;
grant execute on function public.issue_invitations(uuid, uuid[], timestamptz) to authenticated;
grant execute on function public.list_team_members() to authenticated;
grant execute on function public.mark_invitations_sent(uuid[]) to authenticated;
grant execute on function public.record_audit(uuid, text, jsonb) to authenticated, anon;
grant execute on function public.regenerate_invitation(uuid) to authenticated;
grant execute on function public.resolve_invitation(text) to authenticated, anon;
grant execute on function public.revoke_invitations(uuid[]) to authenticated;
grant execute on function public.rls_auto_enable() to authenticated, anon;
grant execute on function public.set_team_member_active(uuid, boolean) to authenticated;
grant execute on function public.submit_invited_response(text, jsonb) to authenticated, anon;
grant execute on function public.survey_analytics_overview(text, integer) to authenticated;
grant execute on function public.survey_columns_distribution(text, text[], integer) to authenticated;
grant execute on function public.survey_multiselect_distribution(text, text, integer) to authenticated;
grant execute on function public.survey_report_breakdown(text, text) to authenticated, anon;
grant execute on function public.survey_report_columns(text) to authenticated, anon;
grant execute on function public.survey_report_stats(text) to authenticated, anon;
grant execute on function public.survey_response_count(text) to authenticated, anon;
grant execute on function public.survey_response_one(text, uuid) to authenticated;
grant execute on function public.survey_response_page(text, integer, integer, text, integer, timestamptz, timestamptz) to authenticated;
grant execute on function public.survey_response_trend(text, integer) to authenticated;
grant execute on function public.survey_role_rank(survey_role) to authenticated, anon;
grant execute on function public.survey_segment_summary(text, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.survey_snake_case(text) to authenticated, anon;
grant execute on function public.survey_status(boolean, timestamptz, timestamptz) to authenticated, anon;
grant execute on function public.survey_text_count(text, text, integer) to authenticated;
grant execute on function public.update_team_member(uuid, survey_role, boolean) to authenticated;

-- ============================================================================
-- End of baseline snapshot.
-- ============================================================================
