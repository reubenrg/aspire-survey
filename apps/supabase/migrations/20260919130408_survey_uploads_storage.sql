-- Storage for the file-upload, signature and image-choice question types.
--
-- survey-uploads (PRIVATE): respondents' files and signatures.
--   * Anyone (anon) may ADD an object, but only under `<survey slug>/<id>/<file>` and
--     only while that survey is open (survey_availability(slug) = 'open'): a closed,
--     unpublished, full or not-yet-open survey accepts no uploads.
--   * Nobody can read, list, replace or delete through the API except analysts of
--     the survey's own customer (read). Respondents never get a link back.
--   * The bucket itself caps a file at 10 MB and allows only images, PDFs and
--     ordinary office documents, so the policy does not have to police content.
-- survey-images (PUBLIC): pictures an author attaches to image-choice options; they
--   must be viewable by anyone with the survey link. Only editors can add them; 2 MB,
--   images only.
--
-- Known limit: an anonymous caller can upload repeatedly while a survey is open, so
-- a very abusive respondent could fill storage. The 10 MB cap and the open-survey
-- gate bound it; a rate limit would need an Edge Function in front of the upload.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'survey-uploads', 'survey-uploads', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('survey-images', 'survey-images', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Whether the signed-in user holds an editor (or owner) role in ANY workspace.
CREATE OR REPLACE FUNCTION public.is_survey_editor_anywhere()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.survey_members m
    where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and m.is_active and m.role in ('editor', 'owner')
  );
$function$;
revoke all on function public.is_survey_editor_anywhere() from public, anon;
grant execute on function public.is_survey_editor_anywhere() to authenticated;

drop policy if exists "Respondents add uploads to open surveys" on storage.objects;
create policy "Respondents add uploads to open surveys" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'survey-uploads'
    and array_length(storage.foldername(name), 1) = 2
    and public.survey_availability((storage.foldername(name))[1]) = 'open'
  );

drop policy if exists "Analysts read their survey uploads" on storage.objects;
create policy "Analysts read their survey uploads" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'survey-uploads'
    and public.has_survey_role(
      (select s.organization_id from public.surveys s where s.slug = (storage.foldername(name))[1]),
      'analyst')
  );

drop policy if exists "Editors add survey images" on storage.objects;
create policy "Editors add survey images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'survey-images' and public.is_survey_editor_anywhere());

notify pgrst, 'reload schema';
