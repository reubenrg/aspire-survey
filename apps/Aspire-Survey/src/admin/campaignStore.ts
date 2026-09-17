import { supabase } from '../lib/supabase';
import type { InvitationStatus, PrivacyMode } from './labels';
import type { CampaignEmployee } from './campaignEligibility';
import { recordAudit } from './reportStore';

export type CampaignStatus =
  | 'DRAFT' | 'TESTED' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'PARTIALLY_FAILED' | 'COMPLETED' | 'CANCELLED';
export type DeliveryStatus = 'NOT_SENT' | 'QUEUED' | 'SENT' | 'DELIVERED' | 'BOUNCED' | 'FAILED';

export interface Campaign {
  id: string;
  survey_id: string;
  survey_version: number | null;
  organization_id: string;
  privacy_mode: PrivacyMode;
  status: CampaignStatus;
  sender_name: string;
  sender_email: string;
  reply_to: string | null;
  subject: string;
  preview_text: string | null;
  body_text: string;
  cta_label: string;
  due_date: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipientSummary {
  total: number; not_sent: number; queued: number; sent: number; delivered: number;
  bounced: number; failed: number; opened: number; started: number; completed: number;
}

export interface CampaignRecipientRow {
  recipient_id: string;
  invitation_id: string;
  employee_id: string;
  employee_name: string;
  email: string | null;
  delivery_status: DeliveryStatus;
  invitation_status: InvitationStatus;
  last_error: string | null;
}

const CAMPAIGN_COLUMNS = 'id, survey_id, survey_version, organization_id, privacy_mode, status, sender_name, sender_email, reply_to, subject, preview_text, body_text, cta_label, due_date, scheduled_at, sent_at, created_by, created_at, updated_at';

function fail(error: { code?: string; message: string }, action: string): never {
  if (error.code === '42501') throw new Error(`You do not have permission to ${action}.`);
  throw new Error(error.message || `Could not ${action}.`);
}

/** The survey's full invitation list, with email attached - the one thing fetchAudience() (Audience page) doesn't need and so doesn't select. */
export async function fetchDistributionAudience(surveyId: string): Promise<CampaignEmployee[]> {
  const { data, error } = await supabase
    .from('survey_invitations')
    .select('status, employee:employees(id, email)')
    .eq('survey_id', surveyId)
    .is('revoked_at', null);
  if (error) fail(error, 'load this survey\'s audience');

  type Row = { status: InvitationStatus; employee: { id: string; email: string | null } | null };
  return ((data ?? []) as unknown as Row[])
    .filter(r => r.employee !== null)
    .map(r => ({ id: r.employee!.id, email: r.employee!.email, invitationStatus: r.status }));
}

/** The most recent campaign for a survey, or null if none exists yet. A survey may have several over time (one per launch); Distribution v1 always works with the latest. */
export async function fetchLatestCampaign(surveyId: string): Promise<Campaign | null> {
  const { data, error } = await supabase
    .from('survey_campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('survey_id', surveyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail(error, 'load this survey\'s campaign');
  return data as Campaign | null;
}

export async function createCampaign(input: {
  surveyId: string; surveyVersion: number | null; organizationId: string; privacyMode: PrivacyMode;
}): Promise<Campaign> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('survey_campaigns')
    .insert({
      survey_id: input.surveyId,
      survey_version: input.surveyVersion,
      organization_id: input.organizationId,
      privacy_mode: input.privacyMode,
      created_by: user?.email ?? null,
    })
    .select(CAMPAIGN_COLUMNS)
    .single();
  if (error) fail(error, 'create a campaign for this survey');
  await recordAudit(input.organizationId, 'CAMPAIGN_CREATED', { campaign_id: (data as Campaign).id, survey_id: input.surveyId });
  return data as Campaign;
}

export type ComposerPatch = Partial<Pick<Campaign,
  'sender_name' | 'reply_to' | 'subject' | 'preview_text' | 'body_text' | 'cta_label' | 'due_date'>>;

export async function updateCampaignComposer(campaignId: string, organizationId: string, patch: ComposerPatch): Promise<void> {
  const { error } = await supabase
    .from('survey_campaigns')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', campaignId);
  if (error) fail(error, 'update this campaign');
  await recordAudit(organizationId, 'CAMPAIGN_EDITED', { campaign_id: campaignId });
}

/** Ensures every employee currently in the audience has a campaign_recipients row, adding any new ones since the campaign was created. */
export async function syncCampaignRecipients(campaignId: string, employeeIds: string[]): Promise<number> {
  if (employeeIds.length === 0) return 0;
  const { data, error } = await supabase.rpc('build_campaign_recipients', {
    p_campaign_id: campaignId, p_employee_ids: employeeIds,
  });
  if (error) fail(error, 'build this campaign\'s recipient list');
  return Number(data ?? 0);
}

export async function fetchRecipientSummary(campaignId: string): Promise<RecipientSummary> {
  const { data, error } = await supabase.rpc('campaign_recipient_summary', { p_campaign_id: campaignId });
  if (error) fail(error, 'load this campaign\'s delivery summary');
  const r = data as (RecipientSummary & { error?: string }) | null;
  if (!r || r.error) throw new Error('You do not have permission to view this campaign.');
  return r;
}

export async function fetchCampaignRecipients(campaignId: string): Promise<CampaignRecipientRow[]> {
  const { data, error } = await supabase
    .from('survey_campaign_recipients')
    .select(
      'id, delivery_status, last_error, ' +
      'invitation:survey_invitations(id, status, employee:employees(id, employee_name, email))',
    )
    .eq('campaign_id', campaignId);
  if (error) fail(error, 'view this campaign\'s recipients');

  type Row = {
    id: string; delivery_status: DeliveryStatus; last_error: string | null;
    invitation: {
      id: string; status: InvitationStatus;
      employee: { id: string; employee_name: string; email: string | null } | null;
    } | null;
  };
  return ((data ?? []) as unknown as Row[])
    .filter(r => r.invitation?.employee)
    .map(r => ({
      recipient_id: r.id,
      invitation_id: r.invitation!.id,
      employee_id: r.invitation!.employee!.id,
      employee_name: r.invitation!.employee!.employee_name,
      email: r.invitation!.employee!.email,
      delivery_status: r.delivery_status,
      invitation_status: r.invitation!.status,
      last_error: r.last_error,
    }));
}

export interface TestSendResult {
  ok: boolean;
  error?: string;
}

/**
 * Requests a synthetic test token, then asks the send Edge Function to
 * deliver one email to it. The test never touches a real employee's
 * invitation and never creates a survey response - see resolve_test_send/
 * submit_test_response and the TestInvitePage that renders /t/:token.
 */
export async function sendTestEmail(campaignId: string, recipientEmail: string): Promise<TestSendResult> {
  const { data, error } = await supabase.rpc('request_test_send', {
    p_campaign_id: campaignId, p_recipient_email: recipientEmail,
  });
  if (error) fail(error, 'request a test email');
  const row = ((data ?? []) as { test_send_id: string; token: string }[])[0];
  if (!row) throw new Error('No test send was created.');

  const testUrl = `${window.location.origin}/t/${row.token}`;
  const { data: result, error: fnError } = await supabase.functions.invoke('send-campaign', {
    body: { mode: 'test', campaignId, testSendId: row.test_send_id, testUrl, recipientEmail },
  });
  if (fnError) return { ok: false, error: fnError.message };
  return result as TestSendResult;
}

export async function markCampaignTested(campaignId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_campaign_tested', { p_campaign_id: campaignId });
  if (error) fail(error, 'mark this campaign as tested');
}

export interface SendResult {
  ok: boolean;
  sent?: number;
  failed?: number;
  error?: string;
}

/** Gated server-side by production_email_domain_verified - see the send-campaign Edge Function. Expected to return ok:false with a clear message until a founder verifies a custom domain. */
export async function sendCampaignNow(campaignId: string): Promise<SendResult> {
  const { data, error } = await supabase.functions.invoke('send-campaign', {
    body: { mode: 'send', campaignId },
  });
  if (error) return { ok: false, error: error.message };
  return data as SendResult;
}

export async function sendReminders(campaignId: string): Promise<SendResult> {
  const { data, error } = await supabase.functions.invoke('send-campaign', {
    body: { mode: 'remind', campaignId },
  });
  if (error) return { ok: false, error: error.message };
  return data as SendResult;
}

export async function scheduleCampaignSend(campaignId: string, scheduledAt: string): Promise<void> {
  const { error } = await supabase.rpc('schedule_campaign_send', {
    p_campaign_id: campaignId, p_scheduled_at: scheduledAt,
  });
  if (error) fail(error, 'schedule this campaign');
}

export async function cancelCampaign(campaignId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_campaign', { p_campaign_id: campaignId });
  if (error) fail(error, 'cancel this campaign');
}

export async function markCampaignCompleted(campaignId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_campaign_completed', { p_campaign_id: campaignId });
  if (error) fail(error, 'mark this campaign as completed');
}

/** Whether real bulk employee sending is currently allowed - see platform_settings.production_email_domain_verified, defaulting to false until a founder verifies a custom domain in Resend. */
export async function isProductionEmailDomainVerified(): Promise<boolean> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'production_email_domain_verified')
    .maybeSingle();
  if (error || !data) return false;
  return data.value === true;
}
