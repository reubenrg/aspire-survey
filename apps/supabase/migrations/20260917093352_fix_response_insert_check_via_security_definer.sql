-- Root cause of the last three migrations' trial-and-error: the INSERT
-- policy's subquery joined organizations, but organizations has RLS enabled
-- with no policy admitting anon at all ("Members read organizations" is
-- authenticated-only). Column GRANTS and RLS are independent layers - once
-- the grants were satisfied, RLS still silently returned zero rows for the
-- join, making the scalar subquery NULL, and `with check (NULL)` is treated
-- as false - so the check failed even for a legitimately open, active
-- survey. Confirmed by testing directly: has_column_privilege was true, the
-- same subquery run as a privileged role returned true, but the anon-role
-- INSERT still failed.
--
-- The correct fix, matching this codebase's own established pattern
-- (has_survey_role/can_view_identity/etc.), is a narrow SECURITY DEFINER
-- function that bypasses RLS safely for exactly this one check, rather than
-- broadening anon's raw grants on core administrative tables. Revokes the
-- organizations.id/is_active and surveys.organization_id grants added while
-- chasing this - they're no longer needed and this keeps anon's surface
-- area on those tables as narrow as before this whole fix.

CREATE OR REPLACE FUNCTION public.survey_accepting_responses(p_table_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select s.published and s.closed_at is null and o.is_active
     from public.surveys s join public.organizations o on o.id = s.organization_id
     where s.table_name = p_table_name),
    false
  );
$function$;

revoke all on function public.survey_accepting_responses(text) from public;
grant execute on function public.survey_accepting_responses(text) to anon, authenticated;

revoke select (id, is_active) on public.organizations from anon;
revoke select (organization_id) on public.surveys from anon;

-- Every response table's INSERT policy now calls the function instead of
-- querying surveys/organizations directly.
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

revoke all on function public.ensure_survey_response_table(uuid, jsonb) from public, anon;
grant execute on function public.ensure_survey_response_table(uuid, jsonb) to authenticated;

do $$
declare r record; n int := 0;
begin
  for r in select table_name from public.surveys
           where table_name is not null and to_regclass('public.' || table_name) is not null
  loop
    execute format('drop policy if exists "Public can submit responses" on public.%I', r.table_name);
    execute format(
      'create policy "Public can submit responses" on public.%I for insert to anon with check (public.survey_accepting_responses(%L))',
      r.table_name, r.table_name);
    n := n + 1;
  end loop;
  raise notice 'Retrofitted % response tables to use survey_accepting_responses()', n;
end $$;
