-- The new "Public can submit responses" INSERT policy's WITH CHECK subquery
-- runs under the anon role's own privileges (RLS subqueries are not
-- SECURITY DEFINER), and anon had never been granted closed_at. Without this
-- grant, the subquery itself fails with "permission denied for table
-- surveys" on EVERY insert attempt - not just closed ones - which would have
-- silently broken all open-survey submission. Caught by testing the fix
-- immediately rather than assuming it worked. closed_at is a timestamp, not
-- sensitive data - same class as published, already granted.
grant select (closed_at) on public.surveys to anon;
