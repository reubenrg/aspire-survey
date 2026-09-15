import { supabase } from '../lib/supabase';
import type { InvitationStatus } from './labels';

export interface AudienceCounts {
  audience: number;
  not_sent: number;
  sent: number;
  opened: number;
  started: number;
  completed: number;
  expired: number;
  revoked: number;
}

export interface AudienceRow {
  invitation_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department: string | null;
  location: string | null;
  is_active: boolean;
  status: InvitationStatus;
  sent_at: string | null;
  opened_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

function fail(error: { code?: string; message: string }, action: string): never {
  if (error.code === '42501') throw new Error(`You do not have permission to ${action}.`);
  throw new Error(error.message || `Could not ${action}.`);
}

export async function fetchAudienceSummary(surveyId: string): Promise<AudienceCounts> {
  const { data, error } = await supabase.rpc('audience_summary', { p_survey_id: surveyId });
  if (error) fail(error, 'load the audience summary');
  const r = data as (AudienceCounts & { error?: string }) | null;
  if (!r || r.error === 'not_authorised') throw new Error('You do not have permission to view this audience.');
  if (r.error === 'not_found') throw new Error('This survey could not be found.');
  return r;
}

/**
 * The participant table. Reads survey_invitations joined to employees through
 * the foreign key PostgREST already knows about - row level security applies
 * per row exactly as it would to two separate queries, and token_hash is
 * never in the select list, so it never reaches the browser here.
 */
export async function fetchAudience(surveyId: string): Promise<AudienceRow[]> {
  const { data, error } = await supabase
    .from('survey_invitations')
    .select(
      'id, status, sent_at, opened_at, started_at, completed_at, expires_at, revoked_at,' +
      'employee:employees(id, employee_code, employee_name, department, location, is_active)',
    )
    .eq('survey_id', surveyId)
    .order('created_at');
  if (error) fail(error, 'view the audience');

  type Row = {
    id: string; status: InvitationStatus;
    sent_at: string | null; opened_at: string | null; started_at: string | null;
    completed_at: string | null; expires_at: string | null; revoked_at: string | null;
    employee: {
      id: string; employee_code: string; employee_name: string;
      department: string | null; location: string | null; is_active: boolean;
    } | null;
  };

  return ((data ?? []) as unknown as Row[])
    .filter(r => r.employee !== null)
    .map(r => ({
      invitation_id: r.id,
      employee_id: r.employee!.id,
      employee_code: r.employee!.employee_code,
      employee_name: r.employee!.employee_name,
      department: r.employee!.department,
      location: r.employee!.location,
      is_active: r.employee!.is_active,
      status: r.status,
      sent_at: r.sent_at,
      opened_at: r.opened_at,
      started_at: r.started_at,
      completed_at: r.completed_at,
      expires_at: r.expires_at,
      revoked_at: r.revoked_at,
    }));
}

/**
 * Adds employees to a survey's audience. Existing invitations are left alone
 * (issue_invitations skips anyone already invited), so building an audience
 * twice, or adding a few more people later, is always safe. Raw tokens are
 * discarded here on purpose: building an audience is not the same act as
 * sharing a link, and a token nobody has looked at yet should not exist
 * outside the database.
 */
export async function buildAudience(surveyId: string, employeeIds: string[]): Promise<number> {
  if (employeeIds.length === 0) return 0;
  const { data, error } = await supabase.rpc('issue_invitations', {
    p_survey_id: surveyId,
    p_employee_ids: employeeIds,
  });
  if (error) fail(error, 'add employees to this audience');
  return ((data ?? []) as unknown[]).length;
}

export async function revokeInvitations(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.rpc('revoke_invitations', { p_invitation_ids: ids });
  if (error) fail(error, 'revoke these invitations');
  return Number(data ?? 0);
}

export async function markInvitationsSent(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.rpc('mark_invitations_sent', { p_invitation_ids: ids });
  if (error) fail(error, 'mark these as sent');
  return Number(data ?? 0);
}

export interface GeneratedLink {
  employeeId: string;
  token: string;
}

/**
 * Generate (or regenerate) one invitation's link. The raw token is returned
 * exactly once by the database and never stored anywhere - this call is the
 * only moment it exists outside the respondent's own browser.
 */
export async function regenerateInvitation(invitationId: string): Promise<GeneratedLink> {
  const { data, error } = await supabase.rpc('regenerate_invitation', { p_invitation_id: invitationId });
  if (error) fail(error, 'generate a link for this invitation');
  const row = ((data ?? []) as { employee_id: string; token: string }[])[0];
  if (!row) throw new Error('No link was generated.');
  return { employeeId: row.employee_id, token: row.token };
}

export function inviteUrl(token: string): string {
  return `${window.location.origin}/r/${token}`;
}
