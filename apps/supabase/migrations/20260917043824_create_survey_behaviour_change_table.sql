-- Behaviour Change
-- Responses for the survey published at /s/behaviour-change
-- Generated to exactly match engine/generateSql.ts's generateCreateTableSql()
-- output for this survey's definition (privacy_mode = CONFIDENTIAL).
create table if not exists public.survey_behaviour_change (
  id uuid primary key default gen_random_uuid(),
  submitted_at timestamptz not null default now(),
  definition_version int,
  aw_01 text,
  aw_02 text,
  aw_03 text,
  stage_now text,
  sustain_01 text,
  sustain_02 text,
  sustain_03 text,
  obstacles_list text[] not null default '{}',
  what_would_help text,

  resp_department text,
  resp_location text,
  resp_designation text,
  employee_id uuid references public.employees(id)
);

alter table public.survey_behaviour_change enable row level security;

drop policy if exists "Public can submit responses" on public.survey_behaviour_change;
create policy "Public can submit responses"
  on public.survey_behaviour_change
  for insert
  to anon
  with check (true);

drop policy if exists "Analysts read responses" on public.survey_behaviour_change;
create policy "Analysts read responses"
  on public.survey_behaviour_change
  for select
  to authenticated
  using (public.has_survey_role(
    (select s.organization_id from public.surveys s where s.table_name = 'survey_behaviour_change'),
    'analyst'));

revoke all on public.survey_behaviour_change from anon;
grant insert on public.survey_behaviour_change to anon;
revoke all on public.survey_behaviour_change from authenticated;
grant select (id, submitted_at, definition_version, aw_01, aw_02, aw_03, stage_now, sustain_01, sustain_02, sustain_03, obstacles_list, what_would_help), insert on public.survey_behaviour_change to authenticated;
