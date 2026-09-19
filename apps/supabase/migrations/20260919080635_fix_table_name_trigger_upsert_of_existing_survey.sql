-- Regression fix for enforce_table_name_validation_on_raw_writes (2026-09-18).
--
-- INSERT ... ON CONFLICT (slug) DO UPDATE - the exact statement saveSurvey()'s
-- .upsert({...}, {onConflict:'slug'}) and generateUpsertSql() both produce -
-- reaches a BEFORE INSERT trigger as an INSERT of a proposed row carrying a
-- FRESH id, before Postgres has noticed the slug conflict. For an existing
-- survey whose table_name is unchanged, the "already belongs to another
-- survey" check therefore compared the survey against ITSELF (same
-- table_name, different id) and rejected every upsert of an existing survey:
-- the legacy /admin/:slug editor's Save and the generated-SQL paste path were
-- both broken. The original migration's proof only exercised a plain
-- UPDATE ... SET table_name = table_name, never the upsert the app really
-- issues - a real gap in that verification, found during production
-- pre-flight by running the exact PostgREST upsert shape.
--
-- Fix: an INSERT whose slug already holds this exact table_name claims
-- nothing new (it resolves into an UPDATE of the same survey), so it returns
-- early, exactly like the existing "UPDATE with unchanged table_name" exit.
-- Every genuinely new claim - a new survey, a rename, or an upsert that
-- changes table_name - still runs the full validation.
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
  if TG_OP = 'INSERT' and exists (
    select 1 from public.surveys s where s.slug = NEW.slug and s.table_name = NEW.table_name
  ) then
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
