-- Service-role-safe audit logging: record_audit() attributes to auth.jwt(),
-- which is empty under the send-campaign Edge Function's service-role
-- connection, so campaign started/sent/failed/reminder events would
-- otherwise never reach audit_logs. This variant takes the actor's email as
-- an explicit argument instead - the Edge Function has already read it from
-- the caller's own JWT via userClient.auth.getUser() before ever reaching
-- privileged work, so the attribution is still the real acting admin, not
-- the service role itself.
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
