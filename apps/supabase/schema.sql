create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  submitted_at timestamptz not null default now(),
  employee_id text not null unique,
  employee_name text not null,
  aspire_team_role text not null,
  location text not null,
  responses_json jsonb not null,
  aspire_usefulness_score numeric not null default 0,
  habit_level text,
  s2_change_01 text, s2_change_02 text, s2_change_03 text, s2_change_04 text,
  s2_change_05 text, s2_change_06 text, s2_change_07 text, s2_change_08 text,
  s2_change_09 text, s2_change_10 text, s2_change_11 text, s2_change_12 text,
  s3_mistake_response text,
  s3_work_level text,
  s4_manager_01 text, s4_manager_02 text, s4_manager_03 text, s4_manager_04 text,
  s4_manager_05 text, s4_manager_06 text, s4_manager_07 text, s4_manager_08 text,
  s4_manager_frequency text,
  s5_behaviour_01 text, s5_behaviour_02 text, s5_behaviour_03 text, s5_behaviour_04 text,
  s5_behaviour_05 text, s5_behaviour_06 text, s5_behaviour_07 text,
  s7_improvement_factors text[] not null default '{}',
  s7_factors_other text,
  s8_impact_areas text[] not null default '{}',
  s8_impacts_other text,
  s9_one_thing_differently text,
  s9_real_example text,
  s9_contributed_most text,
  s9_contributed_most_other text,
  s9_aspire_contribution text,
  s9_aspire_detail text,
  s10_barrier text,
  s10_barrier_other text,
  s10_help_option text,
  s10_help_other text,
  s11_pms_clarity text,
  s12_role text,
  s12_role_q1 text,
  s12_role_q2 text,
  s12_role_q3 text,
  s13_final_answer text
);

comment on column public.survey_responses.s2_change_01 is 'Understanding what is expected from my role';
comment on column public.survey_responses.s2_change_02 is 'Planning and prioritising my work';
comment on column public.survey_responses.s2_change_03 is 'Completing my responsibilities reliably';
comment on column public.survey_responses.s2_change_04 is 'Taking ownership until work is completed';
comment on column public.survey_responses.s2_change_05 is 'Solving problems when they arise';
comment on column public.survey_responses.s2_change_06 is 'Making appropriate decisions independently';
comment on column public.survey_responses.s2_change_07 is 'Learning from mistakes, feedback or difficult situations';
comment on column public.survey_responses.s2_change_08 is 'Applying previous learning to new situations';
comment on column public.survey_responses.s2_change_09 is 'Adapting when requirements or priorities change';
comment on column public.survey_responses.s2_change_10 is 'Communicating clearly with the people I work with';
comment on column public.survey_responses.s2_change_11 is 'Preventing repeated problems';
comment on column public.survey_responses.s2_change_12 is 'Being consistent in how I work';

alter table public.survey_responses enable row level security;

-- Keep survey answers private. The browser only needs permission to create a
-- response; reporting access should be performed by database owners or a
-- trusted backend using a service-role credential.
revoke all on table public.survey_responses from anon, authenticated;
grant insert on table public.survey_responses to anon, authenticated;

drop policy if exists "Allow public survey submissions" on public.survey_responses;
create policy "Allow public survey submissions"
  on public.survey_responses
  for insert
  to anon, authenticated
  with check (true);
