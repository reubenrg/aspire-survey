-- Phase A state-machine finding: survey_accepting_responses() never checked
-- archived_at. The product's own UI treats "Archived" as a one-way, filed-away
-- state (an archived survey loses its Preview link and further editing is
-- discouraged), and Archive is explicitly reachable directly from LIVE, not
-- only from CLOSED - but archiving a still-published, still-open survey left
-- it silently accepting public responses regardless.
--
-- Proved live before this fix: a published, non-closed, archived ANONYMOUS
-- survey with an active org still evaluated survey_accepting_responses() as
-- true.
CREATE OR REPLACE FUNCTION public.survey_accepting_responses(p_table_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select s.published and s.closed_at is null and s.archived_at is null and o.is_active and s.privacy_mode = 'ANONYMOUS'
     from public.surveys s join public.organizations o on o.id = s.organization_id
     where s.table_name = p_table_name),
    false
  );
$function$;
