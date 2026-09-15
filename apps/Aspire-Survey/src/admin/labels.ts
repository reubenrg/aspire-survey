/**
 * Human-readable labels for the enums the database speaks in. Kept as pure
 * functions with no Supabase import, so they can be unit tested directly and
 * reused by every screen that needs to show the same word for the same value.
 */

export type PrivacyMode = 'ANONYMOUS' | 'ANONYMOUS_TRACKED' | 'CONFIDENTIAL';
export type SurveyStatus = 'DRAFT' | 'LIVE' | 'CLOSED' | 'ARCHIVED';
export type InvitationStatus =
  | 'NOT_SENT' | 'SENT' | 'OPENED' | 'STARTED' | 'COMPLETED' | 'EXPIRED' | 'REVOKED';

export type Role = 'viewer' | 'analyst' | 'editor' | 'owner';

/** Ranking mirrors survey_role_rank() in the database. Keep the two in step. */
const ROLE_RANK: Record<Role, number> = { viewer: 1, analyst: 2, editor: 3, owner: 4 };

export function atLeast(role: Role | null, minimum: Role): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export const PRIVACY_MODE_LABEL: Record<PrivacyMode, string> = {
  ANONYMOUS: 'Anonymous',
  ANONYMOUS_TRACKED: 'Anonymous — Participation Tracked',
  CONFIDENTIAL: 'Confidential',
};

/** One sentence, safe to put directly under the mode's name anywhere in the UI. */
export const PRIVACY_MODE_DESCRIPTION: Record<PrivacyMode, string> = {
  ANONYMOUS:
    'No employee participation tracking and no employee identity stored with responses. Best for open or public surveys.',
  ANONYMOUS_TRACKED:
    'Each employee receives an individual secure link. Aspire can track invited, opened, started and completed — but employee identity is not linked to their answers.',
  CONFIDENTIAL:
    'Employees receive individual secure links and their responses are associated with their employee identity. Identity access is restricted by permissions.',
};

/**
 * What the Audience page reminds the admin of, per mode. Exists to prevent a
 * real misunderstanding: an admin seeing "Alice — Completed" in a tracked
 * survey must not conclude they can see what Alice answered.
 */
export const PRIVACY_MODE_REMINDER: Record<PrivacyMode, string> = {
  ANONYMOUS: 'No employee participation tracking is enabled.',
  ANONYMOUS_TRACKED:
    'You can see whether employees participated, but you cannot connect an employee to their answers.',
  CONFIDENTIAL: 'Authorised users may access identified responses.',
};

export const SURVEY_STATUS_LABEL: Record<SurveyStatus, string> = {
  DRAFT: 'Draft',
  LIVE: 'Live',
  CLOSED: 'Closed',
  ARCHIVED: 'Archived',
};

export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  NOT_SENT: 'Not Sent',
  SENT: 'Sent',
  OPENED: 'Opened',
  STARTED: 'Started',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
};

/**
 * Employee-link surveys should be shared as /r/:token, not the generic
 * /s/:slug page: the generic link carries no invitation, so it can never be
 * tracked or, for Confidential, linked back to anyone. Anonymous surveys have
 * no tracking to lose, so they are exactly what /s/:slug is for.
 */
export function usesInvitationLinks(mode: PrivacyMode): boolean {
  return mode === 'ANONYMOUS_TRACKED' || mode === 'CONFIDENTIAL';
}

export function genericLinkWarning(mode: PrivacyMode): string | null {
  if (!usesInvitationLinks(mode)) return null;
  return 'This survey uses individual employee links. Sharing the generic survey URL will not provide employee participation tracking.';
}

/**
 * Statuses a "remind incomplete participants" action should target: a link
 * went out but nothing came back yet. Completed and revoked are excluded on
 * principle (nothing to chase); expired is excluded by default because a
 * reminder pointing at a dead link is worse than none — renewing it first is
 * a deliberate, separate action.
 */
export const REMINDABLE_STATUSES: InvitationStatus[] = ['SENT', 'OPENED', 'STARTED'];

export function isRemindable(status: InvitationStatus): boolean {
  return REMINDABLE_STATUSES.includes(status);
}

/** Rounds to whole percent; 0 audience reads as 0%, never NaN or a dash. */
export function completionRate(completed: number, audience: number): number {
  if (audience <= 0) return 0;
  return Math.round((completed / audience) * 100);
}
