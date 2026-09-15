-- The tables exist but PostgREST cannot see them, because a row level security
-- policy does not by itself grant access. PostgREST builds its schema cache
-- from the relations a role has privileges on, so a table with policies but no
-- grant is invisible over the API and every request fails with PGRST205.
--
-- Select everything (Ctrl+A) before running.

grant select on public.surveys to anon, authenticated;
grant insert on public.survey_engine_demo to anon, authenticated;

notify pgrst, 'reload schema';

-- Proof. Expect one row per table showing what anon may now do.
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon'
  and table_schema = 'public'
  and table_name in ('surveys', 'survey_engine_demo')
order by table_name, privilege_type;
