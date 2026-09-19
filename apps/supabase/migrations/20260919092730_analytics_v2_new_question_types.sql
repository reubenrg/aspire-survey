-- Analytics v2 + storage for the new question types.
--
-- 1. ensure_survey_response_table: a `ranking` question is stored as an ordered
--    text[] (like a checkbox), not text. This is the ONLY change to that
--    function - the body below is otherwise identical to the live version.
-- 2. survey_report_columns: yes/no, rating and NPS are chartable choices.
-- 3. New analyst-gated, SECURITY DEFINER analytics functions:
--      survey_numeric_summary   mean / median / min / max / stddev of numeric answers
--      survey_ranking_summary   average position and first-choice count per option
--      survey_crosstab          question x question table, small cells suppressed
--      admin_response_overview  per-survey response counts and recency (org-wide pages)
--      admin_nps_overview       NPS per survey question, only with >= 5 answers
--    None can read identity columns, and all are revoked from anon.

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
        types := types || (case when q->>'type' in ('checkbox', 'ranking') then 'text[]' else 'text' end)::text;
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
        chartable := question_type in ('radio', 'checkbox', 'select', 'yesno', 'rating', 'nps');
        return next;
      end if;
    end loop;
  end loop;
end $function$;

-- ── Numeric summary ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.survey_numeric_summary(p_slug text, p_columns text[], p_version integer DEFAULT NULL)
 RETURNS TABLE(column_name text, n bigint, mean numeric, median numeric, min_value numeric, max_value numeric, stddev numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_variable
declare s record; col text;
  restricted constant text[] := array['employee_id','resp_department','resp_location','resp_designation'];
begin
  select * into s from public.surveys where slug = p_slug;
  if s.id is null or not public.has_survey_role(s.organization_id, 'analyst') then return; end if;
  if s.table_name !~ '^[a-z_][a-z0-9_]*$' or to_regclass('public.'||s.table_name) is null then return; end if;

  foreach col in array p_columns loop
    if col !~ '^[a-z_][a-z0-9_]*$' or col = any(restricted) then continue; end if;
    if not exists (select 1 from information_schema.columns c
                   where c.table_schema='public' and c.table_name=s.table_name
                     and c.column_name=col and c.data_type='text') then
      continue;
    end if;
    return query execute format($f$
      select %L::text, count(*), round(avg(v), 2),
             round((percentile_cont(0.5) within group (order by v))::numeric, 2),
             min(v), max(v), round(coalesce(stddev_samp(v), 0), 2)
      from (
        select %I::numeric as v from public.%I
        where %I ~ '^-?[0-9]+(\.[0-9]+)?$' and ($1 is null or definition_version = $1)
      ) g
      having count(*) > 0
    $f$, col, col, s.table_name, col) using p_version;
  end loop;
end $function$;

-- ── Ranking summary ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.survey_ranking_summary(p_slug text, p_column text, p_version integer DEFAULT NULL)
 RETURNS TABLE(value text, respondents bigint, avg_position numeric, first_choice bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record;
  restricted constant text[] := array['employee_id','resp_department','resp_location','resp_designation'];
begin
  select * into s from public.surveys where slug = p_slug;
  if s.id is null or not public.has_survey_role(s.organization_id, 'analyst') then return; end if;
  if s.table_name !~ '^[a-z_][a-z0-9_]*$' or to_regclass('public.'||s.table_name) is null then return; end if;
  if p_column !~ '^[a-z_][a-z0-9_]*$' or p_column = any(restricted) then return; end if;
  if not exists (select 1 from information_schema.columns c
                 where c.table_schema='public' and c.table_name=s.table_name
                   and c.column_name=p_column and c.data_type='ARRAY') then
    return;
  end if;
  return query execute format($f$
    select u.v, count(*), round(avg(u.pos), 2), count(*) filter (where u.pos = 1)
    from public.%I t, unnest(t.%I) with ordinality as u(v, pos)
    where cardinality(t.%I) > 0 and ($1 is null or t.definition_version = $1)
    group by u.v
    order by avg(u.pos), u.v
  $f$, s.table_name, p_column, p_column) using p_version;
end $function$;

-- ── Cross-tab with small-cell suppression ───────────────────────────────
-- Two questions against each other. A cell below the threshold is never
-- returned, and the count of hidden responses is only disclosed when two or
-- more cells are hidden together (a single hidden cell's size would otherwise
-- be readable as "total minus the visible cells"). The threshold can be raised
-- by the caller but never lowered below 5.
CREATE OR REPLACE FUNCTION public.survey_crosstab(
  p_slug text, p_row text, p_col text, p_version integer DEFAULT NULL, p_threshold integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; c text; cells jsonb; hidden int; hidden_n bigint; total bigint;
  restricted constant text[] := array['employee_id','resp_department','resp_location','resp_designation'];
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

  foreach c in array array[p_row, p_col] loop
    if c is null or c !~ '^[a-z_][a-z0-9_]*$' or c = any(restricted)
       or not exists (select 1 from information_schema.columns k
                      where k.table_schema='public' and k.table_name=s.table_name
                        and k.column_name=c and k.data_type='text') then
      return jsonb_build_object('error', 'invalid_column');
    end if;
  end loop;

  execute format($f$
    select coalesce(jsonb_agg(jsonb_build_object('row', r, 'col', k, 'n', n) order by n desc), '[]'::jsonb)
    from (select %I as r, %I as k, count(*) as n from public.%I
          where %I is not null and %I <> '' and %I is not null and %I <> ''
            and ($1 is null or definition_version = $1)
          group by 1, 2 having count(*) >= $2 order by 3 desc limit 400) g
  $f$, p_row, p_col, s.table_name, p_row, p_row, p_col, p_col)
    into cells using p_version, p_threshold;

  execute format($f$
    select count(*), coalesce(sum(n), 0)
    from (select count(*) as n from public.%I
          where %I is not null and %I <> '' and %I is not null and %I <> ''
            and ($1 is null or definition_version = $1)
          group by %I, %I having count(*) < $2) g
  $f$, s.table_name, p_row, p_row, p_col, p_col, p_row, p_col)
    into hidden, hidden_n using p_version, p_threshold;

  execute format($f$
    select count(*) from public.%I
    where %I is not null and %I <> '' and %I is not null and %I <> ''
      and ($1 is null or definition_version = $1)
  $f$, s.table_name, p_row, p_row, p_col, p_col) into total using p_version;

  return jsonb_build_object(
    'applicable', true, 'threshold', p_threshold, 'cells', cells,
    'suppressed_cells', hidden,
    'suppressed_responses', case when hidden >= 2 then hidden_n else null end,
    'total', case when total < p_threshold then null else total end
  );
end $function$;

-- ── Org-wide: response counts and recency per survey ────────────────────
CREATE OR REPLACE FUNCTION public.admin_response_overview()
 RETURNS TABLE(slug text, title text, organization_id uuid, organization_name text, status text,
               privacy_mode survey_privacy_mode, responses bigint, responses_7d bigint,
               responses_30d bigint, first_response_at timestamptz, last_response_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; n bigint; n7 bigint; n30 bigint; f timestamptz; l timestamptz;
begin
  if not public.is_survey_member() then return; end if;

  for r in
    select s.slug, s.title, s.organization_id, o.name as org_name, s.published, s.closed_at,
           s.archived_at, s.table_name, s.privacy_mode, s.updated_at
    from public.surveys s
    left join public.organizations o on o.id = s.organization_id
    where public.has_survey_role(s.organization_id, 'viewer')
    order by s.updated_at desc
  loop
    n := 0; n7 := 0; n30 := 0; f := null; l := null;
    if r.table_name ~ '^[a-z_][a-z0-9_]*$' and to_regclass('public.' || r.table_name) is not null then
      execute format(
        'select count(*), count(*) filter (where submitted_at >= now() - interval ''7 days''), count(*) filter (where submitted_at >= now() - interval ''30 days''), min(submitted_at), max(submitted_at) from public.%I',
        r.table_name) into n, n7, n30, f, l;
    end if;
    slug := r.slug; title := r.title; organization_id := r.organization_id;
    organization_name := r.org_name;
    status := public.survey_status(r.published, r.closed_at, r.archived_at);
    privacy_mode := r.privacy_mode;
    responses := n; responses_7d := n7; responses_30d := n30;
    first_response_at := f; last_response_at := l;
    return next;
  end loop;
end $function$;

-- ── Org-wide: NPS per survey question ───────────────────────────────────
-- Only surveys the caller can analyse, and only questions with at least 5
-- answers: a score computed from one or two people is an individual's answer.
CREATE OR REPLACE FUNCTION public.admin_nps_overview()
 RETURNS TABLE(slug text, title text, organization_name text, question_label text, answers bigint,
               promoters bigint, passives bigint, detractors bigint, nps numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; q jsonb; sec jsonb; col text; p bigint; pa bigint; d bigint; n bigint;
begin
  if not public.is_survey_member() then return; end if;

  for r in
    select s.slug, s.title, o.name as org_name, s.definition, s.table_name, s.organization_id
    from public.surveys s
    left join public.organizations o on o.id = s.organization_id
    where public.has_survey_role(s.organization_id, 'analyst')
      and s.table_name ~ '^[a-z_][a-z0-9_]*$' and to_regclass('public.' || s.table_name) is not null
  loop
    for sec in select * from jsonb_array_elements(coalesce(r.definition -> 'sections', '[]'::jsonb)) loop
      for q in select * from jsonb_array_elements(coalesce(sec -> 'questions', '[]'::jsonb)) loop
        continue when q ->> 'type' <> 'nps';
        col := coalesce(nullif(q ->> 'column', ''), public.survey_snake_case(q ->> 'id'));
        continue when col !~ '^[a-z_][a-z0-9_]*$';
        continue when not exists (select 1 from information_schema.columns c
                                  where c.table_schema = 'public' and c.table_name = r.table_name
                                    and c.column_name = col and c.data_type = 'text');
        execute format(
          'select count(*) filter (where %1$I ~ ''^(9|10)$''), count(*) filter (where %1$I ~ ''^(7|8)$''), count(*) filter (where %1$I ~ ''^([0-6])$''), count(*) filter (where %1$I ~ ''^([0-9]|10)$'') from public.%2$I',
          col, r.table_name) into p, pa, d, n;
        continue when n < 5;
        slug := r.slug; title := r.title; organization_name := r.org_name;
        question_label := q ->> 'label'; answers := n;
        promoters := p; passives := pa; detractors := d;
        nps := round(100.0 * (p - d) / n, 1);
        return next;
      end loop;
    end loop;
  end loop;
end $function$;

revoke all on function public.survey_numeric_summary(text, text[], integer) from public, anon;
revoke all on function public.survey_ranking_summary(text, text, integer) from public, anon;
revoke all on function public.survey_crosstab(text, text, text, integer, integer) from public, anon;
revoke all on function public.admin_response_overview() from public, anon;
revoke all on function public.admin_nps_overview() from public, anon;
grant execute on function public.survey_numeric_summary(text, text[], integer) to authenticated;
grant execute on function public.survey_ranking_summary(text, text, integer) to authenticated;
grant execute on function public.survey_crosstab(text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_response_overview() to authenticated;
grant execute on function public.admin_nps_overview() to authenticated;

notify pgrst, 'reload schema';
