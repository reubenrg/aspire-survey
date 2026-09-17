-- Final piece: has_column_privilege confirmed anon COULD select is_active,
-- but the join condition itself (o2.id = s2.organization_id) also needs
-- SELECT on organizations.id - Postgres requires column privilege for every
-- column referenced anywhere in a query (JOIN/WHERE included), not only the
-- ones in the output list. This was the actual remaining cause of
-- "permission denied for table organizations".
grant select (id) on public.organizations to anon;
