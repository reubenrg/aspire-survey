-- Wires the open /s/:slug respondent path up to the same dynamic privacy
-- notice the invitation path already had (privacy_mode was never exposed to
-- anon before, so SurveyPage.tsx had no way to pass it to SurveyRenderer),
-- then removes the now-redundant hardcoded copy of that same sentence from
-- the 15 seeded templates' welcome.note - which, once both routes render the
-- dynamic box, would otherwise show the identical privacy sentence twice.
--
-- Paired with an app-side change: engine/surveyStore.ts now selects and
-- returns privacy_mode, and routes/SurveyPage.tsx passes it to
-- <SurveyRenderer privacyMode=.../>, matching routes/InvitePage.tsx.

grant select (privacy_mode) on public.surveys to anon;

-- Strips welcome.note ONLY where it exactly matches one of the two known
-- privacy-notice sentences, so a genuinely custom note (e.g. Engine Demo
-- Survey's own explanatory text) is left untouched.
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
