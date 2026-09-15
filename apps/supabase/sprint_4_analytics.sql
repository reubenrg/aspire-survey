-- ═══════════════════════════════════════════════════════════════════════════
-- Sprint 4: analytics with gated raw access
--
-- Response tables gain a SELECT policy for the first time. It is restricted to
-- analyst and above via has_survey_role(), so anon still cannot read a single
-- answer, but a signed-in analyst can read every row in full.
--
-- Worth stating plainly, because the schema no longer prevents it: these
-- surveys carry employee_id and employee_name alongside opinions about named
-- managers. Any analyst can therefore see who said what. That is a policy
-- decision, deliberately taken, not an oversight. If that is ever revisited,
-- section 5 below has the de-identified view ready to switch to.
--
-- Run in project zpefurbbejsarkcgmscg. Select ALL (Ctrl+A) first.
-- Requires sprints 1-3.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Lifecycle ───────────────────────────────────────────────────────────
-- Closing stops new responses without unpublishing, so the link keeps working
-- and explains itself rather than returning a dead page.

alter table public.surveys
  add column if not exists closed_at timestamptz;

-- ── 2. Raw read, gated on role ─────────────────────────────────────────────
-- Applied to every table registered in `surveys`, so existing response tables
-- get the policy too rather than only new ones.

do $$
declare r record;
begin
  for r in
    select distinct s.table_name, s.organization_id
    from public.surveys s
    where s.table_name is not null
  loop
    if r.table_name ~ '^[a-z_][a-z0-9_]*$'
       and to_regclass('public.' || r.table_name) is not null then

      execute format(
        'drop policy if exists "Analysts read responses" on public.%I', r.table_name);

      -- The organization is looked up from the registry at query time rather
      -- than baked in, so moving a survey between organizations moves who can
      -- read it without needing the policy rebuilt.
      execute format($p$
        create policy "Analysts read responses" on public.%1$I
          for select to authenticated
          using (public.has_survey_role(
            (select s.organization_id from public.surveys s where s.table_name = %1$L),
            'analyst'))
      $p$, r.table_name);

      execute format('grant select on public.%I to authenticated', r.table_name);
    end if;
  end loop;
end $$;

-- ── 3. Aggregates ──────────────────────────────────────────────────────────
-- Still worth having with raw access available: charts should not pull every
-- row into a browser to count them, and these work for a viewer-level dashboard
-- later without widening raw access.

create or replace function public.survey_snake_case(p text)
returns text language sql immutable as $$
  select trim(both '_' from lower(regexp_replace(
    regexp_replace(p, '([a-z0-9])([A-Z])', '\1_\2', 'g'),
    '[^A-Za-z0-9]+', '_', 'g')));
$$;

-- Which column each question writes to, derived from the stored definition.
-- `chartable` is a display hint, not a security boundary: a distribution over
-- free text is one row per person with a count of 1, which is a bad chart
-- rather than a leak now that analysts can read the text directly.
create or replace function public.survey_report_columns(p_slug text)
returns table (
  question_id text,
  label text,
  column_name text,
  question_type text,
  chartable boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  def jsonb; org uuid; sec jsonb; q jsonb; i int;
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
end $$;

create or replace function public.survey_report_stats(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
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
end $$;

create or replace function public.survey_report_breakdown(p_slug text, p_column text)
returns table (value text, n bigint)
language plpgsql
security definer
set search_path = public
stable
as $$
declare t text; org uuid; is_array boolean;
begin
  select table_name, organization_id into t, org from public.surveys where slug = p_slug;
  if t is null then return; end if;
  if not public.has_survey_role(org, 'analyst') then return; end if;
  if t !~ '^[a-z_][a-z0-9_]*$' or to_regclass('public.' || t) is null then return; end if;

  -- Only columns the definition actually writes, so this cannot be pointed at
  -- an unrelated column of the table.
  -- Must be a column the definition writes AND one with a bounded set of
  -- answers. A breakdown over free text is one row per person with a count of
  -- one beside each, which is not a distribution and can be arbitrarily large.
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
end $$;

revoke all on function public.survey_report_columns(text) from public;
revoke all on function public.survey_report_stats(text) from public;
revoke all on function public.survey_report_breakdown(text, text) from public;
grant execute on function public.survey_report_columns(text) to authenticated;
grant execute on function public.survey_report_stats(text) to authenticated;
grant execute on function public.survey_report_breakdown(text, text) to authenticated;

-- ── 4. Export audit ────────────────────────────────────────────────────────
-- Sprint 5 brings the full log. Exports are recorded from the start, because an
-- export is the moment identified data leaves the system, and a log that begins
-- later cannot account for what already left.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  user_email text not null,
  action_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

-- Written only through this function, which stamps the identity from the JWT
-- rather than accepting one. A client cannot write a log entry attributing an
-- action to somebody else, and cannot write one at all except through here.
create or replace function public.record_audit(
  p_organization_id uuid, p_action_type text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') = '' then return; end if;
  insert into public.audit_logs (organization_id, user_email, action_type, details)
  values (p_organization_id, auth.jwt() ->> 'email', p_action_type, coalesce(p_details, '{}'::jsonb));
end $$;

drop policy if exists "Owners read audit log" on public.audit_logs;
create policy "Owners read audit log"
  on public.audit_logs for select to authenticated
  using (public.has_survey_role(organization_id, 'owner'));

-- Select only. No insert, update or delete grant, so the log is append-only and
-- appended to solely by record_audit().
grant select on public.audit_logs to authenticated;
revoke all on function public.record_audit(uuid, text, jsonb) from public;
grant execute on function public.record_audit(uuid, text, jsonb) to authenticated;

-- ── 5. De-identified view, ready but not wired ─────────────────────────────
-- Not created here. If the anonymity decision is revisited, creating a view per
-- survey that omits the identity columns, granting select on the view instead
-- of the table, and dropping "Analysts read responses" gives full qualitative
-- text without naming anyone. Left as a note rather than dead objects.

notify pgrst, 'reload schema';

-- ── Proof ──────────────────────────────────────────────────────────────────

select 'report functions' as check, count(*)::text as result
  from information_schema.routines where routine_schema='public'
    and routine_name in ('survey_report_columns','survey_report_stats','survey_report_breakdown')
union all select 'surveys.closed_at', count(*)::text
  from information_schema.columns
  where table_schema='public' and table_name='surveys' and column_name='closed_at'
union all select 'audit_logs table', count(*)::text
  from information_schema.tables where table_schema='public' and table_name='audit_logs'
union all select 'analyst read policies on response tables', count(*)::text
  from pg_policies where schemaname='public' and policyname='Analysts read responses'
union all select 'anon select policies (must be 0)', count(*)::text
  from pg_policies
  where schemaname='public' and cmd='SELECT' and 'anon' = any(roles)
    and tablename in (select table_name from public.surveys where table_name is not null);
