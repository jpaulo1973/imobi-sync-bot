-- Regressão has_role — deve ser corrido pelo owner (Supabase SQL Editor / CI
-- com service_role) porque exige SET ROLE. Testa:
--   1) authenticated executa has_role
--   2) anon é bloqueado (permission denied)
--   3) RLS de user_roles / app_settings / functional_zones não rebenta
--      com "permission denied for function has_role"

\set ON_ERROR_STOP on

BEGIN;

-- (1) authenticated executa
SET LOCAL ROLE authenticated;
SELECT public.has_role('00000000-0000-0000-0000-000000000000'::uuid,
                       'admin'::public.app_role) AS authenticated_can_execute;
RESET ROLE;

-- (2) anon é rejeitado
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM public.has_role('00000000-0000-0000-0000-000000000000'::uuid,
                          'admin'::public.app_role);
  RAISE EXCEPTION 'REGRESSION: anon conseguiu executar has_role()';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK anon bloqueado: %', SQLERRM;
END $$;
RESET ROLE;

-- (3) RLS depende de has_role — nenhuma destas queries pode falhar
SET LOCAL ROLE authenticated;
SELECT count(*) AS user_roles_rls_ok       FROM public.user_roles;
SELECT count(*) AS app_settings_rls_ok     FROM public.app_settings;
SELECT count(*) AS functional_zones_rls_ok FROM public.functional_zones;
RESET ROLE;

ROLLBACK;