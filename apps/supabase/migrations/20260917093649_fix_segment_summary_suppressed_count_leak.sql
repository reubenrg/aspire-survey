-- CRITICAL fix: survey_segment_summary() correctly withholds any group
-- below the suppression threshold from `groups`, but then returned
-- `suppressed_responses` (the sum of every hidden group's headcount) with
-- no protection of its own. Whenever exactly one group is suppressed for a
-- chosen dimension - routine for any org with an uneven distribution, not
-- an edge case - that sum IS that one group's exact size, precisely the
-- number the threshold exists to hide. Proved live before this fix:
-- survey_segment_summary('qa-integrity-habit', 'department') returned
-- suppressed_groups=1, suppressed_responses=1 - an exact headcount, printed
-- directly into SurveyAnalytics.tsx's UI with no further protection.
--
-- Fix: only ever return suppressed_responses when 2+ groups are suppressed,
-- so it represents a combined total across multiple hidden groups rather
-- than one group's exact count. suppressed_groups (the count of hidden
-- groups, not their size) is unaffected - "some groups were hidden" is not
-- itself sensitive.
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
    'groups', groups, 'suppressed_groups', suppressed_groups,
    -- Withheld whenever fewer than 2 groups are suppressed, so this can
    -- never be read back as one specific group's exact headcount.
    'suppressed_responses', case when suppressed_groups >= 2 then suppressed_responses else null end
  );
end $function$;
