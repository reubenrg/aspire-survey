-- Re-run of the previous migration's retroactive loop: it gated each row on
-- has_survey_role(), which evaluates auth.jwt() - empty in a migration's
-- privileged execution context, so the check was always false and every
-- table was silently skipped. Verified live: all three real response tables
-- still had check_expr='true' after that migration. This is a one-time
-- administrative backfill applied with the platform's own privileges, not a
-- request on behalf of any specific end user, so no per-row authorization
-- check belongs here at all - removed rather than fixed.
do $$
declare r record; n int := 0;
begin
  for r in select table_name from public.surveys
           where table_name is not null and to_regclass('public.' || table_name) is not null
  loop
    execute format('drop policy if exists "Public can submit responses" on public.%I', r.table_name);
    execute format(
      'create policy "Public can submit responses" on public.%I for insert to anon with check ((select s2.published and s2.closed_at is null from public.surveys s2 where s2.table_name = %L))',
      r.table_name, r.table_name);
    n := n + 1;
  end loop;
  raise notice 'Retrofitted % response tables', n;
end $$;
