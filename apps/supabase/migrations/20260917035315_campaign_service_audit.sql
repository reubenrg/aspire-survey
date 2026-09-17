CREATE OR REPLACE FUNCTION public.service_record_audit(p_organization_id uuid, p_actor_email text, p_action_type text, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.audit_logs (organization_id, user_email, action_type, details)
  values (p_organization_id, coalesce(nullif(p_actor_email, ''), 'system'), p_action_type, coalesce(p_details, '{}'::jsonb));
end $function$;

revoke all on function public.service_record_audit(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.service_record_audit(uuid, text, text, jsonb) to service_role;
