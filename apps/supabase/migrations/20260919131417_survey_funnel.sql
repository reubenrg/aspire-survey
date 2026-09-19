-- Drop-off tracking: how many people opened a survey and how many reached each page.
--
-- Privacy first. Only daily COUNTERS are stored (survey, day, step, n): no cookie, no
-- session id, no IP, no answer, nothing that can be tied to a person - so it is safe for
-- anonymous surveys and does not weaken any privacy mode. Step 0 = opened the welcome
-- screen; step k (k >= 1) = reached the page at section index k-1. "Submitted" is not
-- counted here: it is simply the number of responses.
--
-- record_survey_step(slug, step) is callable by anon but only counts while the survey is
-- open, and only steps 0..200. A determined visitor could inflate a counter; the figures
-- are an indicator of where people stop, not an audit trail.
-- survey_funnel(slug) returns the totals to analysts of the survey's own customer.

create table if not exists public.survey_step_counts (
  survey_id uuid not null references public.surveys(id) on delete cascade,
  day date not null default current_date,
  step integer not null check (step between 0 and 200),
  n bigint not null default 0,
  primary key (survey_id, day, step)
);

alter table public.survey_step_counts enable row level security;
revoke all on public.survey_step_counts from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_survey_step(p_slug text, p_step integer)
 RETURNS void
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare sid uuid;
begin
  if p_step is null or p_step < 0 or p_step > 200 then return; end if;
  select id into sid from public.surveys where slug = p_slug;
  if sid is null or public.survey_availability_for(sid) <> 'open' then return; end if;
  insert into public.survey_step_counts (survey_id, day, step, n)
  values (sid, current_date, p_step, 1)
  on conflict (survey_id, day, step) do update set n = public.survey_step_counts.n + 1;
end $function$;

CREATE OR REPLACE FUNCTION public.survey_funnel(p_slug text)
 RETURNS TABLE(step integer, n bigint, first_day date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record;
begin
  select id, organization_id into s from public.surveys where slug = p_slug;
  if s.id is null or not public.has_survey_role(s.organization_id, 'analyst') then return; end if;
  return query
    select c.step, sum(c.n)::bigint, min(c.day)
    from public.survey_step_counts c
    where c.survey_id = s.id
    group by c.step
    order by c.step;
end $function$;

revoke all on function public.record_survey_step(text, integer) from public;
revoke all on function public.survey_funnel(text) from public, anon;
grant execute on function public.record_survey_step(text, integer) to anon, authenticated;
grant execute on function public.survey_funnel(text) to authenticated;

notify pgrst, 'reload schema';
