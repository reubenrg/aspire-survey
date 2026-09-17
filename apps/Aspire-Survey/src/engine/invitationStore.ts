import { supabase } from '../lib/supabase';
import { buildRow } from './definition';
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

/**
 * Marks an invitation STARTED the moment its respondent leaves the welcome
 * screen. Best-effort: a failure here must never block someone from taking
 * the survey, so callers fire this without awaiting its outcome and this
 * function swallows its own errors rather than surfacing them.
 */
export async function markInvitationStarted(token: string): Promise<void> {
  try {
    await supabase.rpc('mark_invitation_started', { p_token: token });
  } catch {
    // Best-effort signal only - never worth interrupting the respondent for.
  }
}

export type SubmitProblem = InvitationProblem | 'ALREADY_SUBMITTED' | 'EMPTY' | 'NO_TABLE';

/**
 * Flattens answers into the survey's actual response columns before sending,
 * exactly as surveyStore.submitResponse() does for the open /s/:slug path.
 *
 * This is not optional plumbing: submit_invited_response() matches payload
 * keys against real column names, and a matrix question's answers live under
 * its question id as an object of row-label -> value. Sending raw answers
 * therefore matched nothing for matrix questions, and every matrix answer was
 * silently dropped while the submission still reported success.
 */
export async function submitInvitedResponse(
  token: string, definition: SurveyDefinition, answers: Answers,
): Promise<{ ok: true } | { ok: false; reason: SubmitProblem }> {
  const { data, error } = await supabase.rpc('submit_invited_response', {
    p_token: token, p_payload: buildRow(definition, answers),
  });
  if (error) throw new Error(error.message || 'Submission failed. Please try again.');
  const r = data as { ok: boolean; reason?: SubmitProblem };
  if (!r.ok) return { ok: false, reason: (r.reason ?? 'INVALID') as SubmitProblem };
  return { ok: true };
}
