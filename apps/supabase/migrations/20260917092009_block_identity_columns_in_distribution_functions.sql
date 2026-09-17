-- CRITICAL fix: survey_columns_distribution()/survey_text_count() validated
-- p_column against a safe-identifier regex and confirmed it exists on the
-- table, but never excluded the four privacy-restricted columns
-- (employee_id, resp_department, resp_location, resp_designation). Any
-- caller clearing only the 'analyst' role bar - lower than can_view_identity()
-- - could request p_columns=['employee_id'] directly via this RPC and get
-- back raw employee UUIDs with response counts, bypassing can_view_identity()
-- entirely; requesting resp_department etc. bypassed survey_segment_summary()'s
-- minimum-group suppression threshold the same way. Proved live before this
-- fix: survey_columns_distribution('qa-integrity-habit', ARRAY['employee_id'])
-- returned the real employee_id UUID with n=1, no suppression, no identity
-- check - gated only by "the UI doesn't ask for it".
--
-- survey_multiselect_distribution() is naturally blocked for these four
-- columns today (none of them is a text[] column, so unnest() would error),
-- but gets the same explicit denylist for defense in depth - a future column
-- type change should not silently reopen this.
CREATE OR REPLACE FUNCTION public.survey_columns_distribution(p_slug text, p_columns text[], p_version integer DEFAULT NULL::integer)
 RETURNS TABLE(column_name text, value text, n bigint, pct numeric)
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
    if col !~ '^[a-z_][a-z0-9_]*$' then continue; end if;
    if col = any(restricted) then continue; end if;
    if not exists (select 1 from information_schema.columns c
                   where c.table_schema='public' and c.table_name=s.table_name and c.column_name=col) then
      continue;
    end if;
    return query execute format($f$
      select %L::text, v, n, round(100.0 * n / nullif(sum(n) over(), 0), 1)
      from (
        select %I::text as v, count(*) as n
        from public.%I
        where %I is not null and ($1 is null or definition_version = $1)
        group by %I
      ) g
    $f$, col, col, s.table_name, col, col) using p_version;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.survey_multiselect_distribution(p_slug text, p_column text, p_version integer DEFAULT NULL::integer)
 RETURNS TABLE(value text, n bigint, pct_of_respondents numeric, respondents bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; resp_count bigint;
  restricted constant text[] := array['employee_id','resp_department','resp_location','resp_designation'];
begin
  select * into s from public.surveys where slug = p_slug;
  if s.id is null or not public.has_survey_role(s.organization_id, 'analyst') then return; end if;
  if p_column !~ '^[a-z_][a-z0-9_]*$' then return; end if;
  if p_column = any(restricted) then return; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name=s.table_name and column_name=p_column) then
    return;
  end if;

  execute format(
    'select count(*) from public.%I where %I <> ''{}'' and ($1 is null or definition_version = $1)',
    s.table_name, p_column) into resp_count using p_version;

  return query execute format($f$
    select v, count(*), round(100.0 * count(*) / nullif(%L::bigint, 0), 1), %L::bigint
    from public.%I, unnest(%I) as v
    where ($1 is null or definition_version = $1)
    group by v
    order by count(*) desc
  $f$, resp_count, resp_count, s.table_name, p_column) using p_version;
end $function$;

CREATE OR REPLACE FUNCTION public.survey_text_count(p_slug text, p_column text, p_version integer DEFAULT NULL::integer)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; n bigint;
  restricted constant text[] := array['employee_id','resp_department','resp_location','resp_designation'];
begin
  select * into s from public.surveys where slug = p_slug;
  if s.id is null or not public.has_survey_role(s.organization_id, 'analyst') then return null; end if;
  if p_column !~ '^[a-z_][a-z0-9_]*$' then return null; end if;
  if p_column = any(restricted) then return null; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name=s.table_name and column_name=p_column) then
    return null;
  end if;
  execute format(
    'select count(*) from public.%I where %I is not null and %I <> '''' and ($1 is null or definition_version = $1)',
    s.table_name, p_column, p_column) into n using p_version;
  return n;
end $function$;
