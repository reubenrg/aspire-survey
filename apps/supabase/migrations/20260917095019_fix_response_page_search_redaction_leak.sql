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

  -- Search now runs against the SAME redacted row_data the caller is shown,
  -- never against the raw row: previously `to_jsonb(t)::text ilike ...` ran
  -- on the unredacted row before employee_id/resp_department/resp_location/
  -- resp_designation were stripped, so a viewer with no identity rights
  -- could search for a department/location/designation value and learn
  -- which rows matched it via the returned row set and count - even though
  -- that column never appeared in what was returned. Restructured so the
  -- redaction happens first (innermost `r`), search/pagination/count run
  -- against that already-redacted projection (`x`), and search can never
  -- see more than the caller is shown.
  --
  -- Proved live before this fix: an analyst with can_view_identity=false on
  -- a CONFIDENTIAL survey, searching for "Operations" (a real
  -- resp_department value never present in the returned row_data), still
  -- got that row back with identity_included:false - i.e. the search
  -- matched a column the response never disclosed to them.
  if authorized_identity then
    sql := format($f$
      select coalesce(jsonb_agg(row_data order by submitted_at desc), '[]'::jsonb), max(cnt)
      from (
        select r.row_data, r.submitted_at, count(*) over() as cnt
        from (
          select ((to_jsonb(t) - 'resp_department' - 'resp_location' - 'resp_designation')
                  || jsonb_build_object('employee_code', e.employee_code, 'employee_name', e.employee_name)) as row_data,
                 t.submitted_at
          from public.%I t left join public.employees e on e.id = t.employee_id
          where ($1 is null or t.submitted_at >= $1)
            and ($2 is null or t.submitted_at <= $2)
            and ($3 is null or t.definition_version = $3)
        ) r
        where ($4 is null or r.row_data::text ilike '%%'||$4||'%%')
        order by r.submitted_at desc limit $5 offset $6
      ) x
    $f$, s.table_name);
  elsif coarsen then
    sql := format($f$
      select coalesce(jsonb_agg(row_data order by submitted_at desc), '[]'::jsonb), max(cnt)
      from (
        select r.row_data, r.submitted_at, count(*) over() as cnt
        from (
          select ((to_jsonb(t) - 'employee_id' - 'resp_department' - 'resp_location' - 'resp_designation' - 'submitted_at')
                  || jsonb_build_object('submitted_at', date_trunc('hour', t.submitted_at))) as row_data,
                 t.submitted_at
          from public.%I t
          where ($1 is null or t.submitted_at >= $1)
            and ($2 is null or t.submitted_at <= $2)
            and ($3 is null or t.definition_version = $3)
        ) r
        where ($4 is null or r.row_data::text ilike '%%'||$4||'%%')
        order by r.submitted_at desc limit $5 offset $6
      ) x
    $f$, s.table_name);
  else
    sql := format($f$
      select coalesce(jsonb_agg(row_data order by submitted_at desc), '[]'::jsonb), max(cnt)
      from (
        select r.row_data, r.submitted_at, count(*) over() as cnt
        from (
          select (to_jsonb(t) - 'employee_id' - 'resp_department' - 'resp_location' - 'resp_designation') as row_data,
                 t.submitted_at
          from public.%I t
          where ($1 is null or t.submitted_at >= $1)
            and ($2 is null or t.submitted_at <= $2)
            and ($3 is null or t.definition_version = $3)
        ) r
        where ($4 is null or r.row_data::text ilike '%%'||$4||'%%')
        order by r.submitted_at desc limit $5 offset $6
      ) x
    $f$, s.table_name);
  end if;

  execute sql into rows, total using p_date_from, p_date_to, p_version, p_search, p_limit, p_offset;
  return jsonb_build_object('rows', coalesce(rows, '[]'::jsonb), 'total', coalesce(total, 0), 'identity_included', authorized_identity, 'timestamps_coarsened', coarsen);
end $function$;
