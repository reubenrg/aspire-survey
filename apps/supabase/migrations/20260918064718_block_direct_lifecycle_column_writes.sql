-- Part of Phase A state-machine enforcement. "Editors update campaigns" and
-- "Editors update invitations" RLS admit a broad editor-level UPDATE on
-- survey_campaigns/survey_invitations with no restriction on which columns
-- change - every campaign/invitation status transition is meant to happen
-- only through mark_campaign_tested()/schedule_campaign_send()/
-- cancel_campaign()/mark_campaign_completed()/the send-campaign Edge
-- Function (survey_campaigns) and resolve_invitation()/
-- submit_invited_response()/mark_invitation_started()/
-- service_regenerate_invitation() (survey_invitations), but nothing stopped
-- a raw client PATCH from setting these columns directly.
--
-- Proved live before this fix: an editor's raw UPDATE set a brand-new
-- campaign's status straight to 'SENT' with a real sent_at, without a single
-- email being sent, recipient being processed, or audit entry being written
-- - the campaign would show as complete in the Monitor while nothing had
-- actually happened.
--
-- Confirmed before writing this fix that no TypeScript code path in the app
-- ever writes these specific columns directly (grepped for
-- `.from('survey_campaigns').update(...)` / `.from('survey_invitations').update(...)`
-- across the whole client - only updateCampaignComposer() touches
-- survey_campaigns directly, and its patch type is explicitly restricted to
-- content fields, excluding status/sent_at/scheduled_at; survey_invitations
-- is never client-updated at all), so blocking these columns for the
-- `authenticated` role carries no risk of breaking an existing workflow.
--
-- current_user is the correct discriminator, not session_user: PostgREST
-- authenticates a request and then SETs ROLE authenticated for the
-- duration of it, and every one of the legitimate transition functions is
-- SECURITY DEFINER, meaning current_user becomes that function's owner for
-- the duration of ITS internal UPDATE - so this trigger fires and blocks a
-- direct client PATCH, but never fires (as a block) for a write coming from
-- inside one of the already-correct RPCs, or from the Edge Function's
-- service-role connection.
CREATE OR REPLACE FUNCTION public.block_direct_lifecycle_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_user = 'authenticated' then
    raise exception 'This field can only change through the survey/campaign/invitation lifecycle functions, not a direct update.';
  end if;
  return NEW;
end $function$;

drop trigger if exists block_direct_campaign_lifecycle_writes on public.survey_campaigns;
create trigger block_direct_campaign_lifecycle_writes
  before update of status, sent_at, scheduled_at on public.survey_campaigns
  for each row execute function public.block_direct_lifecycle_writes();

drop trigger if exists block_direct_invitation_lifecycle_writes on public.survey_invitations;
create trigger block_direct_invitation_lifecycle_writes
  before update of status, sent_at, opened_at, started_at, completed_at, revoked_at, token_hash on public.survey_invitations
  for each row execute function public.block_direct_lifecycle_writes();
