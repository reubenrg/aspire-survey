-- Survey schedule + response limit, hidden fields, and storage for the richer
-- question types (sum, multitext, heading, image, file, signature, fullname, phone).
--
-- 1. surveys.opens_at / closes_at / max_responses. Enforced in the database, not the
--    page: the open-link path is a direct anon INSERT gated by RLS, so the gate
--    (survey_accepting_responses) must know about them or a respondent could simply
--    skip the page. The invitation path (submit_invited_response) checks the same
--    rule. The response limit is checked as "count < max" at insert time, so two
--    submissions racing for the very last place can both succeed; treat it as
--    accurate to within a handful, not a hard lock.
-- 2. survey_availability(slug): a coarse public answer ('open' | 'not_open_yet' |
--    'ended' | 'full' | 'closed') so the respondent page can say why. It never
--    returns a count.
-- 3. ensure_survey_response_table: hidden fields become text columns; matrix-like
--    types (matrix, sum, multitext) get one column per row; a heading has no column;
--    a multi-select image question is text[].

alter table public.surveys
  add column if not exists opens_at timestamptz,
  add column if not exists closes_at timestamptz,
  add column if not exists max_responses integer;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'surveys_max_responses_positive') then
    alter table public.surveys add constraint surveys_max_responses_positive
      check (max_responses is null or max_responses > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'surveys_window_ordered') then
    alter table public.surveys add constraint surveys_window_ordered
      check (opens_at is null or closes_at is null or opens_at < closes_at);
  end if;
end $c$;

grant select (opens_at, closes_at, max_responses) on public.surveys to anon, authenticated;
grant insert (opens_at, closes_at, max_responses) on public.surveys to authenticated;
grant update (opens_at, closes_at, max_responses) on public.surveys to authenticated;

-- One rule, used by both submission paths and by the public availability answer.
CREATE OR REPLACE FUNCTION public.survey_availability_for(p_survey_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; n bigint;
begin
  select s.published, s.closed_at, s.archived_at, s.opens_at, s.closes_at, s.max_responses,
         s.table_name, coalesce(o.is_active, false) as org_active
    into r
  from public.surveys s left join public.organizations o on o.id = s.organization_id
  where s.id = p_survey_id;
  if not found then return 'closed'; end if;
  if not (r.published and r.closed_at is null and r.archived_at is null and r.org_active) then return 'closed'; end if;
  if r.opens_at is not null and r.opens_at > now() then return 'not_open_yet'; end if;
  if r.closes_at is not null and r.closes_at <= now() then return 'ended'; end if;
  if r.max_responses is not null
     and r.table_name ~ '^[a-z_][a-z0-9_]*$' and to_regclass('public.' || r.table_name) is not null then
    execute format('select count(*) from public.%I', r.table_name) into n;
    if n >= r.max_responses then return 'full'; end if;
  end if;
  return 'open';
end $function$;

CREATE OR REPLACE FUNCTION public.survey_accepting_responses(p_table_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record;
begin
  select s2.id, s2.privacy_mode into s from public.surveys s2 where s2.table_name = p_table_name;
  if not found or s.privacy_mode <> 'ANONYMOUS' then return false; end if;
  return public.survey_availability_for(s.id) = 'open';
end $function$;

CREATE OR REPLACE FUNCTION public.survey_availability(p_slug text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select public.survey_availability_for(s.id) from public.surveys s where s.slug = p_slug), 'closed');
$function$;

revoke all on function public.survey_availability_for(uuid) from public, anon, authenticated;
revoke all on function public.survey_availability(text) from public;
grant execute on function public.survey_availability(text) to anon, authenticated;

-- Invitation path: same window and limit as the open link.
CREATE OR REPLACE FUNCTION public.submit_invited_response(p_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv record; s record; emp record; cols text; vals text; stamp timestamptz;
        has_resp_cols boolean; has_employee_id_col boolean; org_active boolean; avail text;
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

  avail := public.survey_availability_for(s.id);
  if avail <> 'open' then
    return jsonb_build_object('ok', false, 'reason', case avail when 'full' then 'FULL' else 'UNAVAILABLE' end);
  end if;

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

-- Table provisioning: hidden fields, matrix-like types, headings, image/file/signature.
CREATE OR REPLACE FUNCTION public.ensure_survey_response_table(p_survey_id uuid, p_definition jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      if q->>'type' = 'heading' then
        continue; -- display only: nothing is stored
      elsif q->>'type' in ('matrix', 'sum', 'multitext') then
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
        types := types || (case when q->>'type' in ('checkbox', 'ranking')
                                  or (q->>'type' = 'image' and q->>'multiple' = 'true')
                                then 'text[]' else 'text' end)::text;
        if q->>'type' in ('radio', 'checkbox') and coalesce(q->>'otherColumn', '') <> '' then
          cols := cols || (q->>'otherColumn')::text;
          types := types || 'text'::text;
        end if;
      end if;
    end loop;
  end loop;

  -- Hidden fields: values carried in the survey link (?source=email), stored as text.
  for k in select jsonb_array_elements_text(coalesce(def->'hiddenFields', '[]'::jsonb)) loop
    cols := cols || public.survey_snake_case(k)::text;
    types := types || 'text'::text;
  end loop;

  if array_length(cols, 1) is null then
    raise exception 'This survey has no questions to store yet';
  end if;

  -- resp_department/resp_location/resp_designation are created unconditionally
  -- below regardless of privacy_mode (only employee_id is actually conditional
  -- on CONFIDENTIAL), so they must be reserved in every mode - previously this
  -- only reserved them for non-ANONYMOUS surveys, which meant a question could
  -- validly claim one of these names on an ANONYMOUS survey. On first creation
  -- that produced a raw "column specified more than once" failure instead of
  -- the intended validation error; on an already-existing table it would have
  -- silently skipped adding the column (it "already exists"), routing a real
  -- answer into a column every export/report path treats as reserved and
  -- strips - an invisible-answer bug, not just a confusing error.
  reserved := array['id', 'submitted_at', 'definition_version',
                     'resp_department', 'resp_location', 'resp_designation']
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
    'create policy "Public can submit responses" on public.%I for insert to anon with check (public.survey_accepting_responses(%L))',
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

notify pgrst, 'reload schema';
