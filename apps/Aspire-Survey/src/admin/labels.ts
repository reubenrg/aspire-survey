/**
 * Human-readable labels for the enums the database speaks in. Kept as pure
 * functions with no Supabase import, so they can be unit tested directly and
 * reused by every screen that needs to show the same word for the same value.
 */
import { RESPONDENT_PRIVACY_NOTICE } from '../engine/privacyNotices.ts';

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

/** True only when a change actually grants Owner for the first time - not when it's already Owner. Gates the extra confirmation step in Team.tsx. */
export function isOwnerEscalation(fromRole: Role, toRole: Role): boolean {
  return toRole === 'owner' && fromRole !== 'owner';
}

export const PRIVACY_MODE_LABEL: Record<PrivacyMode, string> = {
  ANONYMOUS: 'Anonymous',
  ANONYMOUS_TRACKED: 'Anonymous — Participation Tracked',
  CONFIDENTIAL: 'Confidential',
};

/** One sentence, safe to put directly under the mode's name anywhere in the UI. */
export const PRIVACY_MODE_DESCRIPTION: Record<PrivacyMode, string> = {
  ANONYMOUS:
    'One reusable link, no invitation and no employee identity involved at any point. Best for open or general feedback.',
  ANONYMOUS_TRACKED:
    'Each employee receives an individual secure link. Aspire can track invited, opened, started and completed — but employee identity can never be linked to their answers, even by an authorised user.',
  CONFIDENTIAL:
    'Each employee receives an individual secure link. Responses are confidential, not anonymous: authorised Aspire personnel may access identified responses where permitted, but customer-facing reporting is always aggregated.',
};

/**
 * Exact respondent-facing sentence for Confidential surveys - deliberately
 * worded to never claim anonymity, since this mode stores an employee_id
 * alongside the response. Re-exported from the engine (the single source
 * of truth for what a respondent actually sees) so admin-side previews of
 * this copy can never drift from what's really rendered.
 */
export const CONFIDENTIAL_RESPONDENT_NOTICE = RESPONDENT_PRIVACY_NOTICE.CONFIDENTIAL;

/**
 * What the Audience page reminds the admin of, per mode. Exists to prevent a
 * real misunderstanding: an admin seeing "Alice — Completed" in a tracked
 * survey must not conclude they can see what Alice answered.
 */
export const PRIVACY_MODE_REMINDER: Record<PrivacyMode, string> = {
  ANONYMOUS: 'No employee participation tracking is enabled.',
  ANONYMOUS_TRACKED:
    'You can see whether employees participated, but you cannot connect an employee to their answers.',
  CONFIDENTIAL: 'This is confidential, not anonymous — authorised users may access identified responses.',
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
