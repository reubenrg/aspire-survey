-- Phase A DB constraint audit: surveys.organization_id was nullable, but
-- every write path (createSurveyDraft, saveSurvey) always supplies it as a
-- required string, and a null-org survey would be structurally broken - it
-- can never be publicly readable (organization_is_active(null) always
-- returns false, since no organizations row has a null id to match) and no
-- workspace-scoped editor could reach it (has_survey_role(null, ...) only
-- matches a GLOBAL member). Confirmed zero existing rows have a null
-- organization_id before tightening. Matches the real, always-true product
-- invariant: a survey belongs to exactly one customer.
alter table public.surveys alter column organization_id set not null;
