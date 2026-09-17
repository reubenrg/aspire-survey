-- CRITICAL fix: /s/:slug (the open, no-invitation respondent route) had no
-- privacy_mode check anywhere - loadSurvey()/submitResponse() in
-- engine/surveyStore.ts do a plain client insert with no token, and the
-- response table's own INSERT policy only checked published/closed_at/
-- org-active, never the mode. For ANONYMOUS_TRACKED and CONFIDENTIAL
-- surveys - whose entire design is "each employee gets one personal
-- invitation link" - this meant anyone with (or guessing) the base slug URL
-- could submit unlimited, un-invited, unlinked responses, bypassing the
-- one-response-per-employee constraint that lives only inside
-- submit_invited_response(). Proved live before this fix: a plain anon
-- insert into the CONFIDENTIAL survey_behaviour_change table succeeded with
-- no invitation at all.
--
-- submit_invited_response() is unaffected by this change: it is SECURITY
-- DEFINER and its own dynamic INSERT runs under the function owner's
-- privileges, which bypasses table RLS entirely (confirmed by everything
-- this session's invitation-path testing already relied on) - it was never
-- subject to this anon-targeted policy in the first place, so restricting
-- that policy to ANONYMOUS-mode surveys only closes the real hole without
-- touching the legitimate invited-submission path at all.
CREATE OR REPLACE FUNCTION public.survey_accepting_responses(p_table_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select s.published and s.closed_at is null and o.is_active and s.privacy_mode = 'ANONYMOUS'
     from public.surveys s join public.organizations o on o.id = s.organization_id
     where s.table_name = p_table_name),
    false
  );
$function$;
