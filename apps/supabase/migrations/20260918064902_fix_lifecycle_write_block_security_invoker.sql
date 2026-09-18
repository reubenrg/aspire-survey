-- Bug in the previous migration: block_direct_lifecycle_writes() was marked
-- SECURITY DEFINER, which means current_user INSIDE its own body resolved to
-- the function's owner, not the role that actually issued the UPDATE - so
-- the check always compared the owner against 'authenticated' and never
-- matched, silently letting every direct write through regardless of role.
-- Caught immediately by re-testing the exact same bypass attempt right after
-- applying the block, rather than assuming the migration worked.
--
-- The function needs SECURITY INVOKER (the default - simply omitting
-- SECURITY DEFINER) so current_user inside it reflects whoever actually
-- performed the write: 'authenticated' for a direct client call, and the
-- owning role of whichever SECURITY DEFINER transition function issued the
-- write when called from inside one of those (current_user changes to the
-- DEFINER function's owner only while that function's own body is
-- executing - once control reaches this trigger from an ordinary client
-- UPDATE, current_user is the client's own role).
CREATE OR REPLACE FUNCTION public.block_direct_lifecycle_writes()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if current_user = 'authenticated' then
    raise exception 'This field can only change through the survey/campaign/invitation lifecycle functions, not a direct update.';
  end if;
  return NEW;
end $function$;
