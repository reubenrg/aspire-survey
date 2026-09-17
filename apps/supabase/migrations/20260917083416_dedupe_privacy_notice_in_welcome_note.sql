-- Both respondent-facing survey routes now render RESPONDENT_PRIVACY_NOTICE[privacyMode]
-- as a dedicated box (SurveyPage.tsx was just wired up to match InvitePage.tsx).
-- The 15 seeded templates additionally hardcoded that same sentence into
-- welcome.note at seed time, which - now that both routes render the dynamic
-- box - shows the identical sentence twice on screen. Strips it ONLY where the
-- note exactly matches one of the two known privacy-notice sentences, so a
-- genuinely custom note (e.g. Engine Demo Survey's) is left untouched.
update public.survey_templates
set definition = definition #- '{welcome,note}'
where definition->'welcome'->>'note' in (
  'Your responses are confidential. Individual responses are restricted to authorised Aspire personnel, and reporting to your organisation is provided only in aggregate.',
  'Your participation may be visible to Aspire, but your answers can never be linked back to you.'
);

update public.surveys
set definition = definition #- '{welcome,note}'
where definition->'welcome'->>'note' in (
  'Your responses are confidential. Individual responses are restricted to authorised Aspire personnel, and reporting to your organisation is provided only in aggregate.',
  'Your participation may be visible to Aspire, but your answers can never be linked back to you.'
);
