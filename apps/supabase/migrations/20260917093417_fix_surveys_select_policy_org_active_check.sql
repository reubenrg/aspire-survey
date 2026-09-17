-- Same RLS-through-RLS bug as the response-table INSERT policy: this
-- policy's subquery joins organizations, which has no anon-admitting RLS
-- policy, so it silently returned zero rows and the whole USING clause
-- evaluated false even for an active org. Fixed the same way: a narrow
-- SECURITY DEFINER helper that bypasses RLS safely for exactly this check.
CREATE OR REPLACE FUNCTION public.organization_is_active(p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select o.is_active from public.organizations o where o.id = p_organization_id), false);
$function$;

revoke all on function public.organization_is_active(uuid) from public;
grant execute on function public.organization_is_active(uuid) to anon, authenticated;

drop policy if exists "Public can read published surveys" on public.surveys;
create policy "Public can read published surveys" on public.surveys for select to anon
  using (published = true and public.organization_is_active(organization_id));
