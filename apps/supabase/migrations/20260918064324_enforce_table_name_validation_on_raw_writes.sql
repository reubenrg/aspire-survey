-- CRITICAL fix, found during Phase A follow-up work: harden_ensure_survey_response_table()
-- (2026-09-17) validated table_name only INSIDE that one RPC. "Editors update
-- surveys in their org" RLS has no column-level restriction, so any editor
-- could bypass the RPC entirely with a raw PATCH/insert on surveys.table_name -
-- repointing THEIR OWN survey at a DIFFERENT organization's real response
-- table. Every read path (survey_response_page, survey_columns_distribution,
-- exportResponsesCsv, etc.) trusts whatever surveys.table_name says once an
-- analyst clears has_survey_role() for the SURVEY's own org - it has no way to
-- know the physical table underneath now belongs to someone else.
--
-- Proved live before this fix: an editor on organization d9bf6b73 repointed
-- their own survey ("impact-survey")'s table_name directly to
-- "survey_qa_integrity_habit" (a DIFFERENT organization's real response
-- table, 28a65e51), and an analyst on d9bf6b73 then read that other org's
-- actual response rows - including real free-text answers - through
-- survey_response_page(). The frozen legacy survey_responses table happens
-- to be protected from this specific angle already (it has no admitting RLS
-- SELECT policy for authenticated, confirmed by direct test: 0 rows visible),
-- but this is incidental, not a designed protection against this class of
-- attack, and any other survey's response table was fully exposed.
--
-- Fix: the exact same validation ensure_survey_response_table() already
-- performs (safe name pattern, not already claimed by a different survey, and
-- if the table already exists it must structurally look like a response
-- table) now runs unconditionally via a trigger, so it applies no matter which
-- code path writes table_name - the RPC, a legitimate slug-driven upsert in
-- saveSurvey()/createSurveyDraft(), or a raw REST call. A no-op write (value
-- unchanged) skips validation entirely, so ordinary re-saves are unaffected.
CREATE OR REPLACE FUNCTION public.validate_survey_table_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare claimed_by uuid; looks_like_response_table boolean;
begin
  if NEW.table_name is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and NEW.table_name = OLD.table_name then
    return NEW;
  end if;

  if NEW.table_name !~ '^survey_[a-z0-9_]+$' then
    raise exception 'Refusing to set table_name to "%": a response table must be named survey_<name>', NEW.table_name;
  end if;

  select id into claimed_by from public.surveys
  where table_name = NEW.table_name and id <> NEW.id limit 1;
  if claimed_by is not null then
    raise exception 'Refusing to set table_name to "%": it already belongs to another survey', NEW.table_name;
  end if;

  if to_regclass('public.' || NEW.table_name) is not null then
    select count(*) = 3 into looks_like_response_table
    from information_schema.columns
    where table_schema = 'public' and table_name = NEW.table_name
      and column_name in ('id', 'submitted_at', 'definition_version');
    if not looks_like_response_table then
      raise exception 'Refusing to set table_name to "%": it exists but is not a survey response table', NEW.table_name;
    end if;
  end if;

  return NEW;
end $function$;

drop trigger if exists validate_survey_table_name_trg on public.surveys;
create trigger validate_survey_table_name_trg
  before insert or update of table_name on public.surveys
  for each row execute function public.validate_survey_table_name();
