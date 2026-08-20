REVOKE ALL ON FUNCTION public.admin_purge_expired_searches(boolean, integer) FROM anon;
REVOKE ALL ON FUNCTION public.admin_purge_expired_searches(boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_purge_expired_searches(boolean, integer) TO authenticated;