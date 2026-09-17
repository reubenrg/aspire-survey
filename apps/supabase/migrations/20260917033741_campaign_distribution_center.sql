-- ============================================================================
-- Aspire Surveys — Campaign / Distribution Center schema
--
-- Builds a distribution layer strictly ON TOP of the existing invitation
-- model (survey_invitations). A campaign never stores or re-derives a raw
-- invitation token: survey_campaign_recipients references an existing
-- survey_invitations row by id only. Test sends use a wholly separate table
-- (survey_campaign_test_sends) with no foreign key to employees or to
-- survey_invitations, so a test send can never touch a real employee's
-- invitation state or a survey's real response table.
-- ============================================================================

do $$ begin
  create type public.campaign_status as enum
    ('DRAFT','TESTED','SCHEDULED','SENDING','SENT','PARTIALLY_FAILED','COMPLETED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.delivery_status as enum
    ('NOT_SENT','QUEUED','SENT','DELIVERED','BOUNCED','FAILED');
exception when duplicate_object then null; end $$;

-- ── Tables ───────────────────────────────────────────────────────────────

create table if not exists public.survey_campaigns (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id),
  survey_version int,
  organization_id uuid not null references public.organizations(id),
  privacy_mode public.survey_privacy_mode not null,
  status public.campaign_status not null default 'DRAFT',
  sender_name text not null default 'Aspire Surveys',
  sender_email text not null default 'onboarding@resend.dev',
  reply_to text,
  subject text not null default 'Your feedback is requested — {{survey_title}}',
  preview_text text,
  body_text text not null default '',
  cta_label text not null default 'Start survey',
  due_date date,
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists survey_campaigns_survey_idx on public.survey_campaigns(survey_id);

create table if not exists public.survey_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.survey_campaigns(id) on delete cascade,
  invitation_id uuid not null references public.survey_invitations(id),
  delivery_status public.delivery_status not null default 'NOT_SENT',
  last_error text,
  queued_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, invitation_id)
);
create index if not exists survey_campaign_recipients_campaign_idx on public.survey_campaign_recipients(campaign_id, delivery_status);
create index if not exists survey_campaign_recipients_invitation_idx on public.survey_campaign_recipients(invitation_id);

create table if not exists public.survey_email_events (
  id uuid primary key default gen_random_uuid(),
  campaign_recipient_id uuid not null references public.survey_campaign_recipients(id) on delete cascade,
  event_type public.delivery_status not null,
  detail text,
  occurred_at timestamptz not null default now()
);
create index if not exists survey_email_events_recipient_idx on public.survey_email_events(campaign_recipient_id, occurred_at);

create table if not exists public.survey_campaign_test_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.survey_campaigns(id) on delete cascade,
  token_hash text not null unique,
  recipient_email text not null,
  status text not null default 'QUEUED' check (status in ('QUEUED','SENT','FAILED')),
  error text,
  sent_at timestamptz,
  opened_at timestamptz,
  completed_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists survey_campaign_test_sends_campaign_idx on public.survey_campaign_test_sends(campaign_id);

-- ── Platform-wide send gate ──────────────────────────────────────────────
insert into public.platform_settings (key, value, updated_by)
values ('production_email_domain_verified', 'false'::jsonb, 'system')
on conflict (key) do nothing;

-- ── RLS ──────────────────────────────────────────────────────────────────

alter table public.survey_campaigns enable row level security;
alter table public.survey_campaign_recipients enable row level security;
alter table public.survey_email_events enable row level security;
alter table public.survey_campaign_test_sends enable row level security;

create policy "Staff read campaigns" on public.survey_campaigns for select to authenticated
  using (has_survey_role(organization_id, 'viewer'));
create policy "Editors write campaigns" on public.survey_campaigns for insert to authenticated
  with check (has_survey_role(organization_id, 'editor'));
create policy "Editors update campaigns" on public.survey_campaigns for update to authenticated
  using (has_survey_role(organization_id, 'editor')) with check (has_survey_role(organization_id, 'editor'));

create policy "Staff read campaign recipients" on public.survey_campaign_recipients for select to authenticated
  using (has_survey_role(
    (select c.organization_id from public.survey_campaigns c where c.id = survey_campaign_recipients.campaign_id),
    'viewer'));

create policy "Staff read email events" on public.survey_email_events for select to authenticated
  using (has_survey_role(
    (select c.organization_id from public.survey_campaigns c
       join public.survey_campaign_recipients r on r.campaign_id = c.id
     where r.id = survey_email_events.campaign_recipient_id),
    'viewer'));

create policy "Staff read test sends" on public.survey_campaign_test_sends for select to authenticated
  using (has_survey_role(
    (select c.organization_id from public.survey_campaigns c where c.id = survey_campaign_test_sends.campaign_id),
    'viewer'));

-- ── Grants ───────────────────────────────────────────────────────────────

revoke all on public.survey_campaigns, public.survey_campaign_recipients,
  public.survey_email_events, public.survey_campaign_test_sends
  from public, anon, authenticated;

grant select, insert, update on public.survey_campaigns to authenticated;
grant select on public.survey_campaign_recipients to authenticated;
grant select on public.survey_email_events to authenticated;
grant select on public.survey_campaign_test_sends to authenticated;

-- ── Functions ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_invitation_started(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv record; s record; stamp timestamptz;
begin
  if p_token is null or length(p_token) < 32 then
    return jsonb_build_object('ok', false);
  end if;
  select * into inv from public.survey_invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if inv.id is null or inv.revoked_at is not null or inv.status = 'COMPLETED' then
    return jsonb_build_object('ok', false);
  end if;

  select * into s from public.surveys where id = inv.survey_id;
  stamp := public.invitation_stamp(s.privacy_mode);
  update public.survey_invitations
  set status = case when status in ('NOT_SENT','SENT','OPENED') then 'STARTED' else status end,
      started_at = coalesce(started_at, stamp)
  where id = inv.id;

  return jsonb_build_object('ok', true);
end $function$;

revoke all on function public.mark_invitation_started(text) from public;
grant execute on function public.mark_invitation_started(text) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.build_campaign_recipients(p_campaign_id uuid, p_employee_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare camp record; n int;
begin
  select * into camp from public.survey_campaigns where id = p_campaign_id;
  if camp.id is null then raise exception 'No such campaign'; end if;
  if not public.has_survey_role(camp.organization_id, 'editor') then
    raise exception 'You need the editor role to build this campaign''s recipient list';
  end if;

  perform public.issue_invitations(camp.survey_id, p_employee_ids);

  insert into public.survey_campaign_recipients (campaign_id, invitation_id)
  select p_campaign_id, i.id
  from public.survey_invitations i
  where i.survey_id = camp.survey_id and i.employee_id = any(p_employee_ids)
  on conflict (campaign_id, invitation_id) do nothing;
  get diagnostics n = row_count;

  perform public.record_audit(camp.organization_id, 'CAMPAIGN_RECIPIENTS_BUILT',
    jsonb_build_object('campaign_id', p_campaign_id, 'recipients_added', n));
  return n;
end $function$;

revoke all on function public.build_campaign_recipients(uuid, uuid[]) from public;
grant execute on function public.build_campaign_recipients(uuid, uuid[]) to authenticated;

CREATE OR REPLACE FUNCTION public.campaign_recipient_summary(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare org uuid; result jsonb;
begin
  select organization_id into org from public.survey_campaigns where id = p_campaign_id;
  if org is null then return jsonb_build_object('error', 'not_found'); end if;
  if not public.has_survey_role(org, 'viewer') then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  select jsonb_build_object(
    'total', count(*),
    'not_sent', count(*) filter (where rec.delivery_status = 'NOT_SENT'),
    'queued', count(*) filter (where rec.delivery_status = 'QUEUED'),
    'sent', count(*) filter (where rec.delivery_status = 'SENT'),
    'delivered', count(*) filter (where rec.delivery_status = 'DELIVERED'),
    'bounced', count(*) filter (where rec.delivery_status = 'BOUNCED'),
    'failed', count(*) filter (where rec.delivery_status = 'FAILED'),
    'opened', count(*) filter (where i.status in ('OPENED','STARTED','COMPLETED')),
    'started', count(*) filter (where i.status in ('STARTED','COMPLETED')),
    'completed', count(*) filter (where i.status = 'COMPLETED')
  ) into result
  from public.survey_campaign_recipients rec
  join public.survey_invitations i on i.id = rec.invitation_id
  where rec.campaign_id = p_campaign_id;

  return result;
end $function$;

revoke all on function public.campaign_recipient_summary(uuid) from public;
grant execute on function public.campaign_recipient_summary(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.request_test_send(p_campaign_id uuid, p_recipient_email text)
 RETURNS TABLE(test_send_id uuid, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare org uuid; raw text; new_id uuid;
begin
  select organization_id into org from public.survey_campaigns where id = p_campaign_id;
  if org is null then raise exception 'No such campaign'; end if;
  if not public.has_survey_role(org, 'editor') then
    raise exception 'You need the editor role to send a test email';
  end if;
  if p_recipient_email is null or p_recipient_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid test recipient email address';
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

revoke all on function public.request_test_send(uuid, text) from public;
grant execute on function public.request_test_send(uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.resolve_test_send(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t record; s record; c record;
begin
  if p_token is null or length(p_token) < 32 then
    return jsonb_build_object('valid', false, 'reason', 'INVALID');
  end if;
  select * into t from public.survey_campaign_test_sends
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if t.id is null then return jsonb_build_object('valid', false, 'reason', 'INVALID'); end if;
  if t.completed_at is not null then return jsonb_build_object('valid', false, 'reason', 'COMPLETED'); end if;

  select * into c from public.survey_campaigns where id = t.campaign_id;
  select * into s from public.surveys where id = c.survey_id;
  if s.id is null then return jsonb_build_object('valid', false, 'reason', 'UNAVAILABLE'); end if;

  update public.survey_campaign_test_sends set opened_at = coalesce(opened_at, now()) where id = t.id;

  return jsonb_build_object('valid', true, 'slug', s.slug, 'definition', s.definition,
    'privacy_mode', s.privacy_mode, 'version', s.current_version, 'is_test', true);
end $function$;

revoke all on function public.resolve_test_send(text) from public;
grant execute on function public.resolve_test_send(text) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_test_response(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t record;
begin
  select * into t from public.survey_campaign_test_sends
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'INVALID'); end if;
  if t.completed_at is not null then return jsonb_build_object('ok', false, 'reason', 'ALREADY_SUBMITTED'); end if;

  update public.survey_campaign_test_sends set completed_at = now() where id = t.id;
  return jsonb_build_object('ok', true);
end $function$;

revoke all on function public.submit_test_response(text) from public;
grant execute on function public.submit_test_response(text) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.service_regenerate_invitation(p_invitation_id uuid)
 RETURNS TABLE(employee_id uuid, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare inv record; raw text;
begin
  select * into inv from public.survey_invitations where id = p_invitation_id;
  if inv.id is null then raise exception 'No such invitation'; end if;
  if inv.revoked_at is not null then
    raise exception 'This invitation has been revoked and cannot be sent to';
  end if;
  if inv.status = 'COMPLETED' then
    raise exception 'This invitation has already been completed and cannot be regenerated';
  end if;

  raw := encode(extensions.gen_random_bytes(32), 'hex');
  update public.survey_invitations
  set token_hash = encode(extensions.digest(raw, 'sha256'), 'hex')
  where id = p_invitation_id;

  employee_id := inv.employee_id;
  token := raw;
  return next;
end $function$;

revoke all on function public.service_regenerate_invitation(uuid) from public, anon, authenticated;
grant execute on function public.service_regenerate_invitation(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.mark_campaign_tested(p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare org uuid;
begin
  select organization_id into org from public.survey_campaigns where id = p_campaign_id;
  if org is null then raise exception 'No such campaign'; end if;
  if not public.has_survey_role(org, 'editor') then
    raise exception 'You need the editor role to update this campaign';
  end if;
  update public.survey_campaigns set status = 'TESTED', updated_at = now()
  where id = p_campaign_id and status = 'DRAFT';
end $function$;

revoke all on function public.mark_campaign_tested(uuid) from public;
grant execute on function public.mark_campaign_tested(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.schedule_campaign_send(p_campaign_id uuid, p_scheduled_at timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare org uuid; st public.campaign_status;
begin
  select organization_id, status into org, st from public.survey_campaigns where id = p_campaign_id;
  if org is null then raise exception 'No such campaign'; end if;
  if not public.has_survey_role(org, 'editor') then
    raise exception 'You need the editor role to schedule this campaign';
  end if;
  if st not in ('DRAFT', 'TESTED', 'SCHEDULED') then
    raise exception 'This campaign cannot be scheduled from its current status (%)', st;
  end if;
  update public.survey_campaigns
  set status = 'SCHEDULED', scheduled_at = p_scheduled_at, updated_at = now()
  where id = p_campaign_id;
  perform public.record_audit(org, 'CAMPAIGN_SCHEDULED',
    jsonb_build_object('campaign_id', p_campaign_id, 'scheduled_at', p_scheduled_at));
end $function$;

revoke all on function public.schedule_campaign_send(uuid, timestamptz) from public;
grant execute on function public.schedule_campaign_send(uuid, timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.cancel_campaign(p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare org uuid; st public.campaign_status;
begin
  select organization_id, status into org, st from public.survey_campaigns where id = p_campaign_id;
  if org is null then raise exception 'No such campaign'; end if;
  if not public.has_survey_role(org, 'editor') then
    raise exception 'You need the editor role to cancel this campaign';
  end if;
  if st in ('SENDING', 'SENT', 'COMPLETED', 'CANCELLED') then
    raise exception 'This campaign cannot be cancelled from its current status (%)', st;
  end if;
  update public.survey_campaigns set status = 'CANCELLED', updated_at = now() where id = p_campaign_id;
  perform public.record_audit(org, 'CAMPAIGN_CANCELLED', jsonb_build_object('campaign_id', p_campaign_id));
end $function$;

revoke all on function public.cancel_campaign(uuid) from public;
grant execute on function public.cancel_campaign(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.mark_campaign_completed(p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare org uuid; st public.campaign_status;
begin
  select organization_id, status into org, st from public.survey_campaigns where id = p_campaign_id;
  if org is null then raise exception 'No such campaign'; end if;
  if not public.has_survey_role(org, 'editor') then
    raise exception 'You need the editor role to update this campaign';
  end if;
  if st not in ('SENT', 'PARTIALLY_FAILED') then
    raise exception 'This campaign cannot be marked completed from its current status (%)', st;
  end if;
  update public.survey_campaigns set status = 'COMPLETED', updated_at = now() where id = p_campaign_id;
  perform public.record_audit(org, 'CAMPAIGN_COMPLETED', jsonb_build_object('campaign_id', p_campaign_id));
end $function$;

revoke all on function public.mark_campaign_completed(uuid) from public;
grant execute on function public.mark_campaign_completed(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.campaign_reminder_candidates(p_campaign_id uuid)
 RETURNS TABLE(recipient_id uuid, invitation_id uuid, employee_id uuid, employee_name text, email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select rec.id, i.id, e.id, e.employee_name, e.email
  from public.survey_campaign_recipients rec
  join public.survey_invitations i on i.id = rec.invitation_id
  join public.employees e on e.id = i.employee_id
  join public.survey_campaigns c on c.id = rec.campaign_id
  where rec.campaign_id = p_campaign_id
    and public.has_survey_role(c.organization_id, 'viewer')
    and i.status in ('SENT', 'OPENED', 'STARTED')
    and i.revoked_at is null
    and e.email is not null and e.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
$function$;

revoke all on function public.campaign_reminder_candidates(uuid) from public;
grant execute on function public.campaign_reminder_candidates(uuid) to authenticated;
