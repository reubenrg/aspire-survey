-- MEDIUM/HIGH fix: organizations.id was referenced by surveys.organization_id
-- and survey_members.organization_id with ON DELETE CASCADE, while every
-- other FK to organizations (employees, question_library, survey_templates,
-- survey_campaigns) already used RESTRICT/NO ACTION. "Owners manage
-- organizations" RLS admits a hard DELETE to any workspace-scoped owner of
-- their own org (the app's own UI only ever offers "Deactivate" - this was
-- reachable only via a direct REST call, never through the product), and the
-- CASCADE meant that delete silently destroyed every survey record and team
-- membership under it, with no audit entry (a raw RLS-gated table DELETE,
-- not a function - record_audit is never in this path) and no recovery path.
-- Worse: a survey's response-data table is a separate physical table with no
-- FK back to surveys, so cascading the surveys row orphans real response
-- data rather than deleting it.
--
-- Proved live before this fix: a workspace owner's raw DELETE on their own
-- organizations row cascaded away both a survey row and their own
-- survey_members row in the same transaction.
--
-- RESTRICT here matches the protection every other child table already had:
-- deleting a populated organization now fails with a FK violation instead of
-- silently cascading. Deleting a genuinely empty org (no surveys, no
-- members, no employees, no library/templates/campaigns) is unaffected.
alter table public.surveys
  drop constraint surveys_organization_id_fkey,
  add constraint surveys_organization_id_fkey
    foreign key (organization_id) references public.organizations(id);

alter table public.survey_members
  drop constraint survey_members_organization_id_fkey,
  add constraint survey_members_organization_id_fkey
    foreign key (organization_id) references public.organizations(id);
