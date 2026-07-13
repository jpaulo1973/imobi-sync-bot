REVOKE ALL ON FUNCTION public.normalize_phone_pt(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_phone_pt(text) TO service_role;