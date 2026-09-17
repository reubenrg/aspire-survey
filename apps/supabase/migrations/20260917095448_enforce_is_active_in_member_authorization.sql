-- get_user_role() backs has_survey_role(), which gates nearly every
-- authorization check in the schema. It never filtered on is_active, so
-- "Deactivate" on the Team page (set_team_member_active) changed only a
-- cosmetic list badge: a deactivated member kept full role-based access,
-- and (via can_view_identity/is_survey_member not checking it either) kept
-- identity-view rights and read access to organizations/question_library/
-- survey_templates/platform_settings. Proven live before this fix: a member
-- row with is_active=false still passed has_survey_role(), can_view_identity()
-- and is_survey_member() as true. Verified after: all three now correctly
-- return false for that row, and an is_active=true control member is
-- unaffected.
CREATE OR REPLACE FUNCTION public.get_user_role(target_org_id uuid)
 RETURNS survey_role
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select m.role
  from public.survey_members m
  where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and m.is_active
    and (m.organization_id is null or m.organization_id = target_org_id)
  order by public.survey_role_rank(m.role) desc
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.can_view_identity(target_org_id uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce(
    public.has_survey_role(target_org_id, 'owner')
    or exists (
      select 1 from public.survey_members m
      where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and m.is_active
        and (m.organization_id is null or m.organization_id = target_org_id)
        and m.can_view_identity
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_survey_member()
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.survey_members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and is_active
  );
$function$;
