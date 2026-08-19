CREATE OR REPLACE FUNCTION public.admin_recalc_excel_expiry(p_apply boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_afetadas integer := 0;
  v_expiram integer := 0;
  v_sem_base integer := 0;
  v_aplicadas integer := 0;
  v_amostra jsonb;
  v_dist jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem permissões de administrador.';
  END IF;

  CREATE TEMP TABLE _recalc ON COMMIT DROP AS
  SELECT s.id,
         s.contact_nome,
         s.data_publicacao,
         s.data_origem,
         s.expires_at AS exp_atual,
         (COALESCE(s.data_publicacao, s.data_origem::timestamptz) + interval '30 days') AS exp_novo
  FROM public.active_searches s
  WHERE s.origem = 'excel'
    AND s.descartado = false
    AND COALESCE(s.data_publicacao, s.data_origem::timestamptz) IS NOT NULL
    AND (COALESCE(s.data_publicacao, s.data_origem::timestamptz) + interval '30 days') IS DISTINCT FROM s.expires_at;

  SELECT count(*), count(*) FILTER (WHERE exp_novo <= now() AND exp_atual > now())
    INTO v_afetadas, v_expiram FROM _recalc;

  SELECT count(*) INTO v_sem_base
  FROM public.active_searches s
  WHERE s.origem = 'excel' AND s.descartado = false
    AND COALESCE(s.data_publicacao, s.data_origem::timestamptz) IS NULL;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'mes'), '[]'::jsonb) INTO v_dist FROM (
    SELECT jsonb_build_object('mes', to_char(COALESCE(data_publicacao, data_origem::timestamptz), 'YYYY-MM'), 'total', count(*)) AS x
    FROM _recalc WHERE exp_novo <= now() AND exp_atual > now()
    GROUP BY 1
  ) d;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_amostra FROM (
    SELECT jsonb_build_object(
      'id', id, 'nome', contact_nome,
      'publicacao', to_char(COALESCE(data_publicacao, data_origem::timestamptz), 'YYYY-MM-DD'),
      'exp_atual', to_char(exp_atual, 'YYYY-MM-DD'),
      'exp_novo', to_char(exp_novo, 'YYYY-MM-DD')
    ) AS x
    FROM _recalc WHERE exp_novo <= now() AND exp_atual > now()
    ORDER BY exp_novo ASC LIMIT 20
  ) a;

  IF p_apply THEN
    UPDATE public.active_searches s
    SET expires_at = r.exp_novo
    FROM _recalc r
    WHERE s.id = r.id;
    GET DIAGNOSTICS v_aplicadas = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'aplicado', p_apply,
    'afetadas', v_afetadas,
    'ficam_expiradas', v_expiram,
    'sem_base', v_sem_base,
    'atualizadas', v_aplicadas,
    'distribuicao', v_dist,
    'amostra', v_amostra
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_recalc_excel_expiry(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_recalc_excel_expiry(boolean) TO authenticated;