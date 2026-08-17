CREATE OR REPLACE FUNCTION public.assert_active_caller()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND ativo = false) THEN
    RAISE EXCEPTION 'Conta desativada.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_active_caller() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_active_caller() FROM anon;
GRANT EXECUTE ON FUNCTION public.assert_active_caller() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pool_properties()
RETURNS SETOF public.properties
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_active_caller();
  RETURN QUERY SELECT * FROM public.properties WHERE ativo = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.pool_active_searches(p_include_expired boolean DEFAULT false)
RETURNS SETOF public.active_searches
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  r public.active_searches;
  is_admin boolean;
BEGIN
  PERFORM public.assert_active_caller();
  is_admin := public.has_role(auth.uid(), 'admin');
  FOR r IN
    SELECT * FROM public.active_searches
    WHERE p_include_expired OR expires_at > now()
  LOOP
    IF NOT (is_admin OR r.user_id = auth.uid()) THEN
      r.contact_telefone := NULL;
      r.contact_email := NULL;
    END IF;
    RETURN NEXT r;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.pool_buyer_clients()
RETURNS SETOF public.buyer_clients
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  r public.buyer_clients;
BEGIN
  PERFORM public.assert_active_caller();
  FOR r IN SELECT * FROM public.buyer_clients WHERE ativo = true LOOP
    IF r.user_id <> auth.uid() THEN
      r.nome := NULL;
      r.telefone := NULL;
      r.email := NULL;
      r.notas := NULL;
    END IF;
    RETURN NEXT r;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.consultor_directory()
RETURNS TABLE (id uuid, full_name text, agency text, telefone text, whatsapp text, email text, ativo boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_active_caller();
  RETURN QUERY
  SELECT p.id, p.full_name, p.agency, p.telefone, p.whatsapp, p.email, p.ativo
  FROM public.profiles p;
END;
$$;

REVOKE ALL ON FUNCTION public.pool_properties() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pool_active_searches(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pool_buyer_clients() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consultor_directory() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pool_properties() FROM anon;
REVOKE EXECUTE ON FUNCTION public.pool_active_searches(boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pool_buyer_clients() FROM anon;
REVOKE EXECUTE ON FUNCTION public.consultor_directory() FROM anon;
GRANT EXECUTE ON FUNCTION public.pool_properties() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pool_active_searches(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pool_buyer_clients() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consultor_directory() TO authenticated, service_role;