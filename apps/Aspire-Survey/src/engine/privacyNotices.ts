/** Matches admin/labels.ts's PrivacyMode - redeclared rather than imported, the same way invitationStore.ts's ResolvedInvitation already does, so the respondent-facing engine stays independent of the admin layer. */
export type EnginePrivacyMode = 'ANONYMOUS' | 'ANONYMOUS_TRACKED' | 'CONFIDENTIAL';

/**
 * The exact sentence shown to a respondent on the welcome screen, per
 * privacy mode. CONFIDENTIAL must never be softened into "anonymous" -
 * that mode stores an employee_id alongside the response, so the word
 * would be false. Kept here (not admin/labels.ts) since this is what the
 * respondent-facing engine actually renders; the admin side imports these
 * for its own privacy-mode explanations so the two can never drift apart.
 */
export const RESPONDENT_PRIVACY_NOTICE: Record<EnginePrivacyMode, string> = {
  ANONYMOUS:
    'This survey is anonymous. Nothing about who you are is collected or stored with your answers.',
  ANONYMOUS_TRACKED:
    'Your participation (whether you completed this survey) may be visible to Aspire, but your individual answers can never be linked back to you, even by Aspire staff.',
  CONFIDENTIAL:
    'Your responses are confidential. Individual responses are restricted to authorised Aspire personnel, and reporting to your organisation is provided only in aggregate.',
};
