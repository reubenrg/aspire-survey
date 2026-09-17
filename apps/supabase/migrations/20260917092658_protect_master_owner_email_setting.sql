-- MEDIUM fix: platform_settings write access is "any global owner", which is
-- correct for every key except master_owner_email itself - that key is what
-- is_master_owner() reads to decide who is immune to demotion/deactivation
-- (update_team_member/set_team_member_active both special-case it). Without
-- this trigger, any global owner could rewrite master_owner_email to their
-- own address and make themselves permanently unremovable by every other
-- owner, defeating the peer-governance model those two functions otherwise
-- enforce carefully. Only the CURRENT master owner may hand the designation
-- to someone else; nobody else may touch this one key, even though they can
-- freely write every other platform_settings row.
CREATE OR REPLACE FUNCTION public.protect_master_owner_setting()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.key = 'master_owner_email' then
    if not public.is_master_owner(coalesce(auth.jwt() ->> 'email', '')) then
      raise exception 'Only the current master owner can transfer that designation.';
    end if;
  end if;
  return NEW;
end $function$;

drop trigger if exists protect_master_owner_setting_trg on public.platform_settings;
create trigger protect_master_owner_setting_trg
  before insert or update on public.platform_settings
  for each row execute function public.protect_master_owner_setting();
