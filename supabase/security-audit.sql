-- ============================================================================
-- READ-ONLY security audit. Changes nothing. Run each block in the SQL Editor
-- and compare with the "expected" note above it.
-- ============================================================================

-- 1. Row Level Security on every table.
--    EXPECTED: rls_enabled = true on all 7 rows.
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- 2. Policies. EXPECTED: ZERO rows. (Any row here is a rule that lets a public
--    role through. Investigate every one.)
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public';

-- 3. Table permissions for the public roles. EXPECTED: ZERO rows after
--    migration_v1_4_0.sql. (Supabase grants these by default; the migration revokes them.)
select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by grantee, table_name
order by grantee, table_name;

-- 4. Views. EXPECTED: ZERO rows. (A view runs with its owner's rights and can
--    bypass RLS unless it is declared security_invoker.)
select table_name from information_schema.views where table_schema = 'public';

-- 5. Functions the public API could call. EXPECTED: ZERO rows, or only ones you wrote.
select p.proname as function_name, p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f';

-- 6. Every column the public roles can still reach (belt and braces).
--    EXPECTED: ZERO rows.
select grantee, table_name, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and grantee in ('anon', 'authenticated')
limit 50;
