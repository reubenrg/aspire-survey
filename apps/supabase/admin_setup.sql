-- Admin access for the survey builder.
--
-- The sign-in screen is convenience, not security: anyone can change what the
-- browser runs. These policies are the real boundary. A signed-in user who is
-- not on the allowlist can reach the admin screen and will have every write
-- rejected, which is the correct place for that to fail.
--
-- Select everything (Ctrl+A) before running.

-- Who may build surveys. Add a row per person, using the email they sign in with.
create table if not exists public.survey_admins (
  email text primary key,
  added_at timestamptz not null default now()
);

alter table public.survey_admins enable row level security;

-- Deliberately no policy for anon or authenticated: the allowlist is readable
-- only from the SQL editor, so nobody can enumerate admins from the browser.
-- The helper below reads it with definer rights instead.

create or replace function public.is_survey_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.survey_admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_survey_admin() from public;
grant execute on function public.is_survey_admin() to authenticated;

-- Only allowlisted admins may create, edit, publish or delete a survey.
drop policy if exists "Admins manage surveys" on public.surveys;
create policy "Admins manage surveys"
  on public.surveys
  for all
  to authenticated
  using (public.is_survey_admin())
  with check (public.is_survey_admin());

-- A policy alone does not expose a table. Without this grant PostgREST cannot
-- see it and every request fails with PGRST205.
grant select, insert, update, delete on public.surveys to authenticated;

-- ── Add yourself here ──────────────────────────────────────────────────
-- Replace the address with the email you will sign in with, then run.
-- insert into public.survey_admins (email) values ('you@example.com')
--   on conflict (email) do nothing;

notify pgrst, 'reload schema';

-- Proof.
select 'admins table exists' as check, count(*)::text as result
from information_schema.tables where table_schema='public' and table_name='survey_admins'
union all
select 'admins listed', count(*)::text from public.survey_admins;
