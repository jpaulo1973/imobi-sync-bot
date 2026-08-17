REVOKE EXECUTE ON FUNCTION public.pool_properties() FROM anon;
REVOKE EXECUTE ON FUNCTION public.pool_active_searches(boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consultor_directory() FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_match_opportunities(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_match_opportunities(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_match_notifications(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.touch_location_alias(uuid) FROM anon;