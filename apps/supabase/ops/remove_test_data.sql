-- ONE-TIME OPERATION (not a migration): removes exactly the data created by
-- ops/seed_test_data.sql and nothing else - the two "(TEST)" customers, their
-- employees, invitations, surveys, versions and the three response tables.
-- Touches only rows tied to slugs northwind-demo-test / globex-demo-test.
begin;

drop table if exists public.survey_test_engagement_pulse;
drop table if exists public.survey_test_customer_satisfaction;
drop table if exists public.survey_test_onboarding_feedback;

delete from public.survey_invitations where survey_id in (
  select s.id from public.surveys s join public.organizations o on o.id = s.organization_id
  where o.slug in ('northwind-demo-test', 'globex-demo-test'));
delete from public.survey_versions where survey_id in (
  select s.id from public.surveys s join public.organizations o on o.id = s.organization_id
  where o.slug in ('northwind-demo-test', 'globex-demo-test'));
delete from public.surveys where organization_id in (
  select id from public.organizations where slug in ('northwind-demo-test', 'globex-demo-test'));
delete from public.employees where organization_id in (
  select id from public.organizations where slug in ('northwind-demo-test', 'globex-demo-test'));
delete from public.organizations where slug in ('northwind-demo-test', 'globex-demo-test');

insert into public.audit_logs (organization_id, user_email, action_type, details)
values (null, 'ops-script', 'TEST_DATA_REMOVED', '{"script":"ops/remove_test_data.sql"}'::jsonb);

commit;
