-- Restaurar EXECUTE em has_role para authenticated.
-- Necessário para: (1) políticas RLS que chamam public.has_role(auth.uid(),'admin')
-- em user_roles, app_settings, functional_zones; (2) RPC directa em
-- src/lib/review.functions.ts. SECURITY DEFINER + search_path fixo mantém
-- a função segura; anon continua sem EXECUTE.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;