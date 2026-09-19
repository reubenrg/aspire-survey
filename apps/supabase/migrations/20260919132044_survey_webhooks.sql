-- Outgoing webhooks: send each new response to a URL the survey's editors choose
-- (Zapier "Catch Hook", Make, Microsoft Teams / Slack incoming webhooks, or your own
-- endpoint). Delivered by the database itself through pg_net, asynchronously, so a slow
-- or failing receiver can never delay or block a respondent's submission.
--
-- What is sent
--   format 'json': {event, survey:{slug,title}, response_id, submitted_at,
--                   definition_version, data:{<column>: <answer>...}}
--   format 'text': {"text": "New response to \"<title>\""}  (Teams / Slack incoming webhooks)
--   The identity columns (employee_id, resp_department, resp_location, resp_designation)
--   are NEVER included, in any privacy mode. File and signature answers are storage
--   paths, not files.
-- Authenticity: every request carries X-Aspire-Signature: sha256=<HMAC-SHA256 of the raw
--   body, keyed with the webhook's secret>. The secret is shown once, when the webhook
--   is created, and cannot be read back through the API.
-- Safety: https only; localhost, private and link-local addresses and *.internal / *.local
--   hosts are refused. A hostname that later resolves to a private address cannot be ruled
--   out here, so only editors (trusted staff) can add webhooks.
-- Every response table gets an AFTER INSERT trigger. ensure_survey_response_table() is
--   patched (below) to add it for tables created from now on; existing tables are
--   backfilled at the end of this migration.

create extension if not exists pg_net with schema extensions;

create table if not exists public.survey_webhooks (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  url text not null,
  format text not null default 'json' check (format in ('json', 'text')),
  secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists survey_webhooks_survey_idx on public.survey_webhooks (survey_id);

create table if not exists public.survey_webhook_events (
  id bigserial primary key,
  webhook_id uuid not null references public.survey_webhooks(id) on delete cascade,
  request_id bigint,
  is_test boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists survey_webhook_events_hook_idx on public.survey_webhook_events (webhook_id, created_at desc);

alter table public.survey_webhooks enable row level security;
alter table public.survey_webhook_events enable row level security;
revoke all on public.survey_webhooks, public.survey_webhook_events from public, anon, authenticated;

-- Editors of the survey's customer may see (never the secret), pause and delete webhooks.
grant select (id, survey_id, url, format, is_active, created_by, created_at) on public.survey_webhooks to authenticated;
grant update (is_active) on public.survey_webhooks to authenticated;
grant delete on public.survey_webhooks to authenticated;

drop policy if exists "Editors read webhooks" on public.survey_webhooks;
create policy "Editors read webhooks" on public.survey_webhooks for select to authenticated
  using (public.has_survey_role((select s.organization_id from public.surveys s where s.id = survey_id), 'editor'));
drop policy if exists "Editors update webhooks" on public.survey_webhooks;
create policy "Editors update webhooks" on public.survey_webhooks for update to authenticated
  using (public.has_survey_role((select s.organization_id from public.surveys s where s.id = survey_id), 'editor'))
  with check (public.has_survey_role((select s.organization_id from public.surveys s where s.id = survey_id), 'editor'));
drop policy if exists "Editors delete webhooks" on public.survey_webhooks;
create policy "Editors delete webhooks" on public.survey_webhooks for delete to authenticated
  using (public.has_survey_role((select s.organization_id from public.surveys s where s.id = survey_id), 'editor'));

CREATE OR REPLACE FUNCTION public.is_safe_webhook_url(p_url text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_url ~* '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{2,5})?(/[^\s]*)?$'
     and length(p_url) <= 2000
     and split_part(split_part(substr(p_url, 9), '/', 1), ':', 1) !~* '^(localhost|.*\.(internal|local|localhost)|[0-9]+(\.[0-9]+){3}|0x[0-9a-f]+|[0-9]+)$'
$function$;

-- The trigger every response table gets.
CREATE OR REPLACE FUNCTION public.enqueue_response_webhooks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare s record; w record; payload jsonb; b jsonb; sig text; rid bigint;
begin
  select id, slug, title into s from public.surveys where table_name = TG_TABLE_NAME limit 1;
  if s.id is null then return null; end if;
  if not exists (select 1 from public.survey_webhooks h where h.survey_id = s.id and h.is_active) then return null; end if;

  payload := jsonb_build_object(
    'event', 'response.created',
    'survey', jsonb_build_object('slug', s.slug, 'title', s.title),
    'response_id', NEW.id, 'submitted_at', NEW.submitted_at, 'definition_version', NEW.definition_version,
    'data', to_jsonb(NEW) - 'id' - 'submitted_at' - 'definition_version'
            - 'employee_id' - 'resp_department' - 'resp_location' - 'resp_designation');

  for w in select * from public.survey_webhooks h where h.survey_id = s.id and h.is_active loop
    begin
      b := case w.format when 'text' then jsonb_build_object('text', 'New response to "' || s.title || '"') else payload end;
      -- Sign exactly the bytes pg_net will send: the jsonb text form.
      sig := encode(extensions.hmac(b::text, w.secret, 'sha256'), 'hex');
      select net.http_post(
        url := w.url, body := b,
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'X-Aspire-Signature', 'sha256=' || sig, 'X-Aspire-Event', 'response.created'),
        timeout_milliseconds := 5000) into rid;
      insert into public.survey_webhook_events (webhook_id, request_id) values (w.id, rid);
    exception when others then
      insert into public.survey_webhook_events (webhook_id, error) values (w.id, left(sqlerrm, 300));
    end;
  end loop;
  return null;
end $function$;
revoke all on function public.enqueue_response_webhooks() from public, anon, authenticated;

-- Create a webhook; returns its id and secret ONCE.
CREATE OR REPLACE FUNCTION public.create_survey_webhook(p_slug text, p_url text, p_format text DEFAULT 'json')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; w record;
begin
  select id, organization_id into s from public.surveys where slug = p_slug;
  if s.id is null or not public.has_survey_role(s.organization_id, 'editor') then
    raise exception 'You need the editor role to add a webhook to this survey' using errcode = '42501';
  end if;
  if not public.is_safe_webhook_url(p_url) then
    raise exception 'The address must be a public https:// URL (not localhost or a private network address)' using errcode = '22023';
  end if;
  if p_format not in ('json', 'text') then raise exception 'Unknown format' using errcode = '22023'; end if;
  if (select count(*) from public.survey_webhooks where survey_id = s.id) >= 5 then
    raise exception 'A survey can have at most 5 webhooks' using errcode = '54000';
  end if;
  insert into public.survey_webhooks (survey_id, url, format, created_by)
  values (s.id, p_url, p_format, auth.jwt() ->> 'email') returning * into w;
  perform public.record_audit(s.organization_id, 'WEBHOOK_CREATED',
    jsonb_build_object('survey', p_slug, 'webhook_id', w.id, 'host', split_part(split_part(substr(p_url, 9), '/', 1), ':', 1)));
  return jsonb_build_object('id', w.id, 'secret', w.secret);
end $function$;

-- Send a sample event to one webhook.
CREATE OR REPLACE FUNCTION public.test_survey_webhook(p_webhook_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare w record; s record; b jsonb; sig text; rid bigint;
begin
  select * into w from public.survey_webhooks where id = p_webhook_id;
  if w.id is null then raise exception 'No such webhook' using errcode = 'P0002'; end if;
  select id, slug, title, organization_id into s from public.surveys where id = w.survey_id;
  if not public.has_survey_role(s.organization_id, 'editor') then
    raise exception 'You need the editor role to test this webhook' using errcode = '42501';
  end if;
  b := case w.format
    when 'text' then jsonb_build_object('text', 'Test event from Aspire Surveys for "' || s.title || '"')
    else jsonb_build_object('event', 'test', 'survey', jsonb_build_object('slug', s.slug, 'title', s.title),
           'response_id', gen_random_uuid(), 'submitted_at', now(), 'definition_version', 1,
           'data', jsonb_build_object('note', 'This is a test event. No real response was received.')) end;
  sig := encode(extensions.hmac(b::text, w.secret, 'sha256'), 'hex');
  select net.http_post(url := w.url, body := b,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Aspire-Signature', 'sha256=' || sig, 'X-Aspire-Event', 'test'),
    timeout_milliseconds := 5000) into rid;
  insert into public.survey_webhook_events (webhook_id, request_id, is_test) values (w.id, rid, true);
  return rid;
end $function$;

-- Recent delivery attempts for a webhook, with the receiver's HTTP status.
CREATE OR REPLACE FUNCTION public.survey_webhook_deliveries(p_webhook_id uuid, p_limit integer DEFAULT 10)
 RETURNS TABLE(at timestamptz, is_test boolean, status integer, error text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare org uuid;
begin
  select s.organization_id into org from public.survey_webhooks w join public.surveys s on s.id = w.survey_id where w.id = p_webhook_id;
  if org is null or not public.has_survey_role(org, 'editor') then return; end if;
  return query
    select e.created_at, e.is_test, r.status_code, coalesce(e.error, r.error_msg)
    from public.survey_webhook_events e
    left join net._http_response r on r.id = e.request_id
    where e.webhook_id = p_webhook_id
    order by e.created_at desc
    limit least(greatest(coalesce(p_limit, 10), 1), 50);
end $function$;

revoke all on function public.create_survey_webhook(text, text, text) from public, anon;
revoke all on function public.test_survey_webhook(uuid) from public, anon;
revoke all on function public.survey_webhook_deliveries(uuid, integer) from public, anon;
revoke all on function public.is_safe_webhook_url(text) from public;
grant execute on function public.create_survey_webhook(text, text, text) to authenticated;
grant execute on function public.test_survey_webhook(uuid) to authenticated;
grant execute on function public.survey_webhook_deliveries(uuid, integer) to authenticated;
grant execute on function public.is_safe_webhook_url(text) to authenticated;

-- Patch ensure_survey_response_table() so tables created from now on get the trigger. The
-- function is rewritten from its own current definition with one addition, immediately
-- before its closing "notify + audit" tail; the guard makes it safe to run twice.
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.ensure_survey_response_table(uuid, jsonb)'::regprocedure);
  if position('survey_response_webhooks' in d) = 0 then
    d := regexp_replace(
      d,
      'notify pgrst, ''reload schema'';\s+perform public\.record_audit',
      E'execute format(''drop trigger if exists survey_response_webhooks on public.%I'', tbl);\n  execute format(''create trigger survey_response_webhooks after insert on public.%I for each row execute function public.enqueue_response_webhooks()'', tbl);\n\n  notify pgrst, ''reload schema'';\n\n  perform public.record_audit');
    if position('survey_response_webhooks' in d) = 0 then
      raise exception 'Could not patch ensure_survey_response_table(): anchor not found';
    end if;
    execute d;
  end if;
end $patch$;

-- Backfill: every existing response table.
do $backfill$
declare t record;
begin
  for t in select s.table_name from public.surveys s
           where s.table_name ~ '^survey_[a-z0-9_]+$' and to_regclass('public.' || s.table_name) is not null loop
    execute format('drop trigger if exists survey_response_webhooks on public.%I', t.table_name);
    execute format('create trigger survey_response_webhooks after insert on public.%I for each row execute function public.enqueue_response_webhooks()', t.table_name);
  end loop;
end $backfill$;

notify pgrst, 'reload schema';
