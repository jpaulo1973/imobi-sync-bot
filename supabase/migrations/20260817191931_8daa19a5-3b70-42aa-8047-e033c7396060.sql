CREATE OR REPLACE FUNCTION public.pool_buyer_clients()
RETURNS SETOF public.buyer_clients
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  r public.buyer_clients;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
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

REVOKE ALL ON FUNCTION public.pool_buyer_clients() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pool_buyer_clients() FROM anon;
GRANT EXECUTE ON FUNCTION public.pool_buyer_clients() TO authenticated, service_role;