-- HIGH fix: deactivating a customer (organizations.is_active = false) was
-- purely cosmetic. Confirmed nothing in the response/invitation path ever
-- checked it: a deactivated customer's published surveys stayed publicly
-- readable and submittable via /s/:slug, and resolve_invitation()/
-- submit_invited_response() never checked it either, so /r/:token kept
-- working too. Customers.tsx's own copy says deactivation "suspends" a
-- customer - this makes that true. Employees and team membership under a
-- deactivated org are deliberately left untouched (deactivation is meant to
-- pause data collection, not destroy the workspace).
--
-- NOTE: the RLS check this migration adds to the response-table INSERT
-- policy and the surveys SELECT policy join out to organizations directly
-- under the anon/authenticated role's own privileges (not a SECURITY
-- DEFINER function), which needed several follow-up grant migrations
-- immediately after this one before it actually worked end to end - see
-- grant_organizations_is_active_to_anon, grant_surveys_organization_id_to_anon,
-- grant_organizations_id_to_anon, and the eventual real fix in
-- fix_response_insert_check_via_security_definer /
-- fix_surveys_select_policy_org_active_check, which replaced this direct-join
-- approach with SECURITY DEFINER helper functions and let the extra grants be
-- revoked again. Kept here byte-exact to what was actually executed.

-- 1. Public survey discovery/read now also requires the parent org be active.
drop policy if exists "Public can read published surveys" on public.surveys;
create policy "Public can read published surveys" on public.surveys for select to anon
  using (published = true and (select o.is_active from public.organizations o where o.id = surveys.organization_id));

-- 2. Invitation resolution rejects a deactivated customer's survey the same
-- way it already rejects a closed one.
CREATE OR REPLACE FUNCTION public.resolve_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv record; s record; org_active boolean; stamp timestamptz;
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

  select o.is_active into org_active from public.organizations o where o.id = s.organization_id;
  if org_active is not true then return jsonb_build_object('valid', false, 'reason', 'UNAVAILABLE'); end if;

  stamp := public.invitation_stamp(s.privacy_mode);
  update public.survey_invitations
  set status = case when status in ('NOT_SENT','SENT') then 'OPENED' else status end,
      opened_at = coalesce(opened_at, stamp)
  where id = inv.id;

  return jsonb_build_object('valid', true, 'slug', s.slug, 'definition', s.definition,
    'privacy_mode', s.privacy_mode, 'version', coalesce(inv.survey_version, s.current_version));
end $function$;

-- 3. Submission rejects it too, so a link opened before deactivation (and
-- therefore not caught by the resolve-time check above) still can't complete.
CREATE OR REPLACE FUNCTION public.submit_invited_response(p_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv record; s record; emp record; cols text; vals text; stamp timestamptz;
        has_resp_cols boolean; has_employee_id_col boolean; org_active boolean;
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
  select o.is_active into org_active from public.organizations o where o.id = s.organization_id;
  if org_active is not true then return jsonb_build_object('ok', false, 'reason', 'UNAVAILABLE'); end if;
  if s.table_name !~ '^[a-z_][a-z0-9_]*$' or to_regclass('public.'||s.table_name) is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_TABLE');
  end if;

  select
    string_agg(quote_ident(c.column_name), ', '),
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

-- 4. Editors can no longer issue new invitations for a deactivated
-- customer's survey (stops new outreach at the source, not just at the
-- respondent's end).
CREATE OR REPLACE FUNCTION public.issue_invitations(p_survey_id uuid, p_employee_ids uuid[], p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(employee_id uuid, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare org uuid; org_active boolean; ver int; eid uuid; raw text; n int;
begin
  select s.organization_id, s.current_version into org, ver
  from public.surveys s where s.id = p_survey_id;
  if org is null then raise exception 'No such survey'; end if;
  if not public.has_survey_role(org, 'editor') then
    raise exception 'You need the editor role to invite people to this survey';
  end if;
  select o.is_active into org_active from public.organizations o where o.id = org;
  if org_active is not true then
    raise exception 'This customer is deactivated. Reactivate it before inviting employees.';
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

-- 5. The response table's own INSERT policy - the actual RLS boundary a
-- direct anon insert hits - now also requires the org be active, alongside
-- the published/closed_at check added in the previous migration.
CREATE OR REPLACE FUNCTION public.ensure_survey_response_table(p_survey_id uuid, p_definition jsonb default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  s record; def jsonb; sec jsonb; q jsonb; rowsby jsonb; k text;
  tbl text; width int; i int;
  cols text[] := '{}'; types text[] := '{}';
  reserved text[]; unique_col text; grantable text[];
  table_existed boolean; added text[] := '{}'; body text := '';
  claimed_by uuid; looks_like_response_table boolean;
begin
  select * into s from public.surveys where id = p_survey_id;
  if s.id is null then raise exception 'No such survey'; end if;
  if not public.has_survey_role(s.organization_id, 'editor') then
    raise exception 'You need the editor role to set up this survey''s response table';
  end if;

  def := coalesce(p_definition, s.definition);
  tbl := coalesce(nullif(s.table_name, ''), 'survey_' || replace(s.slug, '-', '_'));

  if tbl !~ '^survey_[a-z0-9_]+$' then
    raise exception 'Refusing to provision "%": a response table must be named survey_<name>', tbl;
  end if;

  select id into claimed_by from public.surveys
  where table_name = tbl and id <> p_survey_id limit 1;
  if claimed_by is not null then
    raise exception 'Refusing to provision "%": it already belongs to another survey', tbl;
  end if;

  select to_regclass('public.' || tbl) is not null into table_existed;

  if table_existed then
    select count(*) = 3 into looks_like_response_table
    from information_schema.columns
    where table_schema = 'public' and table_name = tbl
      and column_name in ('id', 'submitted_at', 'definition_version');
    if not looks_like_response_table then
      raise exception 'Refusing to touch "%": it exists but is not a survey response table', tbl;
    end if;
  end if;

  for sec in select * from jsonb_array_elements(coalesce(def->'sections', '[]'::jsonb)) loop
    for q in select * from jsonb_array_elements(coalesce(sec->'questions', '[]'::jsonb)) loop
      if q->>'type' = 'matrix' then
        width := coalesce(jsonb_array_length(q->'rows'), 0);
        rowsby := q->'rowsByAnswer'->'map';
        if rowsby is not null then
          for k in select * from jsonb_object_keys(rowsby) loop
            width := greatest(width, coalesce(jsonb_array_length(rowsby->k), 0));
          end loop;
        end if;
        for i in 1..width loop
          cols := cols || (((q->>'columnPrefix') || '_' || lpad(i::text, 2, '0'))::text);
          types := types || 'text'::text;
        end loop;
      else
        cols := cols || coalesce(nullif(q->>'column', ''), public.survey_snake_case(q->>'id'))::text;
        types := types || (case when q->>'type' = 'checkbox' then 'text[]' else 'text' end)::text;
        if q->>'type' in ('radio', 'checkbox') and coalesce(q->>'otherColumn', '') <> '' then
          cols := cols || (q->>'otherColumn')::text;
          types := types || 'text'::text;
        end if;
      end if;
    end loop;
  end loop;

  if array_length(cols, 1) is null then
    raise exception 'This survey has no questions to store yet';
  end if;

  reserved := array['id', 'submitted_at', 'definition_version']
    || (case when s.privacy_mode <> 'ANONYMOUS'
             then array['resp_department', 'resp_location', 'resp_designation'] else '{}'::text[] end)
    || (case when s.privacy_mode = 'CONFIDENTIAL' then array['employee_id'] else '{}'::text[] end);

  for i in 1 .. array_length(cols, 1) loop
    if cols[i] !~ '^[a-z_][a-z0-9_]*$' then
      raise exception 'Question produces an unsafe column name "%"', cols[i];
    end if;
    if length(cols[i]) > 63 then
      raise exception 'Question produces a column name longer than Postgres allows: "%"', cols[i];
    end if;
    if cols[i] = any(reserved) then
      raise exception 'A question writes to "%", which is reserved in % mode', cols[i], s.privacy_mode;
    end if;
    if i > 1 and cols[i] = any(cols[1:i-1]) then
      raise exception 'Two questions both write to the column "%"', cols[i];
    end if;
  end loop;

  unique_col := case when coalesce(def->>'uniqueBy', '') <> ''
                     then public.survey_snake_case(def->>'uniqueBy') else null end;

  if not table_existed then
    for i in 1 .. array_length(cols, 1) loop
      body := body || format('  %I %s%s,' || chr(10), cols[i],
        case when types[i] = 'text[]' then 'text[] not null default ''{}''' else 'text' end,
        case when cols[i] = unique_col and types[i] <> 'text[]' then ' not null unique' else '' end);
    end loop;

    execute format(
      'create table public.%I (' || chr(10) ||
      '  id uuid primary key default gen_random_uuid(),' || chr(10) ||
      '  submitted_at timestamptz not null default now(),' || chr(10) ||
      '  definition_version int,' || chr(10) || '%s' ||
      '  resp_department text,' || chr(10) ||
      '  resp_location text,' || chr(10) ||
      '  resp_designation text%s' || chr(10) || ')',
      tbl, body,
      case when s.privacy_mode = 'CONFIDENTIAL'
           then ',' || chr(10) || '  employee_id uuid references public.employees(id)' else '' end);
  else
    for i in 1 .. array_length(cols, 1) loop
      if not exists (select 1 from information_schema.columns c
                     where c.table_schema = 'public' and c.table_name = tbl and c.column_name = cols[i]) then
        execute format('alter table public.%I add column %I %s', tbl, cols[i],
          case when types[i] = 'text[]' then 'text[] not null default ''{}''' else 'text' end);
        added := added || cols[i]::text;
      end if;
    end loop;
  end if;

  execute format('alter table public.%I enable row level security', tbl);

  execute format('drop policy if exists "Public can submit responses" on public.%I', tbl);
  execute format(
    'create policy "Public can submit responses" on public.%I for insert to anon with check ((select s2.published and s2.closed_at is null and o2.is_active from public.surveys s2 join public.organizations o2 on o2.id = s2.organization_id where s2.table_name = %L))',
    tbl, tbl);

  execute format('drop policy if exists "Analysts read responses" on public.%I', tbl);
  execute format(
    'create policy "Analysts read responses" on public.%I for select to authenticated using (public.has_survey_role((select s2.organization_id from public.surveys s2 where s2.table_name = %L), ''analyst''))',
    tbl, tbl);

  grantable := array['id', 'submitted_at', 'definition_version'] || cols;

  execute format('revoke all on public.%I from anon', tbl);
  execute format('grant insert on public.%I to anon', tbl);
  execute format('revoke all on public.%I from authenticated', tbl);
  execute format('grant select (%s), insert on public.%I to authenticated',
    (select string_agg(quote_ident(g), ', ') from unnest(grantable) g), tbl);

  notify pgrst, 'reload schema';

  perform public.record_audit(s.organization_id, 'SURVEY_TABLE_PROVISIONED',
    jsonb_build_object('survey_id', p_survey_id, 'table_name', tbl,
                       'created', not table_existed, 'columns_added', added));

  return jsonb_build_object('ok', true, 'table_name', tbl,
    'created', not table_existed, 'columns_added', to_jsonb(added));
end $function$;

revoke all on function public.ensure_survey_response_table(uuid, jsonb) from public, anon;
grant execute on function public.ensure_survey_response_table(uuid, jsonb) to authenticated;

-- Retrofit every existing response table's INSERT policy immediately
-- (no has_survey_role gate here either - this is a privileged administrative
-- backfill, same lesson as the earlier closed_at retrofit).
do $$
declare r record; n int := 0;
begin
  for r in select table_name from public.surveys
           where table_name is not null and to_regclass('public.' || table_name) is not null
  loop
    execute format('drop policy if exists "Public can submit responses" on public.%I', r.table_name);
    execute format(
      'create policy "Public can submit responses" on public.%I for insert to anon with check ((select s2.published and s2.closed_at is null and o2.is_active from public.surveys s2 join public.organizations o2 on o2.id = s2.organization_id where s2.table_name = %L))',
      r.table_name, r.table_name);
    n := n + 1;
  end loop;
  raise notice 'Retrofitted % response tables with the org-active check', n;
end $$;
