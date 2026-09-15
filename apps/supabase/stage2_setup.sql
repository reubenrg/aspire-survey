-- One-time setup for the multi-survey engine.
--
-- Holds one row per survey. The definition is the JSON the admin builder
-- produces and the engine renders. Responses do NOT live here: each survey
-- gets its own table, created from its generated SQL.

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  definition jsonb not null,
  table_name text not null,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists surveys_slug_idx on public.surveys (slug);

alter table public.surveys enable row level security;

-- Respondents may read a survey only once it is published, so an unpublished
-- draft cannot be found by guessing its URL.
drop policy if exists "Public can read published surveys" on public.surveys;
create policy "Public can read published surveys"
  on public.surveys
  for select
  to anon
  using (published = true);

-- Admin write policies are added in stage 4, together with the sign-in and the
-- allowlist that decides who counts as an admin. Until then this table is
-- writable only from the SQL editor, which is the safe default.

-- ── Demo survey: its response table and registration ──

-- Engine Demo Survey
-- One response per employee_id.
-- Responses for the survey published at /s/engine-demo
create table if not exists public.survey_engine_demo (
  id uuid primary key default gen_random_uuid(),
  submitted_at timestamptz not null default now(),
  employee_id text not null unique,
  employee_name text,
  role text,
  q_change_01 text,
  q_change_02 text,
  q_change_03 text,
  one_thing text,
  factors text[] not null default '{}',
  q_factors_other text,
  aspire_contribution text,
  aspire_detail text,
  q_role_01 text,
  q_role_02 text
);

alter table public.survey_engine_demo enable row level security;

-- Respondents may add a response and nothing else. There is no select
-- policy on purpose, so answers cannot be read back with the public key.
drop policy if exists "Public can submit responses" on public.survey_engine_demo;
create policy "Public can submit responses"
  on public.survey_engine_demo
  for insert
  to anon
  with check (true);

insert into public.surveys (slug, title, definition, table_name, published)
values ('engine-demo', 'Engine Demo Survey', '{"slug":"engine-demo","title":"Engine Demo Survey","brand":"Survey Engine","uniqueBy":"employeeId","welcome":{"heading":"Engine Demo","body":["This survey exists to prove the engine renders every question type from a definition alone.","Nothing here is real. Answers are written to the demo table."],"note":"Every question below is generated from data, not from a hand-written component."},"thankYou":{"heading":"Thank You!","body":"Your response has been recorded."},"sections":[{"id":"about","title":"About You","intro":"All fields are required.","questions":[{"id":"employeeId","type":"text","label":"Employee ID","placeholder":"e.g. 1234","required":true},{"id":"employeeName","type":"text","label":"Employee Name","placeholder":"Your full name","required":true},{"id":"role","type":"select","label":"Aspire Team / Role","placeholder":"Select your role…","options":["HR","Quality Analyst","Trainer"],"required":true}]},{"id":"change","title":"How Has the Way You Work Changed?","questions":[{"id":"change","type":"matrix","label":"Compared with six months ago, how has your ability changed in the following areas?","columnPrefix":"q_change","rows":["Planning and prioritising my work","Solving problems when they arise","Being consistent in how I work"],"scale":["Reduced","Slightly reduced","No meaningful change","Improved","Improved significantly"],"required":true}]},{"id":"evidence","title":"Real Evidence of Change","questions":[{"id":"oneThing","type":"textarea","label":"What is ONE thing you have started doing differently at work in the last six months?","required":true},{"id":"factors","type":"checkbox","label":"Which factors helped most? (Select up to 3)","options":["Formal training","Support from my manager","Practice and work experience","Personal effort","Other"],"maxSelections":3,"otherColumn":"q_factors_other","required":true},{"id":"aspireContribution","type":"radio","label":"Did any habit, task or activity contribute to this change?","options":["Yes, significantly","Yes, to some extent","No","Maybe / not sure"],"required":true},{"id":"aspireDetail","type":"textarea","label":"Which habit/task/activity helped, and what did it change?","showIf":{"questionId":"aspireContribution","equals":["Yes, significantly","Yes, to some extent"]}}]},{"id":"roleSpecific","title":"Role-Specific","questions":[{"id":"roleAnswers","type":"matrix","label":"Indicate how much you agree with each statement.","columnPrefix":"q_role","scale":["Strongly Disagree","Disagree","Neutral","Agree","Strongly Agree"],"rows":["I consistently follow tasks through to closure."],"rowsByAnswer":{"questionId":"role","map":{"HR":["I identify patterns behind employee performance issues.","I look for ways to improve recurring HR processes."],"Quality Analyst":["I identify patterns behind repeated quality issues.","My feedback helps others prevent similar issues."],"Trainer":["I adjust my training based on evidence of learner needs.","I check whether learning is being applied after training."]}},"titleByAnswer":{"HR":"Your HR Practice","Quality Analyst":"Your Quality Practice","Trainer":"Your Training Practice"},"required":true}]}]}'::jsonb, 'survey_engine_demo', true)
on conflict (slug) do update set
  title = excluded.title,
  definition = excluded.definition,
  table_name = excluded.table_name,
  published = excluded.published,
  updated_at = now();
