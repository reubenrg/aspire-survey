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
