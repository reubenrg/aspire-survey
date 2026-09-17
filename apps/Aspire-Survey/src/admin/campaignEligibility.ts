/**
 * Pure recipient-eligibility logic for the Campaign/Distribution Center.
 * Kept separate from campaignStore.ts (which needs Supabase) so the actual
 * filtering rules - what counts as a valid email, who's "new" vs "already
 * invited", who a reminder may target - can be unit tested directly.
 */

export type InvitationStatusLike =
  | 'NOT_SENT' | 'SENT' | 'OPENED' | 'STARTED' | 'COMPLETED' | 'EXPIRED' | 'REVOKED';

export interface CampaignEmployee {
  id: string;
  email: string | null;
  invitationStatus: InvitationStatusLike;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmail(email: string | null | undefined): boolean {
  return !!email && EMAIL_RE.test(email);
}

export interface EligibilityResult<T> {
  valid: T[];
  missingEmail: T[];
  invalidEmail: T[];
  alreadyInvited: T[];
  newRecipients: T[];
}

/**
 * Splits a survey's audience into the buckets the Distribution page's
 * summary card shows. An employee lands in exactly one of valid /
 * missingEmail / invalidEmail; within `valid`, alreadyInvited and
 * newRecipients also partition it completely (NOT_SENT = new, anything else
 * = already invited through some prior send).
 */
export function eligibleRecipients<T extends CampaignEmployee>(employees: T[]): EligibilityResult<T> {
  const valid: T[] = [];
  const missingEmail: T[] = [];
  const invalidEmail: T[] = [];
  const alreadyInvited: T[] = [];
  const newRecipients: T[] = [];

  for (const e of employees) {
    if (e.email === null || e.email.trim() === '') { missingEmail.push(e); continue; }
    if (!isValidEmail(e.email)) { invalidEmail.push(e); continue; }
    valid.push(e);
    if (e.invitationStatus === 'NOT_SENT') newRecipients.push(e); else alreadyInvited.push(e);
  }

  return { valid, missingEmail, invalidEmail, alreadyInvited, newRecipients };
}

/**
 * Matches labels.ts's REMINDABLE_STATUSES exactly (SENT/OPENED/STARTED - a
 * reminder implies a link already went out; NOT_SENT would be a first send,
 * not a reminder), plus a resolvable email, since reminding an address that
 * can't be delivered to would just fail silently.
 */
const REMINDABLE_STATUSES: InvitationStatusLike[] = ['SENT', 'OPENED', 'STARTED'];

export function isRemindable(e: CampaignEmployee): boolean {
  return isValidEmail(e.email) && REMINDABLE_STATUSES.includes(e.invitationStatus);
}
