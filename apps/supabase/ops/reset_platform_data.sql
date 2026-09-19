-- ============================================================================
-- ONE-TIME OPERATION - NOT A MIGRATION. DO NOT MOVE THIS INTO migrations/.
-- (A migration is replayed on every fresh database; this would wipe it.)
--
-- Aspire Surveys - pre-launch data reset ("start fresh").
--
-- WHAT IT DELETES (irreversible - this project has no confirmed backups):
--   * every customer (organizations)
--   * every survey, its version history, invitations and campaign data
--   * every customer's employees
--   * every per-survey response table (the physical survey_<name> tables)
--   * customer-scoped question-library entries and templates
--
-- WHAT IT DELIBERATELY KEEPS:
--   * team members (survey_members) - so you can still sign in
--   * the built-in Aspire templates (survey_templates where organization_id is null)
--   * platform_settings
--   * audit_logs (history is kept; deleted customers' entries lose their
--     organization link automatically)
--   * the legacy public.survey_responses table (S2M respondent data) - retire
--     it separately if you decide you no longer need those rows
--
-- HOW TO RUN (Supabase dashboard -> SQL editor). The guard below refuses to run
-- unless you arm it in the SAME run, so it cannot fire by accident:
--
--     set aspire.confirm_reset = 'YES';
--     <the DO block below>
--
-- It executes as a single statement: any error rolls everything back.
--
-- Written 2026-09-19. Inventory at that time: 8 customers, 12 surveys,
-- 11 versions, 472 employees, 472 invitations, 9 response tables (5 QA rows).
-- ============================================================================

do $$
declare
  n_orgs int; n_surveys int; n_employees int; n_invitations int; n_versions int;
  n_tables int := 0; r record;
begin
  if coalesce(current_setting('aspire.confirm_reset', true), '') <> 'YES' then
    raise exception 'Refusing to run: this deletes every customer, survey and employee. Run  set aspire.confirm_reset = ''YES'';  in the same run to confirm.';
  end if;

  select count(*) into n_orgs        from public.organizations;
  select count(*) into n_surveys     from public.surveys;
  select count(*) into n_employees   from public.employees;
  select count(*) into n_invitations from public.survey_invitations;
  select count(*) into n_versions    from public.survey_versions;

  -- 1. Per-survey response tables first: CONFIDENTIAL ones hold FKs to employees(id).
  --    Only tables a survey row points at AND that carry the response-table
  --    signature, and never a platform or legacy table.
  for r in
    select s.table_name from public.surveys s
    where s.table_name ~ '^survey_[a-z0-9_]+$'
      and s.table_name not in ('survey_members','survey_admins','survey_versions','survey_invitations',
                               'survey_templates','survey_campaigns','survey_campaign_recipients',
                               'survey_email_events','survey_campaign_test_sends','survey_responses')
      and to_regclass('public.' || s.table_name) is not null
      and (select count(*) from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = s.table_name
             and c.column_name in ('id','submitted_at','definition_version')) = 3
  loop
    execute format('drop table public.%I', r.table_name);
    n_tables := n_tables + 1;
  end loop;

  -- 2. Campaign data (recipients, events and test sends cascade), then invitations.
  delete from public.survey_campaigns;
  delete from public.survey_invitations;

  -- 3. Surveys and their version history.
  delete from public.survey_versions;
  delete from public.surveys;

  -- 4. Customers' people and customer-scoped content, then the customers themselves.
  delete from public.employees;
  delete from public.question_library where organization_id is not null;
  delete from public.survey_templates where organization_id is not null;
  delete from public.organizations;

  perform pg_notify('pgrst', 'reload schema');

  insert into public.audit_logs (organization_id, user_email, action_type, details)
  values (null, 'system', 'PLATFORM_RESET', jsonb_build_object(
    'reason', 'Founder-requested pre-launch reset: retire S2M and all test/created customers and surveys',
    'customers_removed', n_orgs, 'surveys_removed', n_surveys, 'survey_versions_removed', n_versions,
    'employees_removed', n_employees, 'invitations_removed', n_invitations, 'response_tables_dropped', n_tables,
    'kept', 'team members, built-in templates, platform settings, audit history, legacy survey_responses table'));
end $$;

-- Afterwards, this should show 0 / 0 / 0 / 15 / 2 (customers, surveys, employees,
-- built-in templates, team members):
--   select (select count(*) from public.organizations), (select count(*) from public.surveys),
--          (select count(*) from public.employees),
--          (select count(*) from public.survey_templates where organization_id is null),
--          (select count(*) from public.survey_members);
