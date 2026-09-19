-- Per-person rate limit for the generate-survey Edge Function (20 drafts per hour). Only the
-- function's service role reads or writes it; it stores who and how long, never the prompt.
create table if not exists public.ai_generation_log (
  id bigserial primary key,
  user_email text not null,
  prompt_chars integer not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_generation_log_user_idx on public.ai_generation_log (user_email, created_at desc);
alter table public.ai_generation_log enable row level security;
revoke all on public.ai_generation_log from public, anon, authenticated;
grant usage, select on sequence public.ai_generation_log_id_seq to service_role;
grant all on public.ai_generation_log to service_role;
