ALTER TABLE public.active_searches
  ADD COLUMN IF NOT EXISTS descartado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS descartado_em timestamptz,
  ADD COLUMN IF NOT EXISTS descartado_motivo text;

CREATE INDEX IF NOT EXISTS idx_active_searches_descartado
  ON public.active_searches (descartado) WHERE descartado = false;

-- O pool de procuras deixa de devolver procuras descartadas (soft-delete).
CREATE OR REPLACE FUNCTION public.pool_active_searches(p_include_expired boolean DEFAULT false)
 RETURNS SETOF active_searches
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.active_searches;
  is_admin boolean;
BEGIN
  PERFORM public.assert_active_caller();
  is_admin := public.has_role(auth.uid(), 'admin');
  FOR r IN
    SELECT * FROM public.active_searches
    WHERE descartado = false
      AND (p_include_expired OR expires_at > now())
  LOOP
    IF NOT (is_admin OR r.user_id = auth.uid()) THEN
      r.contact_telefone := NULL;
      r.contact_email := NULL;
    END IF;
    RETURN NEXT r;
  END LOOP;
END;
$function$;

-- Descarte de procuras (não é procura real / fora do âmbito geográfico).
-- Só administradores; remove também as oportunidades geradas.
CREATE OR REPLACE FUNCTION public.admin_discard_searches(p_ids uuid[], p_motivo text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem permissões de administrador.';
  END IF;
  DELETE FROM public.match_opportunities WHERE active_search_id = ANY(p_ids);
  UPDATE public.active_searches
  SET descartado = true,
      descartado_em = now(),
      descartado_motivo = COALESCE(NULLIF(btrim(p_motivo), ''), 'descartado'),
      expires_at = now()
  WHERE id = ANY(p_ids) AND descartado = false;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_restore_search(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem permissões de administrador.';
  END IF;
  UPDATE public.active_searches
  SET descartado = false, descartado_em = NULL, descartado_motivo = NULL,
      expires_at = GREATEST(expires_at, now() + interval '30 days')
  WHERE id = p_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_discard_searches(uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_restore_search(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_discard_searches(uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restore_search(uuid) TO authenticated;
