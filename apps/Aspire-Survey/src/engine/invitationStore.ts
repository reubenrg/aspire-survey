import { supabase } from '../lib/supabase';
import type { Answers, SurveyDefinition } from './types';

export type InvitationProblem = 'INVALID' | 'REVOKED' | 'COMPLETED' | 'EXPIRED' | 'CLOSED' | 'UNAVAILABLE';

export interface ResolvedInvitation {
  slug: string;
  definition: SurveyDefinition;
  privacyMode: 'ANONYMOUS' | 'ANONYMOUS_TRACKED' | 'CONFIDENTIAL';
  version: number;
}

/**
 * Resolves an employee-invitation token. Deliberately returns only what the
 * respondent needs to take the survey - never their own name, code or any
 * other identity - because the database function itself never sends that
 * back for a token lookup.
 */
export async function resolveInvitation(token: string): Promise<
  { ok: true; invitation: ResolvedInvitation } | { ok: false; reason: InvitationProblem }
> {
  const { data, error } = await supabase.rpc('resolve_invitation', { p_token: token });
  if (error) throw new Error(error.message || 'Could not open this invitation.');
  const r = data as { valid: boolean; reason?: InvitationProblem } & Record<string, unknown>;
  if (!r.valid) return { ok: false, reason: (r.reason ?? 'INVALID') as InvitationProblem };
  return {
    ok: true,
    invitation: {
      slug: r.slug as string,
      definition: r.definition as SurveyDefinition,
      privacyMode: r.privacy_mode as ResolvedInvitation['privacyMode'],
      version: r.version as number,
    },
  };
}

export type SubmitProblem = InvitationProblem | 'ALREADY_SUBMITTED' | 'EMPTY' | 'NO_TABLE';

export async function submitInvitedResponse(
  token: string, answers: Answers,
): Promise<{ ok: true } | { ok: false; reason: SubmitProblem }> {
  const { data, error } = await supabase.rpc('submit_invited_response', {
    p_token: token, p_payload: answers,
  });
  if (error) throw new Error(error.message || 'Submission failed. Please try again.');
  const r = data as { ok: boolean; reason?: SubmitProblem };
  if (!r.ok) return { ok: false, reason: (r.reason ?? 'INVALID') as SubmitProblem };
  return { ok: true };
}
