-- Phase A rate-limit finding: request_test_send() (the function that mints a
-- test-send token, which the send-campaign Edge Function's "test" mode then
-- uses to call Resend) had no limit at all - not on call frequency, not on
-- which email addresses could be targeted. Proved live before this fix: 30
-- rapid calls to 30 arbitrary, non-employee addresses all succeeded. Test
-- sends deliberately bypass the production-domain-verification gate (so a
-- founder can preview a campaign before that's set up), which makes this
-- specifically the one send path that could become an unrestricted relay if
-- ever abused or scripted, exactly the risk this section was asked to guard
-- against.
--
-- Conservative, documented, application-level limit (Resend/Supabase have no
-- built-in per-endpoint limit this function could defer to instead): at most
-- 10 test-send tokens minted per campaign per rolling hour. 10/hour is
-- comfortably above any real "preview this campaign before sending" workflow
-- (a founder previewing a handful of client variants) while making a
-- scripted-abuse loop immediately visible (blocked after the 11th call) and
-- capping worst-case Resend usage from this path to a small, bounded number.
CREATE OR REPLACE FUNCTION public.request_test_send(p_campaign_id uuid, p_recipient_email text)
 RETURNS TABLE(test_send_id uuid, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare org uuid; raw text; new_id uuid; recent_count int;
begin
  select organization_id into org from public.survey_campaigns where id = p_campaign_id;
  if org is null then raise exception 'No such campaign'; end if;
  if not public.has_survey_role(org, 'editor') then
    raise exception 'You need the editor role to send a test email';
  end if;
  if p_recipient_email is null or p_recipient_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid test recipient email address';
  end if;

  select count(*) into recent_count from public.survey_campaign_test_sends
  where campaign_id = p_campaign_id and created_at > now() - interval '1 hour';
  if recent_count >= 10 then
    raise exception 'Too many test emails sent for this campaign in the last hour (limit: 10). Wait a while before sending another.';
  end if;

  raw := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.survey_campaign_test_sends (campaign_id, token_hash, recipient_email, created_by)
  values (p_campaign_id, encode(extensions.digest(raw, 'sha256'), 'hex'), p_recipient_email, auth.jwt() ->> 'email')
  returning id into new_id;

  perform public.record_audit(org, 'CAMPAIGN_TEST_EMAIL_REQUESTED',
    jsonb_build_object('campaign_id', p_campaign_id, 'recipient_email', p_recipient_email));

  test_send_id := new_id;
  token := raw;
  return next;
end $function$;
