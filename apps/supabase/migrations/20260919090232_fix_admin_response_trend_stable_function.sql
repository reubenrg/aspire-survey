-- admin_response_trend() was declared STABLE but did `create temp table _trend`,
-- which Postgres forbids in a non-volatile function ("CREATE TABLE is not
-- allowed in a non-volatile function") - so the Overview page's "Responses,
-- last 30 days" call failed on EVERY invocation and the page always showed an
-- error banner. Found by walking the live Overview page.
--
-- Rewritten without any temp table: it builds one UNION ALL over every
-- visible survey's response table and aggregates once. It also returns every
-- day in the window (zero-filled) so the chart has a continuous axis instead of
-- plotting only the days that happened to have responses.
CREATE OR REPLACE FUNCTION public.admin_response_trend(p_days integer DEFAULT 30)
 RETURNS TABLE(day date, n bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  parts text := '';
  span int := least(greatest(coalesce(p_days, 30), 1), 366);
begin
  if not public.is_survey_member() then return; end if;

  for r in select s.table_name from public.surveys s
           where public.has_survey_role(s.organization_id, 'viewer')
  loop
    if r.table_name ~ '^[a-z_][a-z0-9_]*$' and to_regclass('public.' || r.table_name) is not null then
      parts := parts || case when parts = '' then '' else ' union all ' end
        || format('select (submitted_at)::date as d, count(*)::bigint as c from public.%I where submitted_at >= current_date - %s group by 1',
                  r.table_name, span);
    end if;
  end loop;

  if parts = '' then
    return query
      select (current_date - span + i)::date, 0::bigint from generate_series(0, span) i order by 1;
    return;
  end if;

  return query execute format(
    'select g.d, coalesce(sum(x.c), 0)::bigint from (select (current_date - %s + i)::date as d from generate_series(0, %s) i) g left join (%s) x on x.d = g.d group by g.d order by g.d',
    span, span, parts);
end $function$;
