-- The new "Public can read published surveys" policy and every response
-- table's "Public can submit responses" policy now subquery into
-- organizations.is_active, but anon had zero grant on that table at all -
-- so both checks failed with "permission denied for table organizations" on
-- every attempt, not just deactivated ones. Caught by testing immediately.
-- is_active is a boolean lifecycle flag, not sensitive data (unlike name/
-- slug/branding, which stay ungranted).
grant select (is_active) on public.organizations to anon;
