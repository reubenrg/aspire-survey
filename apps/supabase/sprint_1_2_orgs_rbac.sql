-- ═══════════════════════════════════════════════════════════════════════════
-- Sprint 1 + 2: organizations and role-based access control
--
-- These ship together because Sprint 1's policies on `surveys` need to ask
-- "what is this person's role in this organization", which Sprint 2 is what
-- defines. Writing them separately means writing the policies twice.
--
-- Run in project  zpefurbbejsarkcgmscg.
-- Select ALL (Ctrl+A) first: the editor runs only highlighted text when there
-- is a selection.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Organizations ───────────────────────────────────────────────────────

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;

-- ── 2. Surveys belong to an organization ───────────────────────────────────
-- Nullable on purpose. Existing surveys predate organizations, and a null
-- organization_id means "unfiled" rather than breaking them.

alter table public.surveys
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

create index if not exists surveys_org_idx on public.surveys (organization_id);

-- ── 3. Membership ──────────────────────────────────────────────────────────
-- organization_id null means the membership applies everywhere: that is how a
-- platform owner differs from someone who owns one client's folder.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'survey_role') then
    create type public.survey_role as enum ('viewer', 'analyst', 'editor', 'owner');
  end if;
end $$;

create table if not exists public.survey_members (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  organization_id uuid references public.organizations(id) on delete cascade,
  role public.survey_role not null default 'viewer',
  created_at timestamptz not null default now()
);

-- One row per person per scope. A partial index is needed because NULL is not
-- equal to NULL, so a plain unique constraint would allow duplicate global rows.
create unique index if not exists survey_members_scoped_idx
  on public.survey_members (lower(email), organization_id)
  where organization_id is not null;
create unique index if not exists survey_members_global_idx
  on public.survey_members (lower(email))
  where organization_id is null;

alter table public.survey_members enable row level security;

-- Deliberately no policy for anon or authenticated on either membership or
-- organizations-as-a-write-target: the roster is readable only through the
-- definer functions below, so nobody can enumerate who has access.

-- ── 4. Role resolution ─────────────────────────────────────────────────────

-- Rank so "highest role wins" is a comparison rather than a chain of ifs.
create or replace function public.survey_role_rank(r public.survey_role)
returns int language sql immutable as $$
  select case r
    when 'owner'   then 4
    when 'editor'  then 3
    when 'analyst' then 2
    when 'viewer'  then 1
    else 0
  end;
$$;

-- The current user's highest role for an organization, considering both their
-- membership of that organization and any global membership. Returns null when
-- they have neither.
--
-- security definer because survey_members has no read policy: this function is
-- the only way to learn a role, which keeps the roster private while still
-- letting policies depend on it.
create or replace function public.get_user_role(target_org_id uuid)
returns public.survey_role
language sql
security definer
set search_path = public
stable
as $$
  select m.role
  from public.survey_members m
  where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and (m.organization_id is null or m.organization_id = target_org_id)
  order by public.survey_role_rank(m.role) desc
  limit 1;
$$;

-- Convenience predicate: does the current user hold at least this role here?
create or replace function public.has_survey_role(target_org_id uuid, minimum public.survey_role)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    public.survey_role_rank(public.get_user_role(target_org_id))
      >= public.survey_role_rank(minimum),
    false
  );
$$;

-- Any membership at all, anywhere. Used to decide who may see the admin area.
create or replace function public.is_survey_member()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.survey_members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Kept so the previous policy name still resolves during the migration.
-- Now means "platform owner", not "on the allowlist".
create or replace function public.is_survey_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.has_survey_role(null, 'owner');
$$;

revoke all on function public.get_user_role(uuid) from public;
revoke all on function public.has_survey_role(uuid, public.survey_role) from public;
revoke all on function public.is_survey_member() from public;
revoke all on function public.is_survey_admin() from public;
grant execute on function public.get_user_role(uuid) to authenticated;
grant execute on function public.has_survey_role(uuid, public.survey_role) to authenticated;
grant execute on function public.is_survey_member() to authenticated;
grant execute on function public.is_survey_admin() to authenticated;

-- ── 5. Carry the old allowlist over ────────────────────────────────────────
-- Everyone who was an admin becomes a global owner, so nobody is locked out by
-- this migration.

insert into public.survey_members (email, organization_id, role)
select a.email, null, 'owner'::public.survey_role
from public.survey_admins a
on conflict do nothing;

-- ── 6. Seed the first organization and file existing surveys under it ──────

insert into public.organizations (name, slug)
values ('S2M Health', 's2m-health')
on conflict (slug) do nothing;

update public.surveys
set organization_id = (select id from public.organizations where slug = 's2m-health')
where organization_id is null;

-- ── 7. Policies ────────────────────────────────────────────────────────────

-- Organizations: any member may see the folders; only a platform owner may
-- create or rename one.
drop policy if exists "Members read organizations" on public.organizations;
create policy "Members read organizations"
  on public.organizations for select to authenticated
  using (public.is_survey_member());

drop policy if exists "Owners manage organizations" on public.organizations;
create policy "Owners manage organizations"
  on public.organizations for all to authenticated
  using (public.has_survey_role(id, 'owner'))
  with check (public.has_survey_role(id, 'owner'));

-- Surveys. The anon policy from stage 2 is unchanged and still governs
-- respondents; these govern signed-in staff.
drop policy if exists "Admins manage surveys" on public.surveys;

drop policy if exists "Members read surveys in their org" on public.surveys;
create policy "Members read surveys in their org"
  on public.surveys for select to authenticated
  using (public.has_survey_role(organization_id, 'viewer'));

drop policy if exists "Editors write surveys in their org" on public.surveys;
create policy "Editors write surveys in their org"
  on public.surveys for insert to authenticated
  with check (public.has_survey_role(organization_id, 'editor'));

drop policy if exists "Editors update surveys in their org" on public.surveys;
create policy "Editors update surveys in their org"
  on public.surveys for update to authenticated
  using (public.has_survey_role(organization_id, 'editor'))
  with check (public.has_survey_role(organization_id, 'editor'));

-- Deleting a survey is an owner action: it is the one write that destroys work
-- rather than changing it.
drop policy if exists "Owners delete surveys" on public.surveys;
create policy "Owners delete surveys"
  on public.surveys for delete to authenticated
  using (public.has_survey_role(organization_id, 'owner'));

-- A policy alone does not expose a table. Without these grants PostgREST
-- cannot see them and every request fails with PGRST205.
grant select on public.organizations to authenticated;
grant insert, update, delete on public.organizations to authenticated;
grant select, insert, update, delete on public.surveys to authenticated;

notify pgrst, 'reload schema';

-- ── 8. Proof ───────────────────────────────────────────────────────────────

select 'organizations table'  as check, count(*)::text as result
  from information_schema.tables where table_schema='public' and table_name='organizations'
union all select 'survey_members table', count(*)::text
  from information_schema.tables where table_schema='public' and table_name='survey_members'
union all select 'surveys.organization_id', count(*)::text
  from information_schema.columns where table_schema='public' and table_name='surveys' and column_name='organization_id'
union all select 'organizations seeded', count(*)::text from public.organizations
union all select 'members carried over', count(*)::text from public.survey_members
union all select 'surveys filed to an org', count(*)::text from public.surveys where organization_id is not null;
