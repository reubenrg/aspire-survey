-- The org-active RLS subquery joins surveys.organization_id to
-- organizations.id, and anon had never been granted that column either
-- (only slug/title/definition/table_name/published/current_version/
-- privacy_mode/closed_at). Same class of bug as the previous two grant
-- fixes - not sensitive data, just never previously needed by anon.
grant select (organization_id) on public.surveys to anon;
