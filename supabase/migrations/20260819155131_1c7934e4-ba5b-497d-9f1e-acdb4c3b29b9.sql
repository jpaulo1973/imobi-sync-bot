CREATE OR REPLACE FUNCTION public.contacts_backfill_source(p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
RETURNS TABLE(
  user_id uuid,
  contact_nome text,
  consultor_nome text,
  contact_telefone text,
  consultor_telefone text,
  contact_email text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem permissões de administrador.';
  END IF;
  RETURN QUERY
  SELECT s.user_id, s.contact_nome, s.consultor_nome, s.contact_telefone,
         s.consultor_telefone, s.contact_email, s.created_at, s.updated_at
  FROM public.active_searches s
  ORDER BY s.created_at, s.id
  LIMIT GREATEST(COALESCE(p_limit, 1000), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.contacts_backfill_source(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contacts_backfill_source(integer, integer) TO authenticated;