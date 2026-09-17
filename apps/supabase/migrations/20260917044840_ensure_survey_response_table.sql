-- Provisions a survey's response table from its own stored definition.
--
-- Until now this was a manual step: the old /admin/:slug editor generated the
-- CREATE TABLE via engine/generateSql.ts and an admin had to paste it into the
-- SQL editor by hand. Nothing in the newer Template -> Builder -> Publish flow
-- surfaced that, so a survey could publish "successfully" and then reject every
-- response with NO_TABLE. This closes that gap server-side.
--
-- No client-supplied DDL is ever executed: the definition is read from the
-- surveys row itself and every identifier is validated before interpolation.
-- Idempotent - creates the table when missing, and adds only missing columns
-- when it already exists (never drops or retypes, mirroring the additive-only
-- guarantee validateAdditive() enforces in the builder).
create or replace function public.ensure_survey_response_table(p_survey_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  s record; sec jsonb; q jsonb; rowsby jsonb; k text;
  tbl text; col text; ctype text; width int; i int;
  cols text[] := '{}'; types text[] := '{}';
  reserved text[]; unique_col text; grantable text[];
  table_existed boolean; added text[] := '{}'; body text := '';
begin
  select * into s from public.surveys where id = p_survey_id;
  if s.id is null then raise exception 'No such survey'; end if;
  if not public.has_survey_role(s.organization_id, 'editor') then
    raise exception 'You need the editor role to set up this survey''s response table';
  end if;

  tbl := coalesce(nullif(s.table_name, ''), 'survey_' || replace(s.slug, '-', '_'));
  if tbl !~ '^[a-z_][a-z0-9_]*$' then
    raise exception 'Unsafe table name "%"', tbl;
  end if;

  -- ── Derive columns, mirroring engine/definition.ts columnsFor() exactly ──
  for sec in select * from jsonb_array_elements(coalesce(s.definition->'sections', '[]'::jsonb)) loop
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
          cols := cols || ((q->>'columnPrefix') || '_' || lpad(i::text, 2, '0'));
          types := types || 'text';
        end loop;
      else
        cols := cols || coalesce(nullif(q->>'column', ''), public.survey_snake_case(q->>'id'));
        types := types || (case when q->>'type' = 'checkbox' then 'text[]' else 'text' end);
        if q->>'type' in ('radio', 'checkbox') and coalesce(q->>'otherColumn', '') <> '' then
          cols := cols || (q->>'otherColumn');
          types := types || 'text';
        end if;
      end if;
    end loop;
  end loop;

  if array_length(cols, 1) is null then
    raise exception 'This survey has no questions to store yet';
  end if;

  -- ── Validate: identifier safety, duplicates, reserved collisions ──
  reserved := array['id', 'submitted_at', 'definition_version']
    || (case when s.privacy_mode <> 'ANONYMOUS'
             then array['resp_department', 'resp_location', 'resp_designation'] else '{}'::text[] end)
    || (case when s.privacy_mode = 'CONFIDENTIAL' then array['employee_id'] else '{}'::text[] end);

  for i in 1 .. array_length(cols, 1) loop
    if cols[i] !~ '^[a-z_][a-z0-9_]*$' then
      raise exception 'Question produces an unsafe column name "%"', cols[i];
    end if;
    if cols[i] = any(reserved) then
      raise exception 'A question writes to "%", which is reserved in % mode', cols[i], s.privacy_mode;
    end if;
    for k in select unnest(cols[1:i-1]) loop
      if k = cols[i] then
        raise exception 'Two questions both write to the column "%"', cols[i];
      end if;
    end loop;
  end loop;

  unique_col := case when coalesce(s.definition->>'uniqueBy', '') <> ''
                     then public.survey_snake_case(s.definition->>'uniqueBy') else null end;

  select to_regclass('public.' || tbl) is not null into table_existed;

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
        added := added || cols[i];
      end if;
    end loop;
  end if;

  -- ── RLS + policies + grants (idempotent; safe to re-run) ──
  execute format('alter table public.%I enable row level security', tbl);

  execute format('drop policy if exists "Public can submit responses" on public.%I', tbl);
  execute format('create policy "Public can submit responses" on public.%I for insert to anon with check (true)', tbl);

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

  -- PostgREST caches the schema; without this a brand-new table stays
  -- invisible over the API until the next unrelated reload.
  notify pgrst, 'reload schema';

  perform public.record_audit(s.organization_id, 'SURVEY_TABLE_PROVISIONED',
    jsonb_build_object('survey_id', p_survey_id, 'table_name', tbl,
                       'created', not table_existed, 'columns_added', added));

  return jsonb_build_object('ok', true, 'table_name', tbl,
    'created', not table_existed, 'columns_added', to_jsonb(added));
end $function$;

revoke all on function public.ensure_survey_response_table(uuid) from public, anon;
grant execute on function public.ensure_survey_response_table(uuid) to authenticated;
